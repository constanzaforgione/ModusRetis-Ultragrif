-- Planning Modus Retis · varios responsables por tarea y por proyecto
-- Se corre una vez en Supabase → SQL Editor, después de 0003. Se puede volver a correr.
--
-- tasks.assignee_ids    todas las personas responsables de la tarea (la primera es la principal = assignee_id)
-- projects.owner_ids    responsables del proyecto. Quien tenga una tarea del proyecto se suma solo.
-- Una tarea la puede editar cualquiera de sus responsables, el líder de cualquiera de ellos, un admin,
-- o el admin/líder que la creó. Solo admins y líderes suman a otras personas a una tarea.

-- ------------------------------------------------------------ columnas
alter table public.tasks add column if not exists assignee_ids uuid[] not null default '{}';
update public.tasks set assignee_ids = array[assignee_id] where cardinality(assignee_ids) = 0;
create index if not exists tasks_assignee_ids on public.tasks using gin (assignee_ids);

alter table public.projects add column if not exists owner_ids uuid[] not null default '{}';
update public.projects set owner_ids = array[owner_id] where owner_id is not null and cardinality(owner_ids) = 0;
create index if not exists projects_owner_ids on public.projects using gin (owner_ids);

-- Quita repetidos y nulos manteniendo el orden
create or replace function public.uniq_ids(ids uuid[]) returns uuid[]
language sql immutable as $$
  select coalesce(array_agg(x order by o), '{}') from (
    select x, min(o) o from unnest(ids) with ordinality u(x, o) where x is not null group by x
  ) s
$$;

create or replace function public.can_manage_any(ids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(ids) a where public.can_manage_user(a))
$$;

-- ------------------------------------------------------------ tareas: mantener assignee_id y assignee_ids alineados
create or replace function public.sync_task_assignees() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Si solo cambió el responsable principal (versiones viejas de la app, dictado), se reemplaza en la lista
  if tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id and new.assignee_ids = old.assignee_ids then
    new.assignee_ids := array_replace(old.assignee_ids, old.assignee_id, new.assignee_id);
  end if;
  new.assignee_ids := public.uniq_ids(new.assignee_ids);
  if cardinality(new.assignee_ids) = 0 then
    new.assignee_ids := array[new.assignee_id];
  end if;
  new.assignee_id := new.assignee_ids[1];

  -- Un miembro no puede sumar a otras personas
  if auth.uid() is not null and not public.is_staff() and exists (
       select 1 from unnest(new.assignee_ids) a
       where a <> auth.uid()
         and (tg_op = 'INSERT' or not (a = any (old.assignee_ids)))
         and not public.can_manage_user(a)) then
    raise exception 'Solo admins y líderes pueden sumar a otras personas a una tarea';
  end if;
  return new;
end $$;

drop trigger if exists tasks_assignees on public.tasks;
create trigger tasks_assignees before insert or update on public.tasks
  for each row execute function public.sync_task_assignees();

-- ------------------------------------------------------------ proyectos: owner_id = primero de owner_ids
create or replace function public.sync_project_owners() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id and new.owner_ids = old.owner_ids then
    new.owner_ids := case when old.owner_id is null then array_prepend(new.owner_id, old.owner_ids)
                          else array_replace(old.owner_ids, old.owner_id, new.owner_id) end;
  end if;
  new.owner_ids := public.uniq_ids(new.owner_ids);
  if cardinality(new.owner_ids) = 0 and new.owner_id is not null then
    new.owner_ids := array[new.owner_id];
  end if;
  new.owner_id := new.owner_ids[1];
  return new;
end $$;

drop trigger if exists projects_owners on public.projects;
create trigger projects_owners before insert or update on public.projects
  for each row execute function public.sync_project_owners();

-- Quien tiene tareas en un proyecto pasa a ser responsable del proyecto
create or replace function public.add_task_people_to_project() returns trigger
language plpgsql security definer set search_path = public as $$
declare missing uuid[];
begin
  if new.project_id is null then return new; end if;
  select coalesce(array_agg(a), '{}') into missing
  from unnest(new.assignee_ids) a
  where not exists (select 1 from public.projects p where p.id = new.project_id and a = any (p.owner_ids));
  if cardinality(missing) > 0 then
    perform set_config('mr.auto_owner', '1', true);
    update public.projects set owner_ids = owner_ids || missing where id = new.project_id;
    perform set_config('mr.auto_owner', '', true);
  end if;
  return new;
end $$;

drop trigger if exists tasks_project_people on public.tasks;
create trigger tasks_project_people after insert or update of assignee_ids, assignee_id, project_id on public.tasks
  for each row execute function public.add_task_people_to_project();

