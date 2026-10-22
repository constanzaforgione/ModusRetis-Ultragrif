// Publicación automática (lib/social): cada red con respuestas simuladas de su API, y el publicador completo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { instagram } from "../lib/social/instagram";
import { linkedin, littleText } from "../lib/social/linkedin";
import { tiktok } from "../lib/social/tiktok";
import { runDue, MAX_ATTEMPTS, type Job, type Store, type StoredAccount, type StoredPost } from "../lib/social/runner";
import type { Http, MediaItem, PostToPublish } from "../lib/social/common";

type Call = { method: string; url: string; body: string };
type Route = [method: string, match: RegExp, reply: (c: Call) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }];

/** fetch falso: responde según método + URL y anota cada llamada */
function fakeHttp(routes: Route[]) {
  const calls: Call[] = [];
  const http = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = init.body instanceof URLSearchParams ? init.body.toString() : typeof init.body === "string" ? init.body : init.body ? "<bytes>" : "";
    const call = { method, url, body };
    calls.push(call);
    const route = routes.find(([m, re]) => m === method && re.test(url));
    if (!route) return new Response(JSON.stringify({ error: { message: `sin ruta ${method} ${url}` } }), { status: 404 });
    const r = route[2](call);
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as Http;
  return { http, calls };
}

const post = (p: Partial<PostToPublish> = {}): PostToPublish => ({ id: "p1", title: "Lanzamiento", copy: "Llegó el kit", hashtags: "#ultragrif #obra", format: "post", first_comment: "", ...p });
const img = (n = 1): MediaItem => ({ url: `https://cdn.test/social/p1/${n}.jpg`, kind: "image", mime: "image/jpeg", size_bytes: 1000 });
const vid: MediaItem = { url: "https://cdn.test/social/p1/v.mp4", kind: "video", mime: "video/mp4", size_bytes: 5000 };
const pdf: MediaItem = { url: "https://cdn.test/social/p1/d.pdf", kind: "document", mime: "application/pdf", size_bytes: 3000 };
const acc = { external_id: "178", username: "ultragrif", access_token: "tok" };

// ---------------------------------------------------------------- Instagram
test("instagram: qué se puede publicar solo y qué no", () => {
  assert.equal(instagram.check(post(), [img()]), null);
  assert.match(instagram.check(post(), [])!, /al menos una foto/);
  assert.match(instagram.check(post({ format: "articulo" }), [img()])!, /artículos/);
  assert.match(instagram.check(post(), [{ ...img(), mime: "image/png" }])!, /JPG/);
  assert.match(instagram.check(post(), [img(1), img(2)])!, /Carrusel/);
  assert.equal(instagram.check(post({ format: "carrusel" }), [img(1), img(2), vid]), null);
  assert.match(instagram.check(post({ format: "reel" }), [img()])!, /video/);
});

test("instagram: foto con primer comentario en un solo paso", async () => {
  const { http, calls } = fakeHttp([
    ["POST", /\/178\/media$/, () => ({ json: { id: "c1" } })],
    ["GET", /\/c1\?/, () => ({ json: { status_code: "FINISHED" } })],
    ["POST", /\/178\/media_publish$/, () => ({ json: { id: "m1" } })],
    ["GET", /\/m1\?fields=permalink/, () => ({ json: { permalink: "https://www.instagram.com/p/ABC/" } })],
    ["POST", /\/m1\/comments$/, () => ({ json: { id: "k1" } })],
  ]);
  const r = await instagram.step({ post: post({ first_comment: "Catálogo: https://ultragrif.com.ar" }), media: [img()], account: acc, state: {} }, http);
  assert.deepEqual(r, { kind: "done", external_id: "m1", permalink: "https://www.instagram.com/p/ABC/", message: undefined });
  const create = new URLSearchParams(calls[0].body);
  assert.equal(create.get("image_url"), img().url);
  assert.equal(create.get("caption"), "Llegó el kit\n\n#ultragrif #obra");
  assert.equal(create.get("access_token"), "tok");
  assert.equal(new URLSearchParams(calls.at(-1)!.body).get("message"), "Catálogo: https://ultragrif.com.ar");
});

test("instagram: reel que tarda en procesarse sigue en la vuelta siguiente sin duplicar", async () => {
  let ready = false;
  const { http, calls } = fakeHttp([
    ["POST", /\/178\/media$/, () => ({ json: { id: "c9" } })],
    ["GET", /\/c9\?/, () => ({ json: { status_code: ready ? "FINISHED" : "IN_PROGRESS" } })],
    ["POST", /\/media_publish$/, () => ({ json: { id: "m9" } })],
    ["GET", /\/m9\?/, () => ({ json: { permalink: "https://www.instagram.com/reel/X/" } })],
  ]);
  const r1 = await instagram.step({ post: post({ format: "reel" }), media: [vid], account: acc, state: {} }, http);
  assert.equal(r1.kind, "wait");
  assert.deepEqual((r1 as { state: unknown }).state, { containers: ["c9"] });
  assert.equal(new URLSearchParams(calls[0].body).get("media_type"), "REELS");
  ready = true;
  const r2 = await instagram.step({ post: post({ format: "reel" }), media: [vid], account: acc, state: (r1 as { state: Record<string, unknown> }).state }, http);
  assert.equal(r2.kind, "done");
  assert.equal(calls.filter((c) => c.method === "POST" && /\/178\/media$/.test(c.url)).length, 1);
});

