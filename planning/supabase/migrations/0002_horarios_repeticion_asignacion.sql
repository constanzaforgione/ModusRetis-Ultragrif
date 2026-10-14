-- Planning Modus Retis · horarios, tareas repetitivas y asignación por líderes
-- Se corre una vez en Supabase → SQL Editor, después de 0001_init.sql.

-- ------------------------------------------------------------ horario de la tarea (para el calendario)
alter table public.tasks
  add column if not exists start_time time,
  add column if not exists end_time time;

-- ------------------------------------------------------------ tareas repetitivas
-- Cada "repetición" es un molde. Todos los días se crea la tarea que corresponde (una por período),
-- así nadie la tiene que volver a cargar.
do $$ begin
  create type public.recurrence as enum ('diaria', 'semanal', 'quincenal', 'mensual');
exception when duplicate_object then null; end $$;

create table if not exists public.recurring_tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  description text not null default '',
  client_id   uuid references public.clients (id) on delete set null,
  project_id  uuid references public.projects (id) on delete set null,
  assignee_id uuid not null references public.profiles (id),
  created_by  uuid not null references public.profiles (id),
  priority    public.task_priority not null default 'media',
  frequency   public.recurrence not null,
  next_date   date not null,                 -- próxima fecha de inicio a crear
  due_offset  int not null default 0 check (due_offset between 0 and 60), -- días entre inicio y vencimiento
  start_time  time,
  end_time    time,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.tasks
  add column if not exists recurring_id uuid references public.recurring_tasks (id) on delete set null;
create unique index if not exists tasks_one_per_occurrence on public.tasks (recurring_id, start_date) where recurring_id is not null;

create or replace function public.touch_recurring() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end $$;

drop trigger if exists recurring_touch on public.recurring_tasks;
create trigger recurring_touch before insert or update on public.recurring_tasks
  for each row execute function public.touch_recurring();

-- Siguiente fecha según la frecuencia ("diaria" = días hábiles)
create or replace function public.next_occurrence(d date, f public.recurrence) returns date
language sql immutable as $$
  select case f
    when 'diaria' then d + case extract(isodow from d)::int when 5 then 3 when 6 then 2 else 1 end
    when 'semanal' then d + 7
    when 'quincenal' then d + 14
    else (d + interval '1 month')::date
  end
$$;

-- Crea la tarea del período actual de cada repetición activa. Se puede llamar las veces que sea:
-- nunca duplica. Si nadie abrió la app por un tiempo, crea solo la ocurrencia más reciente.
create or replace function public.spawn_recurring() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  occ date;
  nxt date;
  created int := 0;
begin
  for r in select * from public.recurring_tasks where active and next_date <= today for update loop
    occ := r.next_date;
    nxt := public.next_occurrence(occ, r.frequency);
    while nxt <= today loop
      occ := nxt;
      nxt := public.next_occurrence(occ, r.frequency);
    end loop;

    insert into public.tasks (title, description, client_id, project_id, assignee_id, created_by, priority,
                              start_date, due_date, start_time, end_time, recurring_id)
    values (r.title, r.description, r.client_id, r.project_id, r.assignee_id, r.created_by, r.priority,
            occ, occ + r.due_offset, r.start_time, r.end_time, r.id)
    on conflict do nothing;
    if found then
      created := created + 1;
      insert into public.notifications (user_id, task_id, kind, message)
      select r.assignee_id, t.id, 'repeticion', 'Nueva repetición: ' || r.title
      from public.tasks t where t.recurring_id = r.id and t.start_date = occ
      on conflict do nothing;
    end if;

    update public.recurring_tasks set next_date = nxt where id = r.id;
  end loop;
  return created;
end $$;

grant execute on function public.spawn_recurring() to authenticated;

-- El aviso "X te asignó" no aplica a las repeticiones automáticas (tienen su propio aviso)
create or replace function public.notify_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_name text;
begin
  if new.recurring_id is null and auth.uid() is not null and new.assignee_id <> auth.uid()
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select full_name into actor_name from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, task_id, kind, message)
    values (new.assignee_id, new.id, 'asignada',
            coalesce(actor_name, 'Alguien') || ' te asignó: ' || new.title)
    on conflict do nothing;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------ permisos
-- Admins y líderes pueden asignar tareas a cualquier persona del equipo, y seguir editando
-- las que ellos crearon. Los miembros siguen pudiendo crear y editar solo las suyas.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.can_manage_user(assignee_id) or public.is_staff());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_manage_user(assignee_id) or (public.is_staff() and created_by = auth.uid()))
  with check (public.can_manage_user(assignee_id) or (public.is_staff() and created_by = auth.uid()));

alter table public.recurring_tasks enable row level security;
drop policy if exists recurring_read on public.recurring_tasks;
create policy recurring_read on public.recurring_tasks for select to authenticated using (true);
drop policy if exists recurring_insert on public.recurring_tasks;
create policy recurring_insert on public.recurring_tasks for insert to authenticated
  with check (public.can_manage_user(assignee_id) or public.is_staff());
drop policy if exists recurring_update on public.recurring_tasks;
create policy recurring_update on public.recurring_tasks for update to authenticated
  using (public.can_manage_user(assignee_id) or (public.is_staff() and created_by = auth.uid()))
  with check (public.can_manage_user(assignee_id) or (public.is_staff() and created_by = auth.uid()));
drop policy if exists recurring_delete on public.recurring_tasks;
create policy recurring_delete on public.recurring_tasks for delete to authenticated
  using (public.my_role() = 'admin');

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'recurring_tasks') then
    alter publication supabase_realtime add table public.recurring_tasks;
  end if;
end $$;
