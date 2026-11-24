// Registro de borrados (supabase/migrations/0013_registro_borrados.sql)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MEMBER = "00000000-0000-0000-0000-00000000000c";

test("queda registro de quién borró qué, solo lo ven admins y nadie lo puede tocar", async () => {
  const db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  for (const f of ["0001_init.sql", "0002_horarios_repeticion_asignacion.sql", "0003_avisos.sql", "0004_varios_responsables.sql", "0005_rrss.sql", "0012_reemplazar_calendario.sql", "0013_registro_borrados.sql", "0013_registro_borrados.sql"]) await db.exec(read(f));
  await db.exec(`grant usage on schema public, auth to authenticated; grant select, insert, update, delete on public.social_posts, public.tasks, public.projects, public.clients to authenticated; grant execute on all functions in schema public, auth to authenticated;
    insert into auth.users (id, email, raw_user_meta_data) values ('${ADMIN}', 'a@x', '{"full_name":"Coni"}'), ('${MEMBER}', 'm@x', '{"full_name":"Barbi"}');`);
  const as = async (u, sql, p = []) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${u}', false);`);
    try { return await db.query(sql, p); } finally { await db.exec("reset role"); }
  };
  const c = (await db.query(`insert into public.clients (name, color) values ('Confort', '#000') returning id`)).rows[0].id;
  const p = (await as(MEMBER, `insert into public.social_posts (client_id, publish_date, title, networks, assignee_id, created_by) values ($1, '2026-11-05', 'Reel mesas', array['instagram'], $2, $2) returning id`, [c, MEMBER])).rows[0].id;

  // Barbi borra una pieza (al reemplazar un calendario): queda registrado
  assert.equal((await as(MEMBER, `delete from public.social_posts where id = $1 returning id`, [p])).rows.length, 1);
  const log = (await db.query(`select table_name, row_id, client_id, title, deleted_by, row_data->>'publish_date' d from public.deletion_log`)).rows;
  assert.deepEqual(log, [{ table_name: "social_posts", row_id: p, client_id: c, title: "Reel mesas", deleted_by: MEMBER, d: "2026-11-05" }]);

  // Lo ve un admin; un miembro no
  assert.equal((await as(ADMIN, `select * from public.deletion_log`)).rows.length, 1);
  assert.equal((await as(MEMBER, `select * from public.deletion_log`)).rows.length, 0);
  // Nadie lo puede cambiar, borrar ni inventar desde la app
  await assert.rejects(as(ADMIN, `delete from public.deletion_log`));
  await assert.rejects(as(ADMIN, `update public.deletion_log set title = 'x'`));
  await assert.rejects(as(ADMIN, `insert into public.deletion_log (table_name, row_data) values ('x', '{}')`));

  // Borrar un cliente deja registro del cliente y de lo que se borra en cascada
  await db.query(`insert into public.projects (client_id, name, start_date, end_date) values ($1, 'Catálogo', '2026-11-01', '2026-12-01')`, [c]);
  await as(ADMIN, `delete from public.clients where id = $1`, [c]);
  const kinds = (await db.query(`select table_name, title, deleted_by from public.deletion_log order by id`)).rows.map((r) => [r.table_name, r.title, r.deleted_by]);
  assert.deepEqual(kinds.slice(1).sort(), [["clients", "Confort", ADMIN], ["projects", "Catálogo", ADMIN]]);
});