test("instagram: carrusel y stories", async () => {
  let n = 0;
  const { http, calls } = fakeHttp([
    ["POST", /\/178\/media$/, () => ({ json: { id: `c${++n}` } })],
    ["GET", /\/c\d\?/, () => ({ json: { status_code: "FINISHED" } })],
    ["POST", /\/media_publish$/, (c) => ({ json: { id: `m-${new URLSearchParams(c.body).get("creation_id")}` } })],
    ["GET", /\/m-c\d\?/, () => ({ json: { permalink: "https://www.instagram.com/p/C/" } })],
  ]);
  const r = await instagram.step({ post: post({ format: "carrusel" }), media: [img(1), img(2), vid], account: acc, state: {} }, http);
  assert.equal(r.kind, "done");
  const creates = calls.filter((c) => c.method === "POST" && /\/178\/media$/.test(c.url)).map((c) => Object.fromEntries(new URLSearchParams(c.body)));
  assert.equal(creates.length, 4);
  assert.equal(creates[0].is_carousel_item, "true");
  assert.equal(creates[2].media_type, "VIDEO");
  assert.equal(creates[3].media_type, "CAROUSEL");
  assert.equal(creates[3].children, "c1,c2,c3");

  n = 0;
  const s = fakeHttp([
    ["POST", /\/178\/media$/, () => ({ json: { id: `c${++n}` } })],
    ["GET", /\/c\d\?/, () => ({ json: { status_code: "FINISHED" } })],
    ["POST", /\/media_publish$/, (c) => ({ json: { id: `m-${new URLSearchParams(c.body).get("creation_id")}` } })],
    ["GET", /\/m-c\d\?/, () => ({ json: {} })],
  ]);
  const rs = await instagram.step({ post: post({ format: "historia", first_comment: "no va" }), media: [img(1), vid], account: acc, state: {} }, s.http);
  assert.deepEqual(rs, { kind: "done", external_id: "m-c1,m-c2", permalink: "https://www.instagram.com/ultragrif/", message: undefined });
  assert.equal(s.calls.filter((c) => /comments/.test(c.url)).length, 0);
  assert.ok(s.calls.filter((c) => /\/178\/media$/.test(c.url)).every((c) => new URLSearchParams(c.body).get("media_type") === "STORIES"));
});

test("instagram: error de permiso no se reintenta", async () => {
  const { http } = fakeHttp([["POST", /\/media$/, () => ({ status: 400, json: { error: { message: "Application does not have permission", code: 10 } } })]]);
  const r = await instagram.step({ post: post(), media: [img()], account: acc, state: {} }, http);
  assert.deepEqual(r, { kind: "error", retry: false, message: "Application does not have permission", state: {} });
});

// ---------------------------------------------------------------- LinkedIn
test("linkedin: texto con caracteres reservados y hashtags", () => {
  assert.equal(littleText("Hola (nuevo) #Obra_2026 @ultra"), "Hola \\(nuevo\\) {hashtag|\\#|Obra_2026} \\@ultra");
});

test("linkedin: qué se puede publicar solo y qué no", () => {
  assert.equal(linkedin.check(post({ format: "carrusel" }), [pdf]), null);
  assert.equal(linkedin.check(post(), []), null); // solo texto
  assert.match(linkedin.check(post({ format: "articulo" }), [])!, /artículos/);
  assert.match(linkedin.check(post({ format: "historia" }), [img()])!, /stories/);
  assert.match(linkedin.check(post(), [vid, img()])!, /video va solo/);
});

