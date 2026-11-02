-- Planning Modus Retis · resúmenes mensuales guardados en la app
-- Se corre una vez en Supabase → SQL Editor. Se puede volver a correr.
--
-- monthly_summaries  los resúmenes de cada cliente y mes. Se escriben en la app y, si se quiere,
--                    se mandan a ClickUp. Los que se escribieron en ClickUp también se copian acá
--                    (por las dudas), salvo que después se hayan editado en la app.
-- Permisos: todos ven (menos los que vienen de tareas, solo admins); admins y líderes escriben; borra solo un admin.

create table if not exists public.monthly_summaries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  -- nombre del cliente como figura en ClickUp (para los que no tienen cliente en la app)
  client_name text not null default '',
  -- "2026-10"
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  title text not null default '',
  content text not null default '',
  hours numeric,
  -- app: se escribió acá · clickup: copia de un resumen escrito en ClickUp
  source text not null default 'app' check (source in ('app', 'clickup')),
  -- página de ClickUp de la que viene o a la que se mandó (doc:<doc>:<página> o task:<id>)
  clickup_key text unique,
  clickup_url text not null default '',
  -- una copia de ClickUp que se editó en la app ya no se pisa con lo de ClickUp
  edited boolean not null default false,
  sent_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists monthly_summaries_month on public.monthly_summaries (month desc);

alter table public.monthly_summaries enable row level security;
drop policy if exists summaries_read on public.monthly_summaries;
drop policy if exists summaries_insert on public.monthly_summaries;
drop policy if exists summaries_update on public.monthly_summaries;
drop policy if exists summaries_delete on public.monthly_summaries;
-- Los que vienen de tareas de ClickUp (task:…) pueden traer facturación con la tarifa de cada colaborador: solo admins
create policy summaries_read on public.monthly_summaries for select to authenticated
  using (clickup_key is null or clickup_key not like 'task:%' or public.my_role() = 'admin');
create policy summaries_insert on public.monthly_summaries for insert to authenticated with check (public.is_staff());
create policy summaries_update on public.monthly_summaries for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy summaries_delete on public.monthly_summaries for delete to authenticated using (public.my_role() = 'admin');

grant select, insert, update, delete on public.monthly_summaries to authenticated;
