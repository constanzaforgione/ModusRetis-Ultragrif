-- Planning Modus Retis · tareas desde reuniones de Granola
-- Se corre una vez en Supabase → SQL Editor. Se puede volver a correr.
--
-- meeting_notes   cada reunión "MR" leída de Granola, con los puntos de acción que se sacaron
--                 (así la IA lee cada reunión una sola vez) y si ya se revisó en el pop-up.
-- Cada persona ve y cambia solo las suyas.

create table if not exists public.meeting_notes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  meeting_id text not null,
  title text not null default '',
  meeting_date date,
  url text not null default '',
  items jsonb not null default '[]',
  -- pendiente: falta revisarla · revisada: ya se eligió qué importar
  status text not null default 'pendiente' check (status in ('pendiente', 'revisada')),
  imported int not null default 0,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  primary key (user_id, meeting_id)
);

alter table public.meeting_notes enable row level security;
drop policy if exists meeting_notes_own on public.meeting_notes;
create policy meeting_notes_own on public.meeting_notes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.meeting_notes to authenticated;
