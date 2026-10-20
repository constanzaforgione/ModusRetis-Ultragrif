-- Importa el planning de Lytton (12 oct 2026): 25 tareas y los proyectos del roadmap que las agrupan.
-- Se corre en Supabase → SQL Editor. Se puede correr más de una vez:
--   · no duplica proyectos ni tareas (los busca por cliente + nombre),
--   · si alguien todavía no había entrado a la app, su tarea queda a nombre del admin con la nota
--     "Responsable en el planning: X"; al volver a correrlo cuando esa persona ya entró, se la pasa.
-- Requiere las migraciones 0001 a 0004.

-- Personas del planning y cómo reconocerlas por nombre o mail
drop table if exists _people;
create temp table _people (hint text, alias text);
insert into _people values
  ('Bárbara', 'barbara'), ('Bárbara', 'bárbara'), ('Bárbara', 'barbi'),
  ('Yani', 'yani'), ('Yani', 'yanina'),
  ('Lytton', 'lytton'),
  ('Maxi', 'maxi'), ('Maxi', 'maximiliano'),
  ('Mauricio Barrio', 'mauricio'), ('Mauricio Barrio', 'mbarrio'),
  ('Coni', 'coni'), ('Coni', 'constanza'), ('Coni', 'c.forgione');

drop table if exists _who;
create temp table _who as
select distinct on (pe.hint) pe.hint, p.id
from _people pe
join public.profiles p
  on p.active and (lower(p.full_name) like pe.alias || '%' or lower(split_part(p.email, '@', 1)) like pe.alias || '%')
order by pe.hint, p.created_at;

drop table if exists _admin;
create temp table _admin as
select id from public.profiles where role = 'admin' and active order by created_at limit 1;

do $$ begin
  if not exists (select 1 from _admin) then
    raise exception 'Primero tiene que entrar a la app al menos una persona (queda como admin).';
  end if;
end $$;

-- ------------------------------------------------------------ proyectos del roadmap
drop table if exists _projects;
create temp table _projects (client text, name text, owner text, status public.project_status,
                             start_date date, end_date date, progress int, description text);
insert into _projects values
  ('Modus Retis', 'Contenido y métricas de Modus Retis', 'Bárbara', 'en_curso', '2026-10-12', '2026-10-30', 0,
   'Planificación de RRSS, contenido nuevo y seguimiento de métricas de la web.'),
  ('Modus Retis', 'Odoo CRM interno', 'Yani', 'planificado', '2026-11-02', '2026-11-27', 0,
   'Implementar Odoo para el seguimiento comercial de Modus Retis. Fechas estimadas: estaba en backlog.'),
  ('Ultragrif', 'Implementación Odoo', 'Mauricio Barrio', 'en_curso', '2026-10-05', '2026-10-23', 35,
   'E-commerce (liberado), módulo de facturación y base de datos para publicar en Meli.'),
  ('Ultragrif', 'Mercado Libre y distribuidoras', 'Yani', 'en_curso', '2026-10-12', '2026-10-23', 0,
   'Catálogo de Ultragrif en Mercado Libre y kit de publicaciones para distribuidoras.'),
  ('Ultragrif', 'Contenido de Instagram', 'Bárbara', 'en_curso', '2026-10-12', '2026-10-23', 0,
   'Revisión del plan de contenido de Instagram.'),
  ('Placebo', 'Dashboards de Mercado Libre', 'Yani', 'en_curso', '2026-10-12', '2026-10-30', 0,
   'Dashboards de planificación, métricas de publicaciones y seguimiento del negocio (ventas, bajas, stock, soporte), con alertas.'),
  ('Placebo', 'Ads y canales de venta', 'Coni', 'en_curso', '2026-10-12', '2026-11-20', 0,
   'Plan de Ads con 15% off por WhatsApp y sumar productos (muebles armados, botineras) a Meli / Tiendanube.'),
  ('Placebo', 'Odoo: módulo de inventario', 'Yani', 'planificado', '2026-11-02', '2026-11-27', 0,
   'Fechas estimadas: estaba en backlog.'),
  ('Placebo', 'Página de obra', 'Coni', 'planificado', '2026-11-02', '2026-11-27', 0,
   'Fechas estimadas: estaba en backlog.'),
  ('Odoo', 'Comercial Odoo', 'Lytton', 'en_curso', '2026-10-12', '2026-10-23', 0,
   'Reunión con Daniel Ciudad y recontacto de leads.'),
  ('Meli Retis', 'Puesta en marcha de la cuenta', 'Lytton', 'en_curso', '2026-10-12', '2026-10-23', 0,
   'Definir PO y quién gestiona las redes.');

