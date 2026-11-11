-- Planning Modus Retis · cualquiera puede sumar compañeros a sus tareas
-- Se corre una vez en Supabase → SQL Editor, después de 0004. Se puede volver a correr.
--
-- Antes solo admins y líderes sumaban a otras personas a una tarea. Ahora cualquiera que esté en la tarea
-- puede sumar a otro colaborador (Barbi crea una tarea suya y suma a Yani). Sacar a otras personas
-- sigue siendo de admins y líderes.

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

  if auth.uid() is not null and not public.is_staff() then
    -- Para sumar a alguien que no está a su cargo, quien edita tiene que estar en la tarea
    if not (auth.uid() = any (new.assignee_ids)) and exists (
         select 1 from unnest(new.assignee_ids) a
         where (tg_op = 'INSERT' or not (a = any (old.assignee_ids)))
           and not public.can_manage_user(a)) then
      raise exception 'Para sumar a otras personas a una tarea tenés que estar en ella';
    end if;
    -- Sacar a otros es de admins y líderes
    if tg_op = 'UPDATE' and exists (
         select 1 from unnest(old.assignee_ids) a
         where a <> auth.uid() and not (a = any (new.assignee_ids)) and not public.can_manage_user(a)) then
      raise exception 'Solo admins y líderes sacan a otras personas de una tarea';
    end if;
  end if;
  return new;
end $$;
