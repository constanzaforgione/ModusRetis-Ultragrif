-- Planning Modus Retis · esquema inicial
-- Los permisos viven en la base (Row Level Security): aunque alguien llame a la API
-- directamente, solo puede tocar lo que su rol le permite.
--
--   admin   → todo: clientes, roadmap, tareas de cualquiera, borrar, roles del equipo.
--   lider   → roadmap y clientes; crea y edita tareas propias y de su equipo.
--   miembro → crea y edita solo SUS tareas. Ve las del resto, pero no las modifica.
--   Borrar tareas: solo admin.


create type public.user_role as enum ('admin', 'lider', 'miembro');
create type public.task_status as enum ('pendiente', 'en_curso', 'bloqueada', 'en_revision', 'hecha');
create type public.task_priority as enum ('baja', 'media', 'alta', 'urgente');
create type public.project_status as enum ('planificado', 'en_curso', 'en_pausa', 'completado');

-- ---------------------------------------------------------------- perfiles
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        public.user_role not null default 'miembro',
  lead_id     uuid references public.profiles (id) on delete set null,
  active      boolean not null default true,
  email_alerts boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- clientes
create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  color       text not null default '#304cd3',
  description text not null default '',
  active      boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- roadmap
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  name        text not null,
  description text not null default '',
  status      public.project_status not null default 'planificado',
  start_date  date not null,
  end_date    date not null,
  progress    smallint not null default 0 check (progress between 0 and 100),
  owner_id    uuid references public.profiles (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date >= start_date)
);
create index on public.projects (client_id);

-- ---------------------------------------------------------------- tareas
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(trim(title)) > 0),
  description      text not null default '',
  client_id        uuid references public.clients (id) on delete set null,
  project_id       uuid references public.projects (id) on delete set null,
  assignee_id      uuid not null references public.profiles (id),
  created_by       uuid not null references public.profiles (id),
  status           public.task_status not null default 'pendiente',
  priority         public.task_priority not null default 'media',
  start_date       date,
  due_date         date,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index on public.tasks (assignee_id);
create index on public.tasks (client_id);
create index on public.tasks (due_date) where status <> 'hecha';

-- ---------------------------------------------------------------- avisos
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  task_id     uuid references public.tasks (id) on delete cascade,
  kind        text not null,  -- asignada | por_vencer | vencida | sin_movimiento | equipo_vencida
  message     text not null,
  day         date not null default current_date,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
-- Un mismo aviso (persona + tarea + tipo) se genera una sola vez por día
create unique index notifications_once_a_day on public.notifications (user_id, task_id, kind, day);
create index on public.notifications (user_id, read_at);

-- ================================================================ helpers
create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- ¿El usuario actual puede gestionar las tareas de `target`?
create or replace function public.can_manage_user(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.active and (
      target = me.id
      or me.role = 'admin'
      or (me.role = 'lider' and exists (
            select 1 from public.profiles p where p.id = target and p.lead_id = me.id))
    )
  )
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'lider'), false)
$$;

-- ================================================================ triggers
-- Alta de usuario: crea el perfil. La primera persona que entra queda como admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    (case when exists (select 1 from public.profiles where role = 'admin') then 'miembro' else 'admin' end)::public.user_role
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Solo un admin cambia rol, líder o estado de una cuenta (cada uno puede cambiar su nombre y avisos)
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(public.my_role() <> 'admin', true) and (
       new.role is distinct from old.role
    or new.lead_id is distinct from old.lead_id
    or new.active is distinct from old.active
    or new.email is distinct from old.email) then
    raise exception 'Solo un admin puede cambiar roles, líderes o el estado de una cuenta';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Tareas: fechas de actividad, cierre y autor
create or replace function public.touch_task() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  if new.status = 'hecha' and (tg_op = 'INSERT' or old.status <> 'hecha') then
    new.completed_at := now();
  elsif new.status <> 'hecha' then
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger tasks_touch before insert or update on public.tasks
  for each row execute function public.touch_task();

create or replace function public.touch_project() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_project();

-- Aviso cuando otra persona te asigna una tarea
create or replace function public.notify_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_name text;
begin
  if auth.uid() is not null and new.assignee_id <> auth.uid()
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select full_name into actor_name from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, task_id, kind, message)
    values (new.assignee_id, new.id, 'asignada',
            coalesce(actor_name, 'Alguien') || ' te asignó: ' || new.title)
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger tasks_notify after insert or update of assignee_id on public.tasks
  for each row execute function public.notify_assignment();

-- ================================================================ RLS
alter table public.profiles      enable row level security;
alter table public.clients       enable row level security;
alter table public.projects      enable row level security;
alter table public.tasks         enable row level security;
alter table public.notifications enable row level security;

-- perfiles: todo el equipo se ve; cada uno edita el suyo (el trigger limita qué campos); admin edita todos
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_self   on public.profiles for update to authenticated
  using (id = auth.uid() or public.my_role() = 'admin')
  with check (id = auth.uid() or public.my_role() = 'admin');

-- clientes y roadmap: lectura para todos, edición admin/líder, borrado solo admin
create policy clients_read   on public.clients for select to authenticated using (true);
create policy clients_insert on public.clients for insert to authenticated with check (public.is_staff());
create policy clients_update on public.clients for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy clients_delete on public.clients for delete to authenticated using (public.my_role() = 'admin');

create policy projects_read   on public.projects for select to authenticated using (true);
create policy projects_insert on public.projects for insert to authenticated with check (public.is_staff());
create policy projects_update on public.projects for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy projects_delete on public.projects for delete to authenticated using (public.my_role() = 'admin');

-- tareas: todos ven todo; cada uno crea/edita lo que puede gestionar (y no puede pasárselas
-- a alguien fuera de su alcance); borrar es solo de admin
create policy tasks_read   on public.tasks for select to authenticated using (true);
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.can_manage_user(assignee_id));
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_manage_user(assignee_id))
  with check (public.can_manage_user(assignee_id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.my_role() = 'admin');

-- avisos: cada uno ve y marca como leídos los suyos
create policy notif_read   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime: el tablero se actualiza solo cuando alguien cambia algo
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tasks, public.projects, public.clients, public.notifications;
  end if;
end $$;
