-- Planning Modus Retis · avisos (campanita)
-- Se corre una vez en Supabase → SQL Editor, después de 0002. Se puede volver a correr.
--
-- Avisos que se generan solos desde la base (vengan de la app, del dictado o de quien sea):
--   asignada              alguien te asignó una tarea
--   proyecto_asignado     alguien te puso como responsable de un proyecto
--   cambio                cambió una tarea tuya (vos o alguien más): qué cambió y quién
--   reasignada            una tarea tuya pasó a otra persona
--   proyecto_cambio       cambió un proyecto del que sos responsable
--   tarea_en_proyecto     sumaron una tarea a un proyecto tuyo
--   completada            se terminó una tarea que vos creaste para otra persona
--   equipo_bloqueada      alguien de tu equipo marcó una tarea como bloqueada
--   vence_hoy             tenés tareas que vencen hoy
--   vencio                una tarea tuya venció ayer y sigue abierta
--   equipo_vencida        a alguien de tu equipo se le venció una tarea ayer
--   proyecto_por_terminar un proyecto tuyo termina en 3 días
--   proyecto_vencido      un proyecto tuyo pasó su fecha de fin sin completarse

alter table public.notifications
  add column if not exists project_id uuid references public.projects (id) on delete cascade,
  add column if not exists actor_id uuid references public.profiles (id) on delete set null;
create unique index if not exists notifications_project_once_a_day
  on public.notifications (user_id, project_id, kind, day) where project_id is not null;

create or replace function public.status_label(s public.task_status) returns text
language sql immutable as $$
  select case s when 'pendiente' then 'Pendiente' when 'en_curso' then 'En curso' when 'bloqueada' then 'Bloqueada'
                when 'en_revision' then 'En revisión' else 'Hecha' end
$$;

create or replace function public.project_status_label(s public.project_status) returns text
language sql immutable as $$
  select case s when 'planificado' then 'Planificado' when 'en_curso' then 'En curso' when 'en_pausa' then 'En pausa' else 'Completado' end
$$;

