// Resúmenes mensuales desde ClickUp (lib/summaries.ts y lib/clickup.ts), con los nombres reales de las páginas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummaries, clientFromFolder, copiesToSave, hoursOf, isMonthlySummary, matchClient, mergeSummaries, monthOf, redact, summaryDraft, summaryTasks, type RawPage, type StoredSummary } from "../lib/summaries";
import { fetchSummaryPages, sendSummaryPage, summaryDocFor } from "../lib/clickup";
import { clickupClean, plainPreview } from "../components/Markdown";

test("qué páginas son resúmenes mensuales y cuáles nunca se muestran", () => {
  for (const n of [
    "Resumen de avance - Septiembre 2026",
    "Resumen de avance- Agosto",
    "Resume de avance - Septiembre 2025",
    "Resumen de avance - Sptiembre 2025 COMPLETO",
    "Resumen de avance - Marzo 2026 v2 (Consolidado)",
    "Resúmen Junio 2026 WEGA",
    "Resumen Agosto 2025",
  ])
    assert.ok(isMonthlySummary(n), n);
  for (const n of ["🔑 Credenciales de Acceso", "🔑 Credenciales de acceso", "Revisión Ultragrif", "Resúmen para revisión con cliente", "Semana 13/10", "Semanas del 17/11 y 24/11"])
    assert.ok(!isMonthlySummary(n), n);
});

test("mes del resumen, con o sin año", () => {
  assert.equal(monthOf("Resumen de avance - Julio 2026", "2026-08-05T00:00:00Z"), "2026-07");
  assert.equal(monthOf("Resumen de avance- Agosto", "2025-09-03T00:00:00Z"), "2025-08");
  assert.equal(monthOf("Resúmen Diciembre WEGA", "2026-01-07T00:00:00Z"), "2025-12");
  assert.equal(monthOf("Resumen de avance - Sptiembre 2025 COMPLETO", "2025-10-01T00:00:00Z"), "2025-09");
});

test("horas, ocultar datos sensibles y nombre del cliente", () => {
  assert.equal(hoursOf("## Detalle de trabajos realizados (18 horas)\n## **Canales de Venta** **(9 hs)**"), 18);
  assert.equal(hoursOf("Sin horas"), null);
  assert.equal(redact("* Usuario: tienda@x.com\n* Contraseña: 1234\n* Banners nuevos"), "_[dato sensible oculto]_\n_[dato sensible oculto]_\n* Banners nuevos");
  assert.equal(clientFromFolder("003- PLACEBO AMOBLAMIENTOS"), "Placebo Amoblamientos");
  assert.equal(clientFromFolder("001- ULTRAGRIF"), "Ultragrif");
  assert.equal(clientFromFolder("WEGA"), "WEGA");
  const clients = [{ name: "Placebo" }, { name: "Ultragrif" }, { name: "Confort Iván" }];
  assert.equal(matchClient("Placebo Amoblamientos", clients)?.name, "Placebo");
  assert.equal(matchClient("Kumi Deco", clients), undefined);
});

const raw = (name: string, p: Partial<RawPage> = {}): RawPage => ({
  key: `doc:d:${name}`,
  client: "Placebo Amoblamientos",
  name,
  content: "## Detalle (10 horas)\n* Algo",
  url: `https://app.clickup.com/x/${encodeURIComponent(name)}`,
  created: "2026-04-03T00:00:00Z",
  updated: "2026-04-03T00:00:00Z",
  ...p,
});

