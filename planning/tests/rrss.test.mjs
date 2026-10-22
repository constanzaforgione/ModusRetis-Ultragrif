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
  for (const f of ["migrations/0001_init.sql", "seed.sql", "migrations/0002_horarios_repeticion_asignacion.sql", "migrations/0003_avisos.sql", "migrations/0004_varios_responsables.sql", "migrations/0005_rrss.sql", "migrations/0006_publicacion.sql"])
    await db.exec(read(f));
  await db.exec(read("migrations/0005_rrss.sql")); // se pueden volver a correr
  await db.exec(read("migrations/0006_publicacion.sql"));
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

test("programar una pieza crea su publicación por red; desprogramarla la cancela", async () => {
  const db = await setup();
  const id = (await as(db, MEMBER, piece, [["instagram", "tiktok"], MEMBER, MEMBER])).rows[0].id;
  const pubs = async () => (await db.query(`select network, status, scheduled_at::text at from public.social_publications where post_id = $1 order by network`, [id])).rows;
  assert.equal((await pubs()).length, 0);
  await as(db, MEMBER, `update public.social_posts set status = 'programada', publish_time = '18:30' where id = $1`, [id]);
  let p = await pubs();
  assert.deepEqual(p.map((x) => [x.network, x.status]), [["instagram", "pendiente"], ["tiktok", "pendiente"]]);
  assert.match(p[0].at, /^2026-11-03 21:30:00/); // 18:30 en Argentina = 21:30 UTC

  // cambia la hora y saca TikTok: se reprograma y se borra la de TikTok
  await db.query(`update public.social_publications set status = 'error', attempts = 3 where post_id = $1 and network = 'instagram'`, [id]);
  await as(db, MEMBER, `update public.social_posts set publish_time = '09:00', networks = '{instagram}' where id = $1`, [id]);
  p = await pubs();
  assert.deepEqual(p.map((x) => [x.network, x.status]), [["instagram", "pendiente"]]);
  assert.match(p[0].at, /^2026-11-03 12:00:00/);

  // una ya publicada no se toca; volver a "aprobada" cancela lo pendiente
  await db.query(`update public.social_publications set status = 'publicada' where post_id = $1`, [id]);
  await as(db, MEMBER, `update public.social_posts set status = 'aprobada' where id = $1`, [id]);
  assert.deepEqual((await pubs()).map((x) => x.status), ["publicada"]);

  // material y marca manual: solo quien puede editar la pieza
  await as(db, MEMBER, `insert into public.social_media (post_id, path, url, kind) values ($1, 'a.jpg', 'https://x/a.jpg', 'image')`, [id]);
  await assert.rejects(as(db, OTHER, `insert into public.social_media (post_id, path, url, kind) values ($1, 'b.jpg', 'https://x/b.jpg', 'image')`, [id]), /row-level security/);
  assert.equal((await as(db, OTHER, `update public.social_publications set status = 'manual' where post_id = $1 returning id`, [id])).rows.length, 0);
});

test("las credenciales de las cuentas no se pueden leer desde la app", async () => {
  const db = await setup();
  const c = (await db.query(`select id from public.clients where name = 'Ultragrif'`)).rows[0].id;
  const acc = (await db.query(`insert into public.social_accounts (client_id, network, external_id, name) values ($1, 'instagram', '178', 'ultragrif') returning id`, [c])).rows[0].id;
  await db.query(`insert into public.social_account_tokens (account_id, access_token) values ($1, 'secreto')`, [acc]);
  assert.equal((await as(db, ADMIN, `select count(*)::int n from public.social_accounts`)).rows[0].n, 1);
  assert.equal((await as(db, ADMIN, `select count(*)::int n from public.social_account_tokens`)).rows[0].n, 0);
  assert.equal((await as(db, MEMBER, `delete from public.social_accounts returning id`)).rows.length, 0);
  assert.equal((await as(db, LEAD, `delete from public.social_accounts returning id`)).rows.length, 1);
  assert.equal((await db.query(`select count(*)::int n from public.social_account_tokens`)).rows[0].n, 0);
});

test("avisos de una pieza: uno por tipo y día", async () => {
  const db = await setup();
  const id = (await as(db, MEMBER, piece, [["instagram"], MEMBER, MEMBER])).rows[0].id;
  await db.query(`select public.push_post_notification($1, $2, 'publicacion_error', 'No se pudo publicar')`, [MEMBER, id]);
  await db.query(`select public.push_post_notification($1, $2, 'publicacion_error', 'Otra vez')`, [MEMBER, id]);
  const n = (await db.query(`select message from public.notifications where post_id = $1`, [id])).rows;
  assert.deepEqual(n.map((x) => x.message), ["Otra vez"]);
});

test("cuando sale en todas las redes la pieza queda publicada con el link", async () => {
  const db = await setup();
  const id = (await as(db, MEMBER, piece, [["instagram", "linkedin"], MEMBER, MEMBER])).rows[0].id;
  await as(db, MEMBER, `update public.social_posts set status = 'programada' where id = $1`, [id]);
  await db.query(`update public.social_publications set status = 'publicada', permalink = 'https://instagram.com/p/1' where post_id = $1 and network = 'instagram'`, [id]);
  assert.equal((await db.query(`select status from public.social_posts where id = $1`, [id])).rows[0].status, "programada");
  // la de LinkedIn se marca a mano
  await as(db, MEMBER, `update public.social_publications set status = 'publicada', permalink = 'https://linkedin.com/x' where post_id = $1 and network = 'linkedin'`, [id]);
  const p = (await db.query(`select status, post_url from public.social_posts where id = $1`, [id])).rows[0];
  assert.deepEqual(p, { status: "publicada", post_url: "https://linkedin.com/x" });
  assert.equal((await db.query(`select count(*)::int n from public.social_publications where post_id = $1`, [id])).rows[0].n, 2);
});
