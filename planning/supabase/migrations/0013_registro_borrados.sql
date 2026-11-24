-- Planning Modus Retis · registro de lo que se borra
-- Se corre una vez en Supabase → SQL Editor. Se puede volver a correr.
--
-- deletion_log  cada vez que alguien borra una pieza de redes, una tarea, un proyecto, un cliente, una tarea que
--               se repite o un resumen, queda guardado qué era (completo), quién lo borró y cuándo.
--               Lo escribe la base sola (también lo que se borra en cascada, p. ej. los proyectos de un cliente).
--               Lo ven solo los admins y nadie lo puede cambiar ni borrar desde la app.

create table if not exists public.deletion_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid,
  client_id uuid,
  title text not null default '',
  row_data jsonb not null,
  deleted_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz not null default now()
);
create index if not exists deletion_log_at on public.deletion_log (deleted_at desc);

alter table public.deletion_log enable row level security;
drop policy if exists deletion_log_read on public.deletion_log;
create policy deletion_log_read on public.deletion_log for select to authenticated using (public.my_role() = 'admin');
-- Sin políticas de alta, cambio ni borrado: solo escribe el trigger
revoke insert, update, delete, truncate on public.deletion_log from authenticated, anon;
grant select on public.deletion_log to authenticated;

create or replace function public.log_deletion() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(old);
begin
  insert into public.deletion_log (table_name, row_id, client_id, title, row_data, deleted_by)
  values (
    tg_table_name,
    nullif(r ->> 'id', '')::uuid,
    case when tg_table_name = 'clients' then nullif(r ->> 'id', '')::uuid else nullif(r ->> 'client_id', '')::uuid end,
    left(coalesce(r ->> 'title', r ->> 'name', ''), 300),
    r,
    auth.uid()
  );
  return old;
end $$;

do $$
declare t text;
begin
  foreach t in array array['social_posts', 'tasks', 'projects', 'clients', 'recurring_tasks', 'monthly_summaries'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists log_delete on public.%I', t);
      execute format('create trigger log_delete after delete on public.%I for each row execute function public.log_deletion()', t);
    end if;
  end loop;
end $$;
