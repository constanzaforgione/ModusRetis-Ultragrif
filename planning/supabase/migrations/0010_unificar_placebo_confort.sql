-- Planning Modus Retis · un solo cliente "Placebo / Confort Iván"
-- Se corre una vez en Supabase → SQL Editor. Se puede volver a correr.
--
-- Si hay clientes sueltos "Placebo", "Placebo Amoblamientos" o "Confort Iván", todo lo suyo (tareas, proyectos,
-- tareas que se repiten, piezas de redes, resúmenes) pasa a "Placebo / Confort Iván" y los sueltos quedan inactivos.
-- No se borra nada. Corrido desde el SQL Editor no genera avisos.

do $$
declare
  target uuid;
  others uuid[];
  t text;
begin
  select id into target from public.clients where name = 'Placebo / Confort Iván';
  if target is null then
    -- Si todavía no existe, se renombra "Placebo" (o se crea)
    update public.clients set name = 'Placebo / Confort Iván' where name = 'Placebo' returning id into target;
  end if;
  if target is null then
    insert into public.clients (name, color) values ('Placebo / Confort Iván', '#8b5cf6') returning id into target;
  end if;

  select coalesce(array_agg(id), '{}') into others from public.clients
  where id <> target and lower(name) in ('placebo', 'placebo amoblamientos', 'confort iván', 'confort ivan');
  if cardinality(others) = 0 then return; end if;

  -- Todo lo que apunta a un cliente (las tablas que no existen todavía se saltean)
  foreach t in array array['tasks', 'projects', 'recurring_tasks', 'social_posts', 'monthly_summaries', 'social_accounts', 'social_publications'] loop
    if to_regclass('public.' || t) is not null then
      execute format('update public.%I set client_id = $1 where client_id = any ($2)', t) using target, others;
    end if;
  end loop;

  update public.clients set social = true
  where id = target and exists (select 1 from public.clients where id = any (others) and social);
  update public.clients set active = false, social = false where id = any (others);
end $$;
