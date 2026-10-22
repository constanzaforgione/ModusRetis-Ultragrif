// Calendario de redes (supabase/migrations/0005_rrss.sql)
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
  for (const f of ["migrations/0001_init.sql", "seed.sql", "migrations/0002_horarios_repeticion_asignacion.sql", "migrations/0003_avisos.sql", "migrations/0004_varios_responsables.sql", "migrations/0005_rrss.sql"])
    await db.exec(read(f));
  await db.exec(read("migrations/0005_rrss.sql")); // se puede volver a correr
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
const piece = `insert into public.social_posts (client_id, publish_date, networks, format, title, assignee_id, created_by)
  values ((select id from public.clients where name = 'Ultragrif'), '2026-11-03', $1, 'reel', 'Lanzamiento', $2, $3) returning id`;

test("clientes con calendario de redes", async () => {
  const db = await setup();
  const r = await db.query(`select name from public.clients where social order by name`);
  assert.deepEqual(r.rows.map((x) => x.name), ["Confort Iván", "Modus Retis", "Ultragrif"]);
});

test("piezas: cualquiera programa a su nombre, edita lo suyo, borra solo admin", async () => {
  const db = await setup();
  const id = (await as(db, MEMBER, piece, [["instagram", "tiktok"], MEMBER, MEMBER])).rows[0].id;
  await assert.rejects(as(db, MEMBER, piece, [["instagram"], OTHER, MEMBER]), /row-level security/);
  await assert.rejects(as(db, MEMBER, piece, [["facebook"], MEMBER, MEMBER]), /social_posts_networks/);
  await assert.rejects(as(db, MEMBER, piece, [[], MEMBER, MEMBER]), /social_posts_networks/);

  // el líder programa para otra persona; un compañero de otro equipo no puede tocarla
  const id2 = (await as(db, LEAD, piece, [["linkedin"], OTHER, LEAD])).rows[0].id;
  assert.equal((await as(db, MEMBER, `update public.social_posts set title = 'X' where id = $1 returning id`, [id2])).rows.length, 0);
  assert.equal((await as(db, OTHER, `update public.social_posts set status = 'aprobada' where id = $1 returning id`, [id2])).rows.length, 1);
  // tampoco se la puede pasar a otra persona
  await assert.rejects(as(db, MEMBER, `update public.social_posts set assignee_id = $2 where id = $1`, [id, OTHER]), /row-level security/);
  // el líder edita la de su equipo
  assert.equal((await as(db, LEAD, `update public.social_posts set status = 'programada' where id = $1 returning id`, [id])).rows.length, 1);

  assert.equal((await as(db, MEMBER, `delete from public.social_posts where id = $1 returning id`, [id])).rows.length, 0);
  assert.equal((await as(db, ADMIN, `delete from public.social_posts where id = $1 returning id`, [id])).rows.length, 1);
  assert.equal((await as(db, OTHER, `select count(*)::int n from public.social_posts`)).rows[0].n, 1);
});