-- Al ya cargado: sumar a los proyectos la gente de sus tareas
update public.projects p
set owner_ids = public.uniq_ids(p.owner_ids || coalesce((
  select array_agg(a) from public.tasks t, unnest(t.assignee_ids) a where t.project_id = p.id), '{}'));

-- ------------------------------------------------------------ permisos
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_manage_user(assignee_id) or public.can_manage_any(assignee_ids) or (public.is_staff() and created_by = auth.uid()))
  with check (public.can_manage_user(assignee_id) or public.can_manage_any(assignee_ids) or (public.is_staff() and created_by = auth.uid()));

-- ------------------------------------------------------------ avisos con varias personas
create or replace function public.notify_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  if new.recurring_id is not null or auth.uid() is null then return new; end if;
  foreach a in array new.assignee_ids loop
    if a <> auth.uid() and (tg_op = 'INSERT' or not (a = any (old.assignee_ids))) then
      perform public.push_notification(a, new.id, null, 'asignada',
        public.actor_name(auth.uid()) || ' te asignó «' || new.title || '»' ||
        case when cardinality(new.assignee_ids) > 1 then ' (junto con ' || cardinality(new.assignee_ids) - 1 || ' más)' else '' end ||
        case when new.due_date is not null then ' · vence ' || public.short_date(new.due_date) else '' end, auth.uid());
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists tasks_notify on public.tasks;
create trigger tasks_notify after insert or update of assignee_id, assignee_ids on public.tasks
  for each row execute function public.notify_assignment();

create or replace function public.notify_task_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  who text := public.actor_name(auth.uid());
  changes text[] := '{}';
  a uuid;
  owners uuid[];
begin
  if tg_op = 'INSERT' then
    if new.project_id is not null and new.recurring_id is null then
      select owner_ids into owners from public.projects where id = new.project_id;
      foreach a in array coalesce(owners, '{}') loop
        if a is distinct from actor and not (a = any (new.assignee_ids)) then
          perform public.push_notification(a, new.id, new.project_id, 'tarea_en_proyecto',
            who || ' sumó «' || new.title || '» a tu proyecto', actor);
        end if;
      end loop;
    end if;
    return new;
  end if;

  if actor is null then return new; end if;

  if new.title is distinct from old.title then changes := changes || ('título → «' || new.title || '»'); end if;
  if new.description is distinct from old.description then changes := changes || 'descripción'::text; end if;
  if new.status is distinct from old.status then changes := changes || ('estado: ' || public.status_label(old.status) || ' → ' || public.status_label(new.status)); end if;
  if new.priority is distinct from old.priority then changes := changes || ('prioridad → ' || new.priority); end if;
  if new.start_date is distinct from old.start_date then changes := changes || ('inicio → ' || public.short_date(new.start_date)); end if;
  if new.due_date is distinct from old.due_date then changes := changes || ('vence → ' || public.short_date(new.due_date)); end if;
  if new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time then
    changes := changes || ('horario → ' || coalesce(to_char(new.start_time, 'HH24:MI'), 'sin horario') ||
                           coalesce('–' || to_char(new.end_time, 'HH24:MI'), ''));
  end if;
  if new.client_id is distinct from old.client_id then changes := changes || 'cliente'::text; end if;
  if new.project_id is distinct from old.project_id then changes := changes || 'proyecto'::text; end if;

  -- A cada responsable que ya estaba: qué cambió (los recién sumados reciben el aviso de asignación)
  if array_length(changes, 1) > 0 then
    foreach a in array new.assignee_ids loop
      if a = any (old.assignee_ids) then
        perform public.push_notification(a, new.id, null, 'cambio',
          case when actor = a then 'Cambiaste ' else who || ' cambió ' end ||
          array_to_string(changes, ', ') || ' en «' || new.title || '»', actor);
      end if;
    end loop;
  end if;

  -- A quien sacaron de la tarea
  foreach a in array old.assignee_ids loop
    if not (a = any (new.assignee_ids)) and a is distinct from actor then
      perform public.push_notification(a, new.id, null, 'reasignada',
        who || ' te sacó de «' || new.title || '»' ||
        ' (ahora: ' || (select string_agg(public.actor_name(x), ', ') from unnest(new.assignee_ids) x) || ')', actor);
    end if;
  end loop;

  -- A quien la creó para otras personas: que ya está hecha
  if new.status = 'hecha' and old.status <> 'hecha' and not (new.created_by = any (new.assignee_ids)) and new.created_by is distinct from actor then
    perform public.push_notification(new.created_by, new.id, null, 'completada',
      (select string_agg(public.actor_name(x), ', ') from unnest(new.assignee_ids) x) || ' terminó «' || new.title || '»', actor);
  end if;

  -- A los líderes de quienes quedaron bloqueados
  if new.status = 'bloqueada' and old.status <> 'bloqueada' then
    for a in select distinct p.lead_id from public.profiles p where p.id = any (new.assignee_ids) and p.lead_id is not null loop
      if a is distinct from actor then
        perform public.push_notification(a, new.id, null, 'equipo_bloqueada',
          (select string_agg(public.actor_name(x), ', ') from unnest(new.assignee_ids) x) || ' está bloqueado/a con «' || new.title || '»', actor);
      end if;
    end loop;
  end if;
  return new;
