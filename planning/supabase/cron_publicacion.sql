-- Planning Modus Retis · reloj del publicador de RRSS
-- Se corre una vez en Supabase → SQL Editor, después de 0006. Cada 5 minutos Supabase le avisa a la app
-- que revise si hay piezas para publicar. Antes de correrlo, reemplazá TU_CRON_SECRET por el valor de la
-- variable CRON_SECRET de Vercel (el mismo de siempre). Se puede volver a correr.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- El secreto queda guardado en la bóveda de Supabase, no en el código del cron
select vault.create_secret('TU_CRON_SECRET', 'planning_cron_secret')
where not exists (select 1 from vault.secrets where name = 'planning_cron_secret');

select cron.unschedule('planning-publicar-rrss') where exists (select 1 from cron.job where jobname = 'planning-publicar-rrss');
select cron.schedule(
  'planning-publicar-rrss',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://planning-mr.vercel.app/api/social/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'planning_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Para ver si está andando: select * from cron.job_run_details order by start_time desc limit 5;
-- y las respuestas de la app: select status_code, content from net._http_response order by created desc limit 5;