insert into public.projects (client_id, name, description, status, start_date, end_date, progress, owner_id, created_by)
select c.id, pr.name, pr.description, pr.status, pr.start_date, pr.end_date, pr.progress,
       w.id, (select id from _admin)
from _projects pr
join public.clients c on c.name = pr.client
left join _who w on w.hint = pr.owner
where not exists (select 1 from public.projects x where x.client_id = c.id and x.name = pr.name);

-- ------------------------------------------------------------ tareas
-- semana = lunes de la semana planificada (inicio); vence el viernes de esa semana. Sin semana = backlog, sin fechas.
drop table if exists _tasks;
create temp table _tasks (client text, person text, week date, title text, status text, project text);
insert into _tasks values
  ('Modus Retis', 'Bárbara', '2026-10-12', 'Planificación de contenido en RRSS para octubre', 'planificado', 'Contenido y métricas de Modus Retis'),
  ('Modus Retis', 'Bárbara', '2026-10-12', 'Seguimiento de métricas de la página web. Conectar a Metricool', 'planificado', 'Contenido y métricas de Modus Retis'),
  ('Modus Retis', 'Yani', null, 'Implementar Odoo para seguimiento de CRM', 'backlog', 'Odoo CRM interno'),
  ('Modus Retis', 'Lytton', null, 'Reunión de equipo presencial', 'backlog', null),
  ('Modus Retis', 'Maxi', '2026-10-19', 'Desarrollar nuevo contenido para las redes de Modus Retis', 'planificado', 'Contenido y métricas de Modus Retis'),
  ('Ultragrif', 'Mauricio Barrio', '2026-10-05', 'Liberación de página y módulo de e-commerce de Odoo', 'ejecutado', 'Implementación Odoo'),
  ('Ultragrif', 'Sin asignar', '2026-10-05', 'Reunión con Foskia', 'ejecutado', null),
  ('Ultragrif', 'Mauricio Barrio', '2026-10-12', 'Empezar con la implementación del módulo de facturación de Odoo', 'planificado', 'Implementación Odoo'),
  ('Ultragrif', 'Mauricio Barrio', '2026-10-19', 'Revisión de base de datos para publicación en Meli sobre Odoo', 'planificado', 'Implementación Odoo'),
  ('Ultragrif', 'Yani', '2026-10-12', 'Implementación de catálogo de Ultragrif en Mercado Libre', 'planificado', 'Mercado Libre y distribuidoras'),
  ('Ultragrif', 'Yani', '2026-10-12', 'Armado de kit de publicaciones para distribuidoras de Ultragrif', 'planificado', 'Mercado Libre y distribuidoras'),
  ('Ultragrif', 'Bárbara', '2026-10-12', 'Revisión de plan de contenido de Instagram de Ultragrif', 'planificado', 'Contenido de Instagram'),
  ('Placebo', 'Yani', '2026-10-12', 'Desarrollo de dashboard de planificación', 'planificado', 'Dashboards de Mercado Libre'),
  ('Placebo', 'Yani', '2026-10-12', 'Desarrollo de dashboard de métricas de publicaciones de Mercado Libre', 'planificado', 'Dashboards de Mercado Libre'),
  ('Placebo', 'Yani', '2026-10-12', 'Desarrollo de dashboard de seguimiento de negocio de la cuenta de Mercado Libre (ventas, bajas, stock, soporte)', 'planificado', 'Dashboards de Mercado Libre'),
  ('Placebo', 'Yani', null, 'Implementación de Odoo: módulo de inventario', 'backlog', 'Odoo: módulo de inventario'),
  ('Placebo', 'Coni', '2026-10-12', 'Implementar alertas del dashboard', 'planificado', 'Dashboards de Mercado Libre'),
  ('Placebo', 'Coni', '2026-10-12', 'Revisión del plan de Ads: sumar 15% off redirigido a WhatsApp con transferencia, para combos en ambas; analizar logística para aplicar el 15%', 'planificado', 'Ads y canales de venta'),
  ('Placebo', 'Coni', null, 'Avanzar con la página de obra', 'backlog', 'Página de obra'),
  ('Placebo', 'Coni', null, 'Incorporar muebles armados en Meli / Tiendanube', 'backlog', 'Ads y canales de venta'),
  ('Placebo', 'Coni', null, 'Incorporar botineras en Meli / Tiendanube', 'backlog', 'Ads y canales de venta'),
  ('Odoo', 'Lytton', '2026-10-12', 'Lanzar reunión con Daniel Ciudad', 'planificado', 'Comercial Odoo'),
  ('Odoo', 'Lytton', '2026-10-12', 'Volver a contactar a los leads de Odoo', 'planificado', 'Comercial Odoo'),
  ('Meli Retis', 'Lytton', '2026-10-12', 'Definir quién es el PO de la cuenta', 'planificado', 'Puesta en marcha de la cuenta'),
  ('Meli Retis', 'Lytton', '2026-10-12', 'Definir quién gestiona las redes de Meli Retis', 'planificado', 'Puesta en marcha de la cuenta');