create or replace function public.short_date(d date) returns text
language sql immutable as $$
  select case when d is null then 'sin fecha'
         else extract(day from d)::int || ' ' || (array['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])[extract(month from d)::int] end
$$;

-- Guarda un aviso; si ya hay uno igual hoy (misma persona, tarea/proyecto y tipo), lo actualiza y lo vuelve a marcar sin leer
create or replace function public.push_notification(p_user uuid, p_task uuid, p_project uuid, p_kind text, p_message text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if p_user is null then return; end if;
  if p_task is not null then
    insert into public.notifications (user_id, task_id, project_id, kind, message, actor_id, day)
    values (p_user, p_task, p_project, p_kind, p_message, p_actor, today)
    on conflict (user_id, task_id, kind, day)
    do update set message = excluded.message, actor_id = excluded.actor_id, read_at = null, created_at = now();
  elsif p_project is not null then
    insert into public.notifications (user_id, task_id, project_id, kind, message, actor_id, day)
    values (p_user, null, p_project, p_kind, p_message, p_actor, today)
    on conflict (user_id, project_id, kind, day) where project_id is not null
    do update set message = excluded.message, actor_id = excluded.actor_id, read_at = null, created_at = now();
  end if;
end $$;

create or replace function public.actor_name(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.profiles where id = uid), 'Alguien')
$$;

-- ------------------------------------------------------------ tareas
-- Reemplaza el aviso de asignación anterior: ahora también guarda quién fue
create or replace function public.notify_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recurring_id is null and auth.uid() is not null and new.assignee_id <> auth.uid()
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform public.push_notification(new.assignee_id, new.id, null, 'asignada',
      public.actor_name(auth.uid()) || ' te asignó «' || new.title || '»' ||
      case when new.due_date is not null then ' · vence ' || public.short_date(new.due_date) else '' end, auth.uid());
  end if;
  return new;
end $$;

create or replace function public.notify_task_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  who text := public.actor_name(auth.uid());
  changes text[] := '{}';
  lead uuid;
  owner uuid;
begin
  if tg_op = 'INSERT' then
    -- Tarea nueva en un proyecto de otra persona
    if new.project_id is not null and new.recurring_id is null then
      select owner_id into owner from public.projects where id = new.project_id;
      if owner is not null and owner is distinct from actor and owner <> new.assignee_id then
        perform public.push_notification(owner, new.id, new.project_id, 'tarea_en_proyecto',
          who || ' sumó «' || new.title || '» a tu proyecto', actor);
      end if;
    end if;
    return new;
  end if;

  if actor is null then return new; end if;  -- cambios automáticos (repeticiones, imports)

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

  -- Al responsable: qué cambió (si recién se la asignaron ya recibe el aviso de asignación)
  if array_length(changes, 1) > 0 and new.assignee_id = old.assignee_id then
    perform public.push_notification(new.assignee_id, new.id, null, 'cambio',
      case when actor = new.assignee_id then 'Cambiaste ' else who || ' cambió ' end ||
      array_to_string(changes, ', ') || ' en «' || new.title || '»', actor);
  end if;

  -- A quien la tenía antes, si se la pasaron a otra persona
  if new.assignee_id <> old.assignee_id and old.assignee_id is distinct from actor then
    perform public.push_notification(old.assignee_id, new.id, null, 'reasignada',
      who || ' le pasó «' || new.title || '» a ' || public.actor_name(new.assignee_id), actor);
  end if;

  -- A quien la creó para otra persona: que ya está hecha
  if new.status = 'hecha' and old.status <> 'hecha' and new.created_by <> new.assignee_id and new.created_by is distinct from actor then
    perform public.push_notification(new.created_by, new.id, null, 'completada',
      public.actor_name(new.assignee_id) || ' terminó «' || new.title || '»', actor);
  end if;

  -- Al líder: alguien de su equipo quedó bloqueado
  if new.status = 'bloqueada' and old.status <> 'bloqueada' then
    select lead_id into lead from public.profiles where id = new.assignee_id;
    if lead is not null and lead is distinct from actor then
      perform public.push_notification(lead, new.id, null, 'equipo_bloqueada',
        public.actor_name(new.assignee_id) || ' está bloqueado/a con «' || new.title || '»', actor);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tasks_changes on public.tasks;
create trigger tasks_changes after insert or update on public.tasks
  for each row execute function public.notify_task_changes();

-- ------------------------------------------------------------ proyectos
create or replace function public.notify_project_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  who text := public.actor_name(auth.uid());
  changes text[] := '{}';
begin
  if actor is null then return new; end if;

  if new.owner_id is not null and new.owner_id <> actor
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    perform public.push_notification(new.owner_id, null, new.id, 'proyecto_asignado',
      who || ' te puso como responsable de «' || new.name || '» · ' || public.short_date(new.start_date) || ' → ' || public.short_date(new.end_date), actor);
  end if;
  if tg_op = 'INSERT' or new.owner_id is null or new.owner_id is distinct from old.owner_id then return new; end if;

  if new.name is distinct from old.name then changes := changes || ('nombre → «' || new.name || '»'); end if;
  if new.description is distinct from old.description then changes := changes || 'descripción'::text; end if;
  if new.status is distinct from old.status then changes := changes || ('estado: ' || public.project_status_label(old.status) || ' → ' || public.project_status_label(new.status)); end if;
  if new.start_date is distinct from old.start_date then changes := changes || ('inicio → ' || public.short_date(new.start_date)); end if;
  if new.end_date is distinct from old.end_date then changes := changes || ('fin → ' || public.short_date(new.end_date)); end if;
  if new.client_id is distinct from old.client_id then changes := changes || 'cliente'::text; end if;

  if array_length(changes, 1) > 0 then
    perform public.push_notification(new.owner_id, null, new.id, 'proyecto_cambio',
      case when actor = new.owner_id then 'Cambiaste ' else who || ' cambió ' end ||
      array_to_string(changes, ', ') || ' en el proyecto «' || new.name || '»', actor);
  end if;
  return new;
end $$;

drop trigger if exists projects_changes on public.projects;
create trigger projects_changes after insert or update on public.projects
  for each row execute function public.notify_project_changes();

-- ------------------------------------------------------------ avisos del día
-- Vence hoy, venció ayer, proyectos por terminar o vencidos. Se llama al abrir la app y desde el cron;
-- nunca duplica (un aviso por cosa y por día).
create or replace function public.daily_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  before int;
  after int;
  r record;
begin
  select count(*) into before from public.notifications where day = today;

  for r in select t.*, p.lead_id from public.tasks t join public.profiles p on p.id = t.assignee_id
           where t.status <> 'hecha' and t.due_date in (today, today - 1) loop
    if r.due_date = today then
      perform public.push_notification(r.assignee_id, r.id, null, 'vence_hoy', 'Vence hoy: «' || r.title || '»', null);
    else
      perform public.push_notification(r.assignee_id, r.id, null, 'vencio', 'Se venció ayer y sigue abierta: «' || r.title || '»', null);
      if r.lead_id is not null then
        perform public.push_notification(r.lead_id, r.id, null, 'equipo_vencida',
          public.actor_name(r.assignee_id) || ' tiene vencida «' || r.title || '»', null);
      end if;
    end if;
  end loop;

  for r in select * from public.projects
           where status <> 'completado' and owner_id is not null and end_date in (today + 3, today - 1) loop
    if r.end_date = today + 3 then
      perform public.push_notification(r.owner_id, null, r.id, 'proyecto_por_terminar',
        'El proyecto «' || r.name || '» termina el ' || public.short_date(r.end_date), null);
    else
      perform public.push_notification(r.owner_id, null, r.id, 'proyecto_vencido',
        'El proyecto «' || r.name || '» pasó su fecha de fin y no está completado', null);
    end if;
  end loop;

  select count(*) into after from public.notifications where day = today;
  return after - before;
end $$;

grant execute on function public.daily_notifications() to authenticated;

notify pgrst, 'reload schema';
