// Resúmenes mensuales desde ClickUp (lib/summaries.ts y lib/clickup.ts), con los nombres reales de las páginas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummaries, clientFromFolder, hoursOf, isMonthlySummary, matchClient, monthOf, redact, type RawPage } from "../lib/summaries";
import { fetchSummaryPages } from "../lib/clickup";
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
      ["Placebo Amoblamientos", "2026-04", "Resumen de avance - Abril 2026", 0],
      ["Ultragrif", "2026-04", "Resumen de avance - Abril 2026", 0],
      ["Placebo Amoblamientos", "2026-03", "Resumen de avance - Marzo 2026 v2 (Consolidado)", 1],
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
    if (/\/task\/W\?include_subtasks/.test(url)) return json({ name: "WEGA", subtasks: [{ id: "T1", name: "Resúmen Mayo 2026 WEGA" }, { id: "T2", name: "Llamar al cliente" }] });
    if (/\/task\/T1\?/.test(url)) return json({ id: "T1", name: "Resúmen Mayo 2026 WEGA", markdown_description: "* Reunión mensual", date_created: "1784032541166", date_updated: "1784032541166", url: "https://app.clickup.com/t/T1" });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const pages = await fetchSummaryPages(http, { token: "pk_1", workspace: "900", parentTasks: ["W"] });
  assert.ok(!calls.some((c) => /D2/.test(c)), "no lee docs que no son de resúmenes");
  const s = buildSummaries(pages);
  assert.deepEqual(
    s.map((x) => [x.client, x.month, x.hours, x.url]),
    [
      ["Ultragrif", "2026-07", 18, "https://app.clickup.com/900/docs/D1/P1"],
      ["WEGA", "2026-05", null, "https://app.clickup.com/t/T1"],
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
