-- Planning Modus Retis · arreglo de avisos: varias tareas nuevas en un mismo proyecto el mismo día
-- Se corre una vez en Supabase → SQL Editor, después de 0003/0004. Se puede volver a correr.
--
-- El índice "un aviso de proyecto por día" también tomaba los avisos de tareas que tienen proyecto
-- (tarea_en_proyecto), así que la segunda tarea sumada al mismo proyecto el mismo día fallaba con
-- "duplicate key value violates unique constraint notifications_project_once_a_day"
-- (por ejemplo, al importar varias tareas de una reunión). Ahora el índice es solo para avisos sin tarea.

drop index if exists public.notifications_project_once_a_day;
create unique index notifications_project_once_a_day
  on public.notifications (user_id, project_id, kind, day) where project_id is not null and task_id is null;

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
    on conflict (user_id, project_id, kind, day) where project_id is not null and task_id is null
    do update set message = excluded.message, actor_id = excluded.actor_id, read_at = null, created_at = now();
  end if;
end $$;
