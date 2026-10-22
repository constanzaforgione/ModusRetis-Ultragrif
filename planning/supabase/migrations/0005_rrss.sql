-- Planning Modus Retis · calendario de redes sociales (pestaña RRSS)
-- Se corre una vez en Supabase → SQL Editor, después de 0004. Se puede volver a correr.
--
-- clients.social     el cliente tiene calendario de redes (aparece en RRSS)
-- social_posts       cada pieza programada: fecha, redes, formato, copy, arte, estado y responsable
-- Permisos: todos ven; cualquiera programa piezas (a su nombre; admins y líderes, a nombre de cualquiera);
-- edita quien la creó, su responsable (o el líder) y admins/líderes; borra solo un admin.

alter table public.clients add column if not exists social boolean not null default false;

insert into public.clients (name, color) values ('Confort Iván', '#e8930c') on conflict (name) do nothing;
update public.clients set social = true where name in ('Ultragrif', 'Modus Retis', 'Confort Iván');

create table if not exists public.social_posts (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  publish_date date not null,
  publish_time time,
  networks     text[] not null default '{instagram}',
  format       text not null default 'post',
  title        text not null,
  copy         text not null default '',
  hashtags     text not null default '',
  pillar       text not null default '',
  brief        text not null default '',
  cta          text not null default '',
  asset_url    text not null default '',
  post_url     text not null default '',
  notes        text not null default '',
  status       text not null default 'idea',
  assignee_id  uuid references public.profiles (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint social_posts_networks check (cardinality(networks) > 0 and networks <@ array['instagram', 'linkedin', 'tiktok']),
  constraint social_posts_format check (format in ('post', 'carrusel', 'reel', 'historia', 'video', 'articulo')),
  constraint social_posts_status check (status in ('idea', 'en_produccion', 'en_revision', 'aprobada', 'programada', 'publicada'))
);
create index if not exists social_posts_date on public.social_posts (publish_date);
create index if not exists social_posts_client on public.social_posts (client_id, publish_date);

create or replace function public.touch_social_post() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists social_posts_touch on public.social_posts;
create trigger social_posts_touch before update on public.social_posts
  for each row execute function public.touch_social_post();

alter table public.social_posts enable row level security;

drop policy if exists social_read on public.social_posts;
drop policy if exists social_insert on public.social_posts;
drop policy if exists social_update on public.social_posts;
drop policy if exists social_delete on public.social_posts;

create policy social_read on public.social_posts for select to authenticated using (true);
create policy social_insert on public.social_posts for insert to authenticated
  with check (public.my_role() is not null and (assignee_id is null or public.can_manage_user(assignee_id) or public.is_staff()));
create policy social_update on public.social_posts for update to authenticated
  using (public.is_staff() or created_by = auth.uid() or public.can_manage_user(assignee_id))
  with check (public.is_staff() or ((created_by = auth.uid() or public.can_manage_user(assignee_id))
                                     and (assignee_id is null or public.can_manage_user(assignee_id))));
create policy social_delete on public.social_posts for delete to authenticated using (public.my_role() = 'admin');

grant select, insert, update, delete on public.social_posts to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'social_posts') then
    alter publication supabase_realtime add table public.social_posts;
  end if;
end $$;

notify pgrst, 'reload schema';
