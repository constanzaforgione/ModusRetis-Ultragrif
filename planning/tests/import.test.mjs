// El import del planning de Lytton: carga todo, no duplica al re-correrlo y reasigna cuando la persona entra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), "utf8");

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await db.exec(read("migrations/0001_init.sql"));
  await db.exec(read("migrations/0002_horarios_repeticion_asignacion.sql"));
  await db.exec(read("migrations/0003_avisos.sql"));
  await db.exec(read("migrations/0004_varios_responsables.sql"));
  await db.exec(read("seed.sql"));
  return db;
}
const user = (db, id, email, name) =>
  db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('full_name', $3::text))`, [id, email, name]);

test("importa proyectos y tareas, sin duplicar, y reasigna al re-correr", async () => {
  const db = await setup();
  await assert.rejects(db.exec(read("import_planning_lytton.sql")), /al menos una persona/);

  await user(db, "00000000-0000-0000-0000-000000000001", "c.forgione@modusretis.com", "Constanza Forgione");
  await user(db, "00000000-0000-0000-0000-000000000002", "barbara@modusretis.com", "Bárbara");
  await db.exec(read("import_planning_lytton.sql"));

  const n = async (sql) => (await db.query(sql)).rows[0].n;
  assert.equal(await n(`select count(*)::int n from public.projects`), 11);
  assert.equal(await n(`select count(*)::int n from public.tasks`), 25);
  assert.equal(await n(`select count(*)::int n from public.tasks where status = 'hecha'`), 2);
  assert.equal(await n(`select count(*)::int n from public.tasks where project_id is null`), 2);
  // Coni y Bárbara ya están; el resto queda a nombre del admin (Coni) con nota
  assert.equal(await n(`select count(*)::int n from public.tasks t join public.profiles p on p.id = t.assignee_id where p.full_name = 'Bárbara'`), 3);
  assert.equal(await n(`select count(*)::int n from public.tasks where description like 'Responsable en el planning: Yani'`), 7);
  const due = await db.query(`select start_date::text s, due_date::text d from public.tasks where title like 'Desarrollar nuevo contenido%'`);
  assert.deepEqual(due.rows[0], { s: "2026-10-19", d: "2026-10-23" });

  // Entra Yani y se vuelve a correr: no duplica y le pasa sus tareas
  await user(db, "00000000-0000-0000-0000-000000000003", "yani@modusretis.com", "Yanina");
  await db.exec(read("import_planning_lytton.sql"));
  assert.equal(await n(`select count(*)::int n from public.tasks`), 25);
  assert.equal(await n(`select count(*)::int n from public.projects`), 11);
  assert.equal(await n(`select count(*)::int n from public.tasks t join public.profiles p on p.id = t.assignee_id where p.full_name = 'Yanina'`), 7);
  assert.equal(await n(`select count(*)::int n from public.projects pr join public.profiles p on p.id = pr.owner_id where p.full_name = 'Yanina'`), 4);
});
