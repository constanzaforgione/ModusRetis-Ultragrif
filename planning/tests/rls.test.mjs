// Prueba los permisos (RLS) del esquema contra Postgres embebido (PGlite).
// Simula lo mínimo de Supabase: esquema auth, auth.uid() y el rol "authenticated".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const schema = readFileSync(new URL("../supabase/migrations/0001_init.sql", import.meta.url), "utf8");
const seed = readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8");

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const LEAD = "00000000-0000-0000-0000-00000000000b";
const MEMBER = "00000000-0000-0000-0000-00000000000c";
const OTHER = "00000000-0000-0000-0000-00000000000d"; // miembro de otro equipo

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await db.exec(schema);
  await db.exec(seed);
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant all on all tables in schema public to authenticated;
    grant execute on all functions in schema public, auth to authenticated;
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'admin@modusretis.com', '{"full_name":"Admin"}'),
      ('${LEAD}', 'lider@modusretis.com', '{"full_name":"Líder"}'),
      ('${MEMBER}', 'miembro@modusretis.com', '{"full_name":"Miembro"}'),
      ('${OTHER}', 'otro@modusretis.com', '{"full_name":"Otro"}');
    update public.profiles set role = 'lider' where id = '${LEAD}';
    update public.profiles set lead_id = '${LEAD}' where id = '${MEMBER}';
  `);
  return db;
}

// Ejecuta `sql` como el usuario `uid` (rol authenticated, con RLS)
async function as(db, uid, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

const newTask = (assignee) =>
  [`insert into public.tasks (title, assignee_id, created_by) values ('T', $1, $1) returning id`, [assignee]];

test("la primera persona queda admin y el resto miembro", async () => {
  const db = await setup();
  const { rows } = await db.query(`select id, role from public.profiles order by id`);
  assert.equal(rows.find((r) => r.id === ADMIN).role, "admin");
  assert.equal(rows.find((r) => r.id === OTHER).role, "miembro");
});

test("un miembro crea y edita sus tareas, pero no las de otros", async () => {
  const db = await setup();
  const mine = await as(db, MEMBER, ...newTask(MEMBER));
  const id = mine.rows[0].id;
  const upd = await as(db, MEMBER, `update public.tasks set status = 'hecha' where id = $1 returning completed_at`, [id]);
  assert.equal(upd.rows.length, 1);
  assert.ok(upd.rows[0].completed_at, "completed_at se completa al cerrar");

  await assert.rejects(as(db, MEMBER, ...newTask(OTHER)), /row-level security/);

  const others = await as(db, OTHER, ...newTask(OTHER));
  const touched = await as(db, MEMBER, `update public.tasks set title = 'X' where id = $1 returning id`, [others.rows[0].id]);
  assert.equal(touched.rows.length, 0, "no puede modificar la tarea de un compañero");

  // tampoco puede "regalarle" su tarea a otra persona
  await assert.rejects(
    as(db, MEMBER, `update public.tasks set assignee_id = $2 where id = $1`, [id, OTHER]),
    /row-level security/,
  );
  // pero sí puede ver todas
  const all = await as(db, MEMBER, `select count(*)::int as n from public.tasks`);
  assert.equal(all.rows[0].n, 2);
});

test("nadie salvo admin borra tareas", async () => {
  const db = await setup();
  const t = await as(db, MEMBER, ...newTask(MEMBER));
  const id = t.rows[0].id;
  for (const uid of [MEMBER, LEAD]) {
    const del = await as(db, uid, `delete from public.tasks where id = $1 returning id`, [id]);
    assert.equal(del.rows.length, 0);
  }
  const del = await as(db, ADMIN, `delete from public.tasks where id = $1 returning id`, [id]);
  assert.equal(del.rows.length, 1);
});

test("un líder gestiona las tareas de su equipo y no las de otros equipos", async () => {
  const db = await setup();
  const t = await as(db, LEAD, ...newTask(MEMBER));
  const upd = await as(db, LEAD, `update public.tasks set priority = 'urgente' where id = $1 returning id`, [t.rows[0].id]);
  assert.equal(upd.rows.length, 1);
  await assert.rejects(as(db, LEAD, ...newTask(OTHER)), /row-level security/);

  // al miembro le llega el aviso de asignación
  const n = await as(db, MEMBER, `select kind from public.notifications`);
  assert.deepEqual(n.rows.map((r) => r.kind), ["asignada"]);
  const nOther = await as(db, OTHER, `select count(*)::int as n from public.notifications`);
  assert.equal(nOther.rows[0].n, 0);
});

test("roadmap y clientes: solo admin/líder editan", async () => {
  const db = await setup();
  await assert.rejects(
    as(db, MEMBER, `insert into public.clients (name) values ('Nuevo')`),
    /row-level security/,
  );
  await as(db, LEAD, `insert into public.clients (name) values ('Nuevo')`);
  const c = await db.query(`select id from public.clients where name = 'Ultragrif'`);
  const ins = `insert into public.projects (client_id, name, start_date, end_date) values ($1, 'P', '2026-10-01', '2026-12-01')`;
  await assert.rejects(as(db, MEMBER, ins, [c.rows[0].id]), /row-level security/);
  await as(db, LEAD, ins, [c.rows[0].id]);
  const del = await as(db, LEAD, `delete from public.clients where name = 'Nuevo' returning id`);
  assert.equal(del.rows.length, 0, "el líder no borra clientes");
});

test("solo admin cambia roles", async () => {
  const db = await setup();
  await assert.rejects(
    as(db, MEMBER, `update public.profiles set role = 'admin' where id = $1`, [MEMBER]),
    /Solo un admin/,
  );
  const ok = await as(db, MEMBER, `update public.profiles set full_name = 'Nuevo nombre' where id = $1 returning id`, [MEMBER]);
  assert.equal(ok.rows.length, 1);
  await as(db, ADMIN, `update public.profiles set role = 'lider' where id = $1`, [OTHER]);
});