test("linkedin: carrusel en PDF con primer comentario", async () => {
  const org = "urn:li:organization:42";
  const { http, calls } = fakeHttp([
    ["POST", /\/rest\/documents\?action=initializeUpload$/, () => ({ json: { value: { uploadUrl: "https://upload.test/doc", document: "urn:li:document:D1" } } })],
    ["GET", /cdn\.test\/social\/p1\/d\.pdf$/, () => ({ text: "%PDF-1.4" })],
    ["PUT", /upload\.test\/doc$/, () => ({ status: 201, text: "" })],
    ["POST", /\/rest\/posts$/, () => ({ status: 201, text: "", headers: { "x-restli-id": "urn:li:share:777" } })],
    ["POST", /\/rest\/socialActions\/urn%3Ali%3Ashare%3A777\/comments$/, () => ({ status: 201, json: {} })],
  ]);
  const r = await linkedin.step({ post: post({ format: "carrusel", title: "5 puntos antes de especificar", first_comment: "Más: https://ultragrif.com.ar" }), media: [pdf], account: { ...acc, external_id: org }, state: {} }, http);
  assert.deepEqual(r, { kind: "done", external_id: "urn:li:share:777", permalink: "https://www.linkedin.com/feed/update/urn:li:share:777/", message: undefined });
  const body = JSON.parse(calls.find((c) => /\/rest\/posts$/.test(c.url))!.body);
  assert.equal(body.author, org);
  assert.equal(body.commentary, "Llegó el kit\n\n{hashtag|\\#|ultragrif} {hashtag|\\#|obra}");
  assert.deepEqual(body.content, { media: { id: "urn:li:document:D1", title: "5 puntos antes de especificar" } });
  assert.equal(JSON.parse(calls.at(-1)!.body).message.text, "Más: https://ultragrif.com.ar");
});

test("linkedin: varias fotos van como multiImage", async () => {
  let n = 0;
  const { http, calls } = fakeHttp([
    ["POST", /images\?action=initializeUpload$/, () => ({ json: { value: { uploadUrl: `https://upload.test/i${++n}`, image: `urn:li:image:I${n}` } } })],
    ["GET", /cdn\.test/, () => ({ text: "jpg" })],
    ["PUT", /upload\.test/, () => ({ status: 201, text: "" })],
    ["POST", /\/rest\/posts$/, () => ({ status: 201, text: "", headers: { "x-restli-id": "urn:li:share:8" } })],
  ]);
  const r = await linkedin.step({ post: post(), media: [img(1), img(2)], account: { ...acc, external_id: "urn:li:organization:1" }, state: {} }, http);
  assert.equal(r.kind, "done");
  assert.deepEqual(JSON.parse(calls.at(-1)!.body).content.multiImage.images.map((i: { id: string }) => i.id), ["urn:li:image:I1", "urn:li:image:I2"]);
});

// ---------------------------------------------------------------- TikTok
test("tiktok: por defecto el video va a borradores y queda para terminar a mano", async () => {
  const { http, calls } = fakeHttp([
    ["POST", /\/post\/publish\/inbox\/video\/init\/$/, () => ({ json: { data: { publish_id: "pub1" }, error: { code: "ok" } } })],
    ["POST", /\/post\/publish\/status\/fetch\/$/, () => ({ json: { data: { status: "SEND_TO_USER_INBOX" }, error: { code: "ok" } } })],
  ]);
  const r = await tiktok.step({ post: post({ format: "reel" }), media: [vid], account: { ...acc, username: "confortivan" }, state: {} }, http);
  assert.equal(r.kind, "manual");
  assert.match((r as { message: string }).message, /borradores de TikTok de confortivan/);
  assert.deepEqual(JSON.parse(calls[0].body), { source_info: { source: "PULL_FROM_URL", video_url: vid.url } });
});

test("tiktok: publicación directa usa la privacidad que permite la cuenta", async () => {
  process.env.TIKTOK_MODE = "direct";
  try {
    const { http, calls } = fakeHttp([
      ["POST", /creator_info\/query\/$/, () => ({ json: { data: { privacy_level_options: ["FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE", "SELF_ONLY"] }, error: { code: "ok" } } })],
      ["POST", /\/post\/publish\/video\/init\/$/, () => ({ json: { data: { publish_id: "pub2" }, error: { code: "ok" } } })],
      ["POST", /status\/fetch\/$/, () => ({ json: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7311] }, error: { code: "ok" } } })],
    ]);
    const r = await tiktok.step({ post: post({ format: "video" }), media: [vid], account: { ...acc, username: "confortivan" }, state: {} }, http);
    assert.deepEqual(r, { kind: "done", external_id: "7311", permalink: "https://www.tiktok.com/@confortivan/video/7311", message: undefined });
    assert.equal(JSON.parse(calls[1].body).post_info.privacy_level, "PUBLIC_TO_EVERYONE");
  } finally {
    delete process.env.TIKTOK_MODE;
  }
});

