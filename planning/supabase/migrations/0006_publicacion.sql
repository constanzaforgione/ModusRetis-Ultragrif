-- Planning Modus Retis · publicación automática en Instagram, LinkedIn y TikTok (reemplazo de Metricool)
-- Se corre una vez en Supabase → SQL Editor, después de 0005. Se puede volver a correr.
--
-- social_media             fotos, videos y PDF de cada pieza (archivos en Storage, bucket "social")
-- social_accounts          cuentas conectadas de cada cliente (una por red)
-- social_account_tokens    credenciales de esas cuentas: nadie las lee desde la app, solo el servidor
-- social_oauth_pending     paso intermedio al conectar LinkedIn cuando hay varias páginas para elegir
-- social_publications      una fila por pieza y red: cuándo sale, en qué va y qué pasó
-- Una pieza en estado "Programada" se publica sola a su hora (el servidor revisa cada 5 minutos).

alter table public.social_posts add column if not exists first_comment text not null default '';

-- ------------------------------------------------------------ permisos de una pieza
create or replace function public.can_edit_post(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_posts s
    where s.id = p and public.my_role() is not null
      and (public.is_staff() or s.created_by = auth.uid() or (s.assignee_id is not null and public.can_manage_user(s.assignee_id)))
  )
$$;

-- ------------------------------------------------------------ material
create table if not exists public.social_media (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.social_posts (id) on delete cascade,
  path        text not null,
  url         text not null,
  kind        text not null check (kind in ('image', 'video', 'document')),
  mime        text not null default '',
  size_bytes  bigint not null default 0,
  width       int,
  height      int,
  duration    numeric,
  position    int not null default 0,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists social_media_post on public.social_media (post_id, position);
alter table public.social_media enable row level security;
drop policy if exists social_media_read on public.social_media;
drop policy if exists social_media_write on public.social_media;
create policy social_media_read on public.social_media for select to authenticated using (true);
create policy social_media_write on public.social_media for all to authenticated
  using (public.can_edit_post(post_id)) with check (public.can_edit_post(post_id));

-- ------------------------------------------------------------ cuentas conectadas
create table if not exists public.social_accounts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  network       text not null check (network in ('instagram', 'linkedin', 'tiktok')),
  external_id   text not null,
  name          text not null default '',
  username      text not null default '',
  avatar_url    text not null default '',
  status        text not null default 'conectada' check (status in ('conectada', 'vencida', 'error')),
  last_error    text not null default '',
  expires_at    timestamptz,
  connected_by  uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id, network)
);
alter table public.social_accounts enable row level security;
drop policy if exists social_accounts_read on public.social_accounts;
drop policy if exists social_accounts_delete on public.social_accounts;
create policy social_accounts_read on public.social_accounts for select to authenticated using (true);
create policy social_accounts_delete on public.social_accounts for delete to authenticated using (public.is_staff());

create table if not exists public.social_account_tokens (
  account_id          uuid primary key references public.social_accounts (id) on delete cascade,
  access_token        text not null,
  refresh_token       text,
  expires_at          timestamptz,
  refresh_expires_at  timestamptz,
  updated_at          timestamptz not null default now()
);
alter table public.social_account_tokens enable row level security; -- sin políticas: solo el servidor