insert into public.tasks (title, description, client_id, project_id, assignee_id, created_by, status, priority, start_date, due_date)
select t.title,
       case when w.id is null then 'Responsable en el planning: ' || t.person else '' end,
       c.id, p.id,
       coalesce(w.id, (select id from _admin)),
       (select id from _admin),
       (case t.status when 'ejecutado' then 'hecha' when 'encurso' then 'en_curso' when 'demorado' then 'bloqueada' else 'pendiente' end)::public.task_status,
       'media',
       t.week, t.week + 4
from _tasks t
join public.clients c on c.name = t.client
left join public.projects p on p.client_id = c.id and p.name = t.project
left join _who w on w.hint = t.person
where not exists (select 1 from public.tasks x where x.client_id = c.id and x.title = t.title);

-- Tareas que quedaron a nombre del admin: si la persona ya entró a la app, se las pasa
update public.tasks t
set assignee_id = w.id, description = ''
from _who w
where t.description = 'Responsable en el planning: ' || w.hint;

-- Proyectos sin su responsable real todavía (vacíos o a nombre del admin por sus tareas): pasa a ser el principal
update public.projects pr
set owner_id = w.id,
    owner_ids = public.uniq_ids(array[w.id] || array_remove(pr.owner_ids, (select id from _admin)) ||
      case when exists (select 1 from public.tasks t where t.project_id = pr.id and (select id from _admin) = any (t.assignee_ids))
           then array[(select id from _admin)] else '{}'::uuid[] end)
from _projects x
join public.clients c on c.name = x.client
join _who w on w.hint = x.owner
where pr.client_id = c.id and pr.name = x.name
  and (pr.owner_id is null or (pr.owner_id = (select id from _admin) and w.id <> pr.owner_id));

-- Resumen
select (select count(*) from public.projects) as proyectos,
       (select count(*) from public.tasks) as tareas,
       (select count(*) from public.tasks where description like 'Responsable en el planning:%') as tareas_esperando_a_su_responsable;