end $$;

create or replace function public.notify_project_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  who text := public.actor_name(auth.uid());
  auto boolean := coalesce(current_setting('mr.auto_owner', true), '') = '1';
  changes text[] := '{}';
  a uuid;
begin
  if actor is null and not auto then return new; end if;

  -- Responsables nuevos
  foreach a in array new.owner_ids loop
    if a is distinct from actor and (tg_op = 'INSERT' or not (a = any (old.owner_ids))) then
      perform public.push_notification(a, null, new.id, 'proyecto_asignado',
        case when auto then 'Sos responsable de «' || new.name || '» porque tenés tareas en el proyecto'
             else who || ' te puso como responsable de «' || new.name || '» · ' || public.short_date(new.start_date) || ' → ' || public.short_date(new.end_date) end,
        actor);
    end if;
  end loop;
  if tg_op = 'INSERT' or auto then return new; end if;

  if new.name is distinct from old.name then changes := changes || ('nombre → «' || new.name || '»'); end if;
  if new.description is distinct from old.description then changes := changes || 'descripción'::text; end if;
  if new.status is distinct from old.status then changes := changes || ('estado: ' || public.project_status_label(old.status) || ' → ' || public.project_status_label(new.status)); end if;
  if new.start_date is distinct from old.start_date then changes := changes || ('inicio → ' || public.short_date(new.start_date)); end if;
  if new.end_date is distinct from old.end_date then changes := changes || ('fin → ' || public.short_date(new.end_date)); end if;
  if new.client_id is distinct from old.client_id then changes := changes || 'cliente'::text; end if;

  if array_length(changes, 1) > 0 then
    foreach a in array new.owner_ids loop
      if a = any (old.owner_ids) then
        perform public.push_notification(a, null, new.id, 'proyecto_cambio',
          case when actor = a then 'Cambiaste ' else who || ' cambió ' end ||
          array_to_string(changes, ', ') || ' en el proyecto «' || new.name || '»', actor);
      end if;
    end loop;
  end if;
  return new;
end $$;

create or replace function public.daily_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  before int;
  after int;
  r record;
begin
  select count(*) into before from public.notifications where day = today;

  for r in select t.id, t.title, t.due_date, a.person, p.lead_id
           from public.tasks t cross join lateral unnest(t.assignee_ids) a(person)
           join public.profiles p on p.id = a.person
           where t.status <> 'hecha' and t.due_date in (today, today - 1) loop
    if r.due_date = today then
      perform public.push_notification(r.person, r.id, null, 'vence_hoy', 'Vence hoy: «' || r.title || '»', null);
    else
      perform public.push_notification(r.person, r.id, null, 'vencio', 'Se venció ayer y sigue abierta: «' || r.title || '»', null);
      if r.lead_id is not null then
        perform public.push_notification(r.lead_id, r.id, null, 'equipo_vencida',
          public.actor_name(r.person) || ' tiene vencida «' || r.title || '»', null);
      end if;
    end if;
  end loop;

  for r in select pr.id, pr.name, pr.end_date, o.person
           from public.projects pr cross join lateral unnest(pr.owner_ids) o(person)
           where pr.status <> 'completado' and pr.end_date in (today + 3, today - 1) loop
    if r.end_date = today + 3 then
      perform public.push_notification(r.person, null, r.id, 'proyecto_por_terminar',
        'El proyecto «' || r.name || '» termina el ' || public.short_date(r.end_date), null);
    else
      perform public.push_notification(r.person, null, r.id, 'proyecto_vencido',
        'El proyecto «' || r.name || '» pasó su fecha de fin y no está completado', null);
    end if;
  end loop;

  select count(*) into after from public.notifications where day = today;
  return after - before;
end $$;

notify pgrst, 'reload schema';