test("uno por cliente y mes: gana el consolidado, el resto queda como otra versión", () => {
  const r = buildSummaries([
    raw("Resumen de avance - Marzo 2026", { updated: "2026-04-10T00:00:00Z" }),
    raw("Resumen de avance - Marzo 2026 v2 (Consolidado)", { updated: "2026-04-05T00:00:00Z" }),
    raw("Resumen de avance - Abril 2026"),
    raw("🔑 Credenciales de Acceso", { content: "Contraseña: secreta" }),
    raw("Resumen de avance - Abril 2026", { client: "Ultragrif", content: "* Mercado Libre" }),
  ]);
  assert.deepEqual(
    r.map((x) => [x.client, x.month, x.name, x.versions.length]),
    [
      ["Placebo / Confort Iván", "2026-04", "Resumen de avance - Abril 2026", 0],
      ["Ultragrif", "2026-04", "Resumen de avance - Abril 2026", 0],
      ["Placebo / Confort Iván", "2026-03", "Resumen de avance - Marzo 2026 v2 (Consolidado)", 1],
    ],
  );
  assert.ok(r.every((x) => !/secreta/.test(x.content)));
});

test("lee docs y tareas de ClickUp", async () => {
  const calls: string[] = [];
  const http = (async (u: RequestInfo | URL) => {
    const url = String(u);
    calls.push(url);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (/\/docs\?limit/.test(url))
      return json({
        docs: [
          { id: "D1", name: "Resumen de avance", parent: { id: "F1", type: 5 } },
          { id: "D2", name: "Manual de marca", parent: { id: "F1", type: 5 } },
        ],
      });
    if (/\/folder\/F1$/.test(url)) return json({ name: "001- ULTRAGRIF" });
    if (/\/docs\/D1\/pages/.test(url))
      return json([
        { id: "P1", name: "Resumen de avance - Julio 2026", content: "## Detalle de trabajos realizados (18 horas)\n* Tienda oficial", date_created: 1786105649427, date_updated: 1788183250185 },
        { id: "P2", name: "🔑 Credenciales de acceso", content: "Contraseña: x", date_created: 1786105649427 },
      ]);
    if (/\/task\/W\?include_subtasks/.test(url)) return json({ name: "KUMI", subtasks: [{ id: "T1", name: "Resúmen Mayo 2026 KUMI" }, { id: "T2", name: "Llamar al cliente" }] });
    if (/\/task\/T1\?/.test(url)) return json({ id: "T1", name: "Resúmen Mayo 2026 KUMI", markdown_description: "* Reunión mensual", date_created: "1784032541166", date_updated: "1784032541166", url: "https://app.clickup.com/t/T1" });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const pages = await fetchSummaryPages(http, { token: "pk_1", workspace: "900", parentTasks: ["W"] });
  assert.ok(!calls.some((c) => /D2/.test(c)), "no lee docs que no son de resúmenes");
  const s = buildSummaries(pages);
  assert.deepEqual(
    s.map((x) => [x.client, x.month, x.hours, x.url]),
    [
      ["Ultragrif", "2026-07", 18, "https://app.clickup.com/900/docs/D1/P1"],
      ["KUMI", "2026-05", null, "https://app.clickup.com/t/T1"],
    ],
  );
});

test("vista previa de la tarjeta en texto plano", () => {
  assert.equal(plainPreview("## Detalle (18 horas)\n#### Mercado Libre\n*   Creación de página **oficial**\n*   [Link](https://x.com)"), "Creación de página oficial · Link");
});

test("limpia menciones y escapes de ClickUp", () => {
  assert.equal(clickupClean("[@Mauricio Barrio](#user_mention#67350014) hola | \\-36,79% | \\+ IVA"), "@Mauricio Barrio hola | -36,79% | + IVA");
  assert.equal(clickupClean("[@Ana](#user_mention#1) [@Leo](#user_mention#2)\n# Título"), "\n# Título");
  assert.equal(plainPreview("[@Lytton](#user_mention#1)\n# **Resumen mensual - Julio 2026**\n*   Ventas \\-5%"), "Ventas -5%");
});

test("los resúmenes de WEGA no se muestran", () => {
  const r = buildSummaries([
    raw("Resúmen Mayo 2026 WEGA", { key: "task:T1", client: "WEGA" }),
    raw("Resumen de avance - Mayo 2026", { client: "Wega" }),
    raw("Resumen de avance - Mayo 2026", { client: "Ultragrif" }),
  ]);
  assert.deepEqual(r.map((x) => x.client), ["Ultragrif"]);
});

const stored = (p: Partial<StoredSummary>): StoredSummary => ({
  id: "s1", client_id: "ug", client_name: "Ultragrif", month: "2026-10", title: "Resumen de avance - Octubre 2026", content: "## Detalle (10 horas)",
  hours: 10, source: "app", clickup_key: null, clickup_url: "", edited: false, sent_at: null, updated_at: "2026-11-02T10:00:00Z", ...p,
});

test("copias de ClickUp en la app: nuevas y cambiadas, nunca las editadas acá", () => {
  const live = buildSummaries([
    raw("Resumen de avance - Septiembre 2026", { key: "doc:d:a", client: "Ultragrif", content: "* nuevo" }),
    raw("Resumen de avance - Agosto 2026", { key: "doc:d:b", client: "Ultragrif", content: "* cambió" }),
    raw("Resumen de avance - Julio 2026", { key: "doc:d:c", client: "Ultragrif", content: "* cambió en ClickUp" }),
  ]);
  const { insert, update } = copiesToSave(live, [
    stored({ id: "b", source: "clickup", clickup_key: "doc:d:b", month: "2026-08", title: "Resumen de avance - Agosto 2026", content: "* viejo" }),
    stored({ id: "c", source: "clickup", clickup_key: "doc:d:c", month: "2026-07", edited: true, content: "* editado en la app" }),
  ]);
  assert.deepEqual(insert.map((p) => p.key), ["doc:d:a"]);
  assert.deepEqual(update.map((u) => u.id), ["b"]);
});

test("la lista junta lo de la app con lo de ClickUp sin repetir", () => {
  const live = buildSummaries([
    raw("Resumen de avance - Septiembre 2026", { key: "doc:d:a", client: "Ultragrif" }),
    raw("Resumen de avance - Agosto 2026", { key: "doc:d:b", client: "Ultragrif" }),
  ]);
  const list = mergeSummaries(
    [stored({}), stored({ id: "b", source: "clickup", clickup_key: "doc:d:b", month: "2026-08" }), stored({ id: "w", client_id: null, client_name: "WEGA" })],
    live,
    (id) => (id === "ug" ? "Ultragrif" : null),
  );
  assert.deepEqual(
    list.map((x) => [x.month, x.id, x.source]),
    [
      ["2026-10", "s1", "app"],
      ["2026-09", null, "clickup"],
      ["2026-08", "b", "clickup"],
    ],
  );
});

test("el resumen se arma con las tareas del planning de ese cliente (y de sus proyectos)", () => {
  const t = (title: string, p: Partial<Parameters<typeof summaryTasks>[0][number]>) => ({ title, status: "hecha", client_id: "pc", project_id: null, start_date: null, due_date: null, completed_at: null, updated_at: null, ...p });
  const tasks = [
    t("Cargar catálogo", { project_id: "p1", completed_at: "2026-10-10T12:00:00Z" }),
    t("Publicar ofertas", { project_id: "p1", client_id: null, completed_at: "2026-10-20T12:00:00Z" }), // sin cliente, pero del proyecto de Placebo
    t("Llamar al cliente", { completed_at: "2026-10-05T12:00:00Z" }),
    t("De septiembre", { completed_at: "2026-09-28T12:00:00Z" }),
    t("De otro cliente", { client_id: "ug", completed_at: "2026-10-10T12:00:00Z" }),
    t("Campaña Black Friday", { status: "en_curso", start_date: "2026-10-25" }),
    t("Fotos de diciembre", { status: "pendiente", due_date: "2026-11-15" }),
  ];
  const r = summaryTasks(tasks, [{ id: "p1", name: "Catálogo Mercado Libre", client_id: "pc" }], "pc", "2026-10");
  assert.deepEqual(r.done.map((x) => x.title), ["Cargar catálogo", "Publicar ofertas", "Llamar al cliente"]);
  assert.deepEqual(r.doing.map((x) => x.title), ["Campaña Black Friday"]);
  assert.deepEqual(r.next.map((x) => x.title), ["Fotos de diciembre"]);
  const d = summaryDraft("Placebo / Confort Iván", "2026-10", r);
  assert.match(d, /^# Resumen de avance - Octubre 2026 · Placebo \/ Confort Iván/);
  assert.match(d, /### Catálogo Mercado Libre\n\* Cargar catálogo\n\* Publicar ofertas\n\n### Otras tareas\n\* Llamar al cliente/);
  assert.match(d, /## En curso\n\n### Otras tareas\n\* Campaña Black Friday/);
  assert.match(d, /## Próximos pasos\n\n\* Fotos de diciembre/);
});

test("un cliente de la app con dos nombres junta los resúmenes de los dos", () => {
  const clients = [{ name: "Placebo / Confort Iván" }, { name: "Ultragrif" }];
  assert.equal(matchClient("Placebo Amoblamientos", clients)?.name, "Placebo / Confort Iván");
  assert.equal(matchClient("Confort Ivan", clients)?.name, "Placebo / Confort Iván");
  assert.equal(matchClient("Ultragrif", clients)?.name, "Ultragrif");
  assert.equal(matchClient("Kumi Deco", clients), undefined);
  // Placebo y Confort Iván son siempre "Placebo / Confort Iván", aunque exista un cliente viejo con el nombre suelto
  assert.equal(matchClient("Confort Iván", [...clients, { name: "Confort Iván" }])?.name, "Placebo / Confort Iván");
  assert.equal(matchClient("Placebo", [{ name: "Placebo" }, ...clients])?.name, "Placebo / Confort Iván");
});

test("mandar a ClickUp: crea la página en el doc del cliente o la actualiza", async () => {
  assert.equal(
    summaryDocFor(
      [
        raw("Resumen de avance - Agosto 2026", { key: "doc:D1:p1", client: "Ultragrif", updated: "2026-09-01T00:00:00Z" }),
        raw("Resumen de avance - Septiembre 2026", { key: "doc:D2:p2", client: "Placebo Amoblamientos", updated: "2026-10-01T00:00:00Z" }),
      ],
      "Placebo",
    ),
    "D2",
  );
  const calls: { url: string; method?: string; body: Record<string, unknown> }[] = [];
  const http = (async (u: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(u), method: init?.method, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id: "P9" }), { status: 200 });
  }) as typeof fetch;
  const cfg = { token: "pk_1", workspace: "900", parentTasks: [] };
  const made = await sendSummaryPage(http, cfg, { docId: "D2", pageId: null, name: "Resumen de avance - Octubre 2026", content: "* hola" });
  assert.deepEqual(made, { key: "doc:D2:P9", url: "https://app.clickup.com/900/docs/D2/P9" });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.clickup.com/api/v3/workspaces/900/docs/D2/pages");
  assert.equal(calls[0].body.content_format, "text/md");
  await sendSummaryPage(http, cfg, { docId: "D2", pageId: "P9", name: "x", content: "y" });
  assert.equal(calls[1].method, "PUT");
  assert.match(calls[1].url, /\/pages\/P9$/);
});

test("Placebo, Placebo Amoblamientos y Confort Iván se muestran como Placebo / Confort Iván", async () => {
  const { canonicalClient } = await import("../lib/clientAliases");
  for (const n of ["Placebo", "Placebo Amoblamientos", "PLACEBO AMOBLAMIENTOS", "Confort Iván", "Confort Ivan", "Placebo / Confort Iván"]) assert.equal(canonicalClient(n), "Placebo / Confort Iván", n);
  assert.equal(canonicalClient("Ultragrif"), "Ultragrif");
  assert.equal(canonicalClient("Confort"), "Confort");
  // Copias viejas guardadas como "Placebo Amoblamientos" sin cliente de la app
  const list = mergeSummaries([stored({ id: "x", client_id: null, client_name: "Placebo Amoblamientos" })], [], () => null, (n) => (matchClient(n, [{ name: "Placebo / Confort Iván" }]) ? { id: "pc", name: "Placebo / Confort Iván" } : undefined));
  assert.deepEqual([list[0].client, list[0].client_id], ["Placebo / Confort Iván", "pc"]);
});
