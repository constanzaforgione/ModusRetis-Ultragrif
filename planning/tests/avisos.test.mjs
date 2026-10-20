// Avisos generados por la base (supabase/migrations/0003_avisos.sql y 0004_varios_responsables.sql)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), "utf8");
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const LEAD = "00000000-0000-0000-0000-00000000000b";
const MEMBER = "00000000-0000-0000-0000-00000000000c";
const OTHER = "00000000-0000-0000-0000-00000000000d";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const f of ["migrations/0001_init.sql", "migrations/0002_horarios_repeticion_asignacion.sql", "migrations/0003_avisos.sql", "migrations/0004_varios_responsables.sql", "seed.sql"]) await db.exec(read(f));
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant all on all tables in schema public to authenticated;
    grant execute on all functions in schema public, auth to authenticated;
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'a@x.com', '{"full_name":"Coni"}'), ('${LEAD}', 'l@x.com', '{"full_name":"Lytton"}'),
      ('${MEMBER}', 'm@x.com', '{"full_name":"Yani"}'), ('${OTHER}', 'o@x.com', '{"full_name":"Maxi"}');
    update public.profiles set role = 'lider' where id = '${LEAD}';
    update public.profiles set lead_id = '${LEAD}' where id = '${MEMBER}';
  `);
  return db;
}
async function as(db, uid, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const notes = async (db, uid) => (await db.query(`select kind, message from public.notifications where user_id = $1 order by created_at`, [uid])).rows;

test("asignación, cambios, reasignación, completada y bloqueada", async () => {
  const db = await setup();
  const t = (await as(db, LEAD, `insert into public.tasks (title, assignee_id, created_by, due_date) values ('Kit Ultragrif', $1, $2, '2026-10-24') returning id`, [MEMBER, LEAD])).rows[0].id;
  let n = await notes(db, MEMBER);
  assert.equal(n[0].kind, "asignada");
  assert.match(n[0].message, /Lytton te asignó «Kit Ultragrif» · vence 24 oct/);

  // cambios hechos por otro y por uno mismo: un solo aviso de "cambio" por día, con lo último
  await as(db, LEAD, `update public.tasks set status = 'en_curso', due_date = '2026-10-25' where id = $1`, [t]);
  n = await notes(db, MEMBER);
  assert.match(n.find((x) => x.kind === "cambio").message, /Lytton cambió estado: Pendiente → En curso, vence → 25 oct en «Kit Ultragrif»/);
  await as(db, MEMBER, `update public.tasks set title = 'Kit distribuidoras' where id = $1`, [t]);
  n = await notes(db, MEMBER);
  assert.equal(n.filter((x) => x.kind === "cambio").length, 1);
  assert.match(n.find((x) => x.kind === "cambio").message, /^Cambiaste título → «Kit distribuidoras»/);

  // bloqueada: le avisa al líder; hecha: le avisa a quien la creó
  await as(db, MEMBER, `update public.tasks set status = 'bloqueada' where id = $1`, [t]);
  assert.ok((await notes(db, LEAD)).some((x) => x.kind === "equipo_bloqueada" && /Yani está bloqueado/.test(x.message)));
  await as(db, MEMBER, `update public.tasks set status = 'hecha' where id = $1`, [t]);
  assert.ok((await notes(db, LEAD)).some((x) => x.kind === "completada" && /Yani terminó «Kit distribuidoras»/.test(x.message)));

  // reasignación: aviso a quien la tenía y asignación a la nueva persona
  await as(db, LEAD, `update public.tasks set assignee_id = $2 where id = $1`, [t, OTHER]);
  assert.ok((await notes(db, MEMBER)).some((x) => x.kind === "reasignada" && /Lytton te sacó de «Kit distribuidoras» \(ahora: Maxi\)/.test(x.message)));
  assert.ok((await notes(db, OTHER)).some((x) => x.kind === "asignada"));

  // cada uno ve solo sus avisos
  const seen = await as(db, OTHER, `select count(*)::int n from public.notifications`);
  assert.equal(seen.rows[0].n, (await notes(db, OTHER)).length);
});

test("proyectos: responsable, cambios y tareas nuevas en el proyecto", async () => {
  const db = await setup();
  const c = (await db.query(`select id from public.clients where name = 'Placebo'`)).rows[0].id;
  const p = (await as(db, LEAD, `insert into public.projects (client_id, name, start_date, end_date, owner_id) values ($1, 'Dashboards', '2026-10-01', '2026-11-30', $2) returning id`, [c, MEMBER])).rows[0].id;
  assert.equal((await notes(db, MEMBER))[0].kind, "proyecto_asignado");
  await as(db, LEAD, `update public.projects set end_date = '2026-12-15', status = 'en_curso' where id = $1`, [p]);
  assert.match((await notes(db, MEMBER)).find((x) => x.kind === "proyecto_cambio").message, /Lytton cambió estado: Planificado → En curso, fin → 15 dic/);
  // cambiar solo el avance (lo calcula la app) no avisa
  const before = (await notes(db, MEMBER)).length;
  await as(db, LEAD, `update public.projects set progress = 50 where id = $1`, [p]);
  assert.equal((await notes(db, MEMBER)).length, before);
  await as(db, OTHER, `insert into public.tasks (title, assignee_id, created_by, project_id) values ('Alertas', $1, $1, $2)`, [OTHER, p]);
  assert.ok((await notes(db, MEMBER)).some((x) => x.kind === "tarea_en_proyecto" && /Maxi sumó «Alertas» a tu proyecto/.test(x.message)));
});

test("avisos del día: vence hoy, venció ayer y proyectos, sin duplicar", async () => {
  const db = await setup();
  const today = (await db.query(`select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text d`)).rows[0].d;
  await db.query(`insert into public.tasks (title, assignee_id, created_by, due_date) values ('Hoy', $1, $1, $2::date), ('Ayer', $1, $1, $2::date - 1), ('Hecha', $1, $1, $2::date)`, [MEMBER, today]);
  await db.query(`update public.tasks set status = 'hecha' where title = 'Hecha'`);
  const c = (await db.query(`select id from public.clients limit 1`)).rows[0].id;
  await db.query(`insert into public.projects (client_id, name, start_date, end_date, owner_id) values ($1, 'P', $2::date - 30, $2::date + 3, $3)`, [c, today, MEMBER]);
  await db.query(`delete from public.notifications`);
  const first = (await as(db, MEMBER, `select public.daily_notifications() n`)).rows[0].n;
  assert.equal(first, 4); // vence_hoy, vencio, equipo_vencida (al líder), proyecto_por_terminar
  const again = (await as(db, MEMBER, `select public.daily_notifications() n`)).rows[0].n;
  assert.equal(again, 0);
  assert.deepEqual((await notes(db, MEMBER)).map((x) => x.kind).sort(), ["proyecto_por_terminar", "vence_hoy", "vencio"]);
  assert.deepEqual((await notes(db, LEAD)).map((x) => x.kind), ["equipo_vencida"]);
});

test("varios responsables: sincroniza, permisos, avisos y responsables del proyecto", async () => {
  const db = await setup();
  const c = (await db.query(`select id from public.clients where name = 'Ultragrif'`)).rows[0].id;
  const p = (await as(db, LEAD, `insert into public.projects (client_id, name, start_date, end_date, owner_id) values ($1, 'Kit', '2026-10-01', '2026-11-30', $2) returning id`, [c, LEAD])).rows[0].id;
  assert.deepEqual((await db.query(`select owner_ids from public.projects where id = $1`, [p])).rows[0].owner_ids, [LEAD]);

  // un líder crea una tarea para dos personas: assignee_id queda en la primera y ambas reciben aviso
  const t = (await as(db, LEAD, `insert into public.tasks (title, assignee_id, assignee_ids, created_by, project_id) values ('Folleto', $1, $2, $3, $4) returning id`, [MEMBER, [MEMBER, OTHER], LEAD, p])).rows[0].id;
  let row = (await db.query(`select assignee_id, assignee_ids from public.tasks where id = $1`, [t])).rows[0];
  assert.equal(row.assignee_id, MEMBER);
  assert.deepEqual(row.assignee_ids, [MEMBER, OTHER]);
  assert.match((await notes(db, OTHER)).find((x) => x.kind === "asignada").message, /Lytton te asignó «Folleto» \(junto con 1 más\)/);

  // las personas de la tarea pasan a ser responsables del proyecto, con aviso
  assert.deepEqual((await db.query(`select owner_ids from public.projects where id = $1`, [p])).rows[0].owner_ids, [LEAD, MEMBER, OTHER]);
  assert.match((await notes(db, OTHER)).find((x) => x.kind === "proyecto_asignado").message, /porque tenés tareas en el proyecto/);

  // OTHER (de otro equipo) es co-responsable: puede editarla
  const upd = await as(db, OTHER, `update public.tasks set status = 'en_curso' where id = $1 returning id`, [t]);
  assert.equal(upd.rows.length, 1);
  assert.match((await notes(db, MEMBER)).find((x) => x.kind === "cambio").message, /Maxi cambió estado: Pendiente → En curso/);

  // un miembro no puede sumar a otra persona
  await assert.rejects(as(db, MEMBER, `update public.tasks set assignee_ids = $2 where id = $1`, [t, [MEMBER, OTHER, ADMIN]]), /Solo admins y líderes/);
  await assert.rejects(
    as(db, MEMBER, `insert into public.tasks (title, assignee_id, assignee_ids, created_by) values ('X', $1, $2, $1)`, [MEMBER, [MEMBER, OTHER]]),
    /Solo admins y líderes/,
  );

  // sacar a alguien: le avisa y el principal se reacomoda
  await as(db, LEAD, `update public.tasks set assignee_ids = $2 where id = $1`, [t, [OTHER]]);
  row = (await db.query(`select assignee_id, assignee_ids from public.tasks where id = $1`, [t])).rows[0];
  assert.equal(row.assignee_id, OTHER);
  assert.match((await notes(db, MEMBER)).find((x) => x.kind === "reasignada").message, /Lytton te sacó de «Folleto» \(ahora: Maxi\)/);

  // cambiar solo assignee_id (app vieja / dictado) reemplaza en la lista
  await as(db, LEAD, `update public.tasks set assignee_id = $2 where id = $1`, [t, ADMIN]);
  assert.deepEqual((await db.query(`select assignee_ids from public.tasks where id = $1`, [t])).rows[0].assignee_ids, [ADMIN]);

  // proyecto con varios responsables elegidos a mano
  await as(db, LEAD, `update public.projects set owner_ids = $2 where id = $1`, [p, [ADMIN, LEAD]]);
  assert.equal((await db.query(`select owner_id from public.projects where id = $1`, [p])).rows[0].owner_id, ADMIN);
});

test("avisos del día para cada responsable", async () => {
  const db = await setup();
  const today = (await db.query(`select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text d`)).rows[0].d;
  await db.query(`insert into public.tasks (title, assignee_id, assignee_ids, created_by, due_date) values ('Hoy', $1, $2, $1, $3::date)`, [MEMBER, [MEMBER, OTHER], today]);
  await db.query(`delete from public.notifications`);
  await as(db, MEMBER, `select public.daily_notifications()`);
  assert.deepEqual((await notes(db, MEMBER)).map((x) => x.kind), ["vence_hoy"]);
  assert.deepEqual((await notes(db, OTHER)).map((x) => x.kind), ["vence_hoy"]);
});