// ---------------------------------------------------------------- publicador completo
function memoryStore(over: Partial<{ post: Partial<StoredPost>; media: MediaItem[]; account: StoredAccount | null; jobs: Partial<Job>[] }> = {}) {
  const jobs: (Job & Record<string, unknown>)[] = (over.jobs ?? [{}]).map((j, i) => ({
    id: `j${i}`, post_id: "p1", network: "instagram", status: "pendiente", attempts: 0, state: {}, scheduled_at: "2026-11-03T21:30:00Z", updated_at: "t", ...j,
  }) as Job & Record<string, unknown>);
  const notes: { user: string | null; kind: string; message: string }[] = [];
  const tokens: Record<string, unknown>[] = [];
  const accountStatus: string[] = [];
  const store: Store = {
    dueJobs: async () => jobs.filter((j) => j.status === "pendiente" || j.status === "procesando"),
    claim: async () => true,
    loadPost: async () => ({ ...post(), client_id: "c1", status: "programada", assignee_id: "yani", created_by: "coni", ...over.post }),
    loadMedia: async () => over.media ?? [img()],
    loadAccount: async () => (over.account === undefined ? { id: "a1", external_id: "178", username: "ultragrif", access_token: "tok", refresh_token: null, expires_at: "2027-01-01T00:00:00Z" } : over.account),
    clientName: async () => "Ultragrif",
    saveJob: async (id, patch) => void Object.assign(jobs.find((j) => j.id === id)!, patch),
    saveToken: async (_id, patch) => void tokens.push(patch),
    markAccount: async (_id, status) => void accountStatus.push(status),
    notify: async (user, _p, kind, message) => void notes.push({ user, kind, message }),
  };
  return { store, jobs, notes, tokens, accountStatus };
}
const okInstagram = () =>
  fakeHttp([
    ["POST", /\/178\/media$/, () => ({ json: { id: "c1" } })],
    ["GET", /\/c1\?/, () => ({ json: { status_code: "FINISHED" } })],
    ["POST", /media_publish$/, () => ({ json: { id: "m1" } })],
    ["GET", /\/m1\?/, () => ({ json: { permalink: "https://www.instagram.com/p/OK/" } })],
  ]);
const NOW = new Date("2026-11-03T21:31:00Z");

test("publicador: publica, guarda el link y avisa al responsable", async () => {
  const s = memoryStore();
  const r = await runDue(s.store, okInstagram().http, { now: NOW });
  assert.deepEqual(r.map((x) => x.kind), ["done"]);
  assert.equal(s.jobs[0].status, "publicada");
  assert.equal(s.jobs[0].permalink, "https://www.instagram.com/p/OK/");
  assert.deepEqual(s.notes, [{ user: "yani", kind: "publicacion_ok", message: "Se publicó «Lanzamiento» en Instagram" }]);
});

test("publicador: sin cuenta conectada o con formato imposible avisa y no reintenta", async () => {
  const a = memoryStore({ account: null });
  await runDue(a.store, okInstagram().http, { now: NOW });
  assert.equal(a.jobs[0].status, "error");
  assert.match(a.notes[0].message, /Ultragrif no tiene una cuenta de Instagram conectada/);

  const b = memoryStore({ post: { format: "articulo" }, jobs: [{ network: "linkedin" }] });
  await runDue(b.store, okInstagram().http, { now: NOW });
  assert.equal(b.jobs[0].status, "manual");
  assert.deepEqual(b.notes.map((n) => n.kind), ["publicacion_manual"]);
});

test("publicador: errores pasajeros se reintentan y después avisan", async () => {
  const s = memoryStore();
  const { http } = fakeHttp([["POST", /\/media$/, () => ({ status: 500, json: { error: { message: "Service temporarily unavailable" } } })]]);
  for (let i = 0; i < MAX_ATTEMPTS; i++) await runDue(s.store, http, { now: NOW });
  assert.equal(s.jobs[0].status, "error");
  assert.equal(s.jobs[0].attempts, MAX_ATTEMPTS);
  assert.equal(s.notes.length, 1);
  assert.match(s.notes[0].message, /Service temporarily unavailable/);
});

test("publicador: renueva el token de Instagram antes de que venza", async () => {
  const s = memoryStore({ account: { id: "a1", external_id: "178", username: "u", access_token: "viejo", refresh_token: null, expires_at: "2026-11-05T00:00:00Z" } });
  const { http, calls } = fakeHttp([
    ["GET", /refresh_access_token/, () => ({ json: { access_token: "nuevo", expires_in: 5184000 } })],
    ["POST", /\/178\/media$/, () => ({ json: { id: "c1" } })],
    ["GET", /\/c1\?/, () => ({ json: { status_code: "FINISHED" } })],
    ["POST", /media_publish$/, () => ({ json: { id: "m1" } })],
    ["GET", /\/m1\?/, () => ({ json: { permalink: "https://www.instagram.com/p/OK/" } })],
  ]);
  await runDue(s.store, http, { now: NOW });
  assert.deepEqual(s.tokens, [{ access_token: "nuevo", expires_at: "2027-01-02T21:31:00.000Z" }]);
  assert.equal(s.jobs[0].status, "publicada");
  assert.ok(calls.filter((c) => c.method === "POST").every((c) => new URLSearchParams(c.body).get("access_token") === "nuevo"));
});
