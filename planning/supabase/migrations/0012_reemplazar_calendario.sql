-- Planning Modus Retis · cualquiera puede reemplazar un calendario de redes
-- Se corre una vez en Supabase → SQL Editor, después de 0005. Se puede volver a correr.
--
-- Al importar un calendario con "Reemplazar", se borran las piezas anteriores de ese cliente y mes.
-- Antes solo un admin podía borrar piezas; ahora cualquier usuario activo puede borrar las que no
-- están publicadas (las publicadas solo las borra un admin).

drop policy if exists social_delete on public.social_posts;
create policy social_delete on public.social_posts for delete to authenticated
  using (public.my_role() = 'admin' or (public.my_role() is not null and status <> 'publicada'));