create table if not exists public.social_oauth_pending (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  network     text not null,
  payload     jsonb not null,
  created_by  uuid references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.social_oauth_pending enable row level security; -- sin políticas: solo el servidor

-- ------------------------------------------------------------ publicaciones
create table if not exists public.social_publications (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references public.social_posts (id) on delete cascade,
  network          text not null check (network in ('instagram', 'linkedin', 'tiktok')),
  status           text not null default 'pendiente' check (status in ('pendiente', 'procesando', 'publicada', 'error', 'manual')),
  scheduled_at     timestamptz not null,
  next_attempt_at  timestamptz not null default now(),
  attempts         int not null default 0,
  state            jsonb not null default '{}',
  external_id      text not null default '',
  permalink        text not null default '',
  message          text not null default '',
  published_at     timestamptz,
  updated_at       timestamptz not null default now(),
  unique (post_id, network)
);
create index if not exists social_publications_due on public.social_publications (status, scheduled_at);
alter table public.social_publications enable row level security;
drop policy if exists social_publications_read on public.social_publications;
drop policy if exists social_publications_update on public.social_publications;
create policy social_publications_read on public.social_publications for select to authenticated using (true);
-- Marcar a mano que se publicó (stories con stickers, artículos de LinkedIn…)
create policy social_publications_update on public.social_publications for update to authenticated
  using (public.can_edit_post(post_id)) with check (public.can_edit_post(post_id));

/** Hora de publicación en Argentina; sin hora, 10:00 */
create or replace function public.post_scheduled_at(d date, t time) returns timestamptz
language sql immutable as $$
  select ((d + coalesce(t, '10:00'::time))::timestamp at time zone 'America/Argentina/Buenos_Aires')
$$;

-- Programar una pieza crea su publicación en cada red; sacarla de "Programada" la cancela
create or replace function public.sync_publications() returns trigger
language plpgsql security definer set search_path = public as $$
declare at timestamptz := public.post_scheduled_at(new.publish_date, new.publish_time);
begin
  if new.status = 'programada' then
    insert into public.social_publications (post_id, network, scheduled_at, next_attempt_at)
    select new.id, n, at, at from unnest(new.networks) n
    on conflict (post_id, network) do update
      set scheduled_at = excluded.scheduled_at,
          next_attempt_at = excluded.next_attempt_at,
          status = case when social_publications.status in ('publicada', 'procesando') then social_publications.status else 'pendiente' end,
          attempts = case when social_publications.status in ('publicada', 'procesando') then social_publications.attempts else 0 end,
          message = case when social_publications.status in ('publicada', 'procesando') then social_publications.message else '' end,
          updated_at = now();
    delete from public.social_publications
    where post_id = new.id and not (network = any (new.networks)) and status <> 'publicada';
  elsif new.status <> 'publicada' then
    delete from public.social_publications where post_id = new.id and status in ('pendiente', 'error', 'manual');
  end if;
  return new;
end $$;

drop trigger if exists social_posts_publications on public.social_posts;
create trigger social_posts_publications after insert or update of status, publish_date, publish_time, networks on public.social_posts
  for each row execute function public.sync_publications();

-- Cuando salió en todas sus redes (sola o marcada a mano), la pieza pasa a "Publicada" con el link
create or replace function public.publication_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'publicada' and old.status is distinct from 'publicada'
     and not exists (select 1 from public.social_publications x where x.post_id = new.post_id and x.status <> 'publicada') then
    update public.social_posts
       set status = 'publicada', post_url = case when post_url = '' then new.permalink else post_url end
     where id = new.post_id and status <> 'publicada';
  end if;
  return new;
end $$;

drop trigger if exists social_publications_done on public.social_publications;
create trigger social_publications_done after update of status on public.social_publications
  for each row execute function public.publication_done();

-- ------------------------------------------------------------ avisos de publicación
alter table public.notifications add column if not exists post_id uuid references public.social_posts (id) on delete cascade;
create unique index if not exists notifications_post_once_a_day
  on public.notifications (user_id, post_id, kind, day) where post_id is not null;

create or replace function public.push_post_notification(p_user uuid, p_post uuid, p_kind text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if p_user is null then return; end if;
  insert into public.notifications (user_id, task_id, project_id, post_id, kind, message, actor_id, day)
  values (p_user, null, null, p_post, p_kind, p_message, null, today)
  on conflict (user_id, post_id, kind, day) where post_id is not null
  do update set message = excluded.message, read_at = null, created_at = now();
end $$;

-- ------------------------------------------------------------ archivos (Supabase Storage)
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    -- Público para que Instagram, LinkedIn y TikTok puedan bajar el material; 50 MB por archivo (límite del plan gratis)
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('social', 'social', true, 52428800)
    on conflict (id) do update set public = true;
    drop policy if exists social_files_insert on storage.objects;
    drop policy if exists social_files_delete on storage.objects;
    create policy social_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'social' and public.my_role() is not null);
    create policy social_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'social' and (owner = auth.uid() or public.is_staff()));
  end if;
end $$;

-- ------------------------------------------------------------ tiempo real
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'social_publications') then
      alter publication supabase_realtime add table public.social_publications;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'social_accounts') then
      alter publication supabase_realtime add table public.social_accounts;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'social_media') then
      alter publication supabase_realtime add table public.social_media;
    end if;
  end if;
end $$;

grant select, insert, update, delete on public.social_media, public.social_publications, public.social_accounts to authenticated;

notify pgrst, 'reload schema';
