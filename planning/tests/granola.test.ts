// Reuniones de Granola → tareas (lib/granola.ts): qué reuniones se leen y qué puntos de acción salen
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionLines, extractLocal, fetchMeetings, isWanted, toMeeting } from "../lib/granola";
import type { VoiceContext } from "../lib/voice/plan";

const ctx: VoiceContext = {
  today: "2026-11-02",
  me: { id: "me", name: "Constanza Forgione", staff: true },
  people: [
    { id: "me", name: "Constanza Forgione", assignable: true },
    { id: "lyt", name: "Lytton Cabrera", assignable: true },
    { id: "vio", name: "Violeta Ruiz", assignable: true },
  ],
  clients: [
    { id: "ug", name: "Ultragrif" },
    { id: "ci", name: "Confort Iván" },
  ],
  projects: [{ id: "p1", name: "Catálogo Mercado Libre", client_id: "ug", start_date: "2026-10-01", end_date: "2026-12-01", status: "en_curso" }],
  tasks: [],
  scope: {},
};
const cfg = { prefix: "MR", people: ["lytton", "mauri", "barbi", "viole", "yani"] };

test("solo reuniones MR con las personas elegidas", () => {
  assert.ok(isWanted({ title: "MR Lytton + Coni: 30/10", people: [] }, cfg));
  assert.ok(isWanted({ title: "[MR] Weekly", people: ["Violeta Ruiz", "viole@modusretis.com"] }, cfg));
  assert.ok(isWanted({ title: "MR - Yanick + Coni", people: [] }, cfg));
  assert.ok(!isWanted({ title: "Lytton + Coni: 30/10", people: [] }, cfg), "sin el prefijo MR");
  assert.ok(!isWanted({ title: "MR Customer calls", people: ["Nica"] }, cfg), "sin ninguna de las personas");
  assert.ok(!isWanted({ title: "MRR review con Lytton", people: [] }, cfg), "MRR no es MR");
});

const SUMMARY = `# Desafío del Equipo y Operativa

- Credenciales desbloqueadas: Janis cargando fotos del catálogo Confort en Odoo
- UltraGrif: las 30 unidades del catálogo aún no están cargadas al 100% en cuenta Meli Retis
  - Meta para el lunes: Odoo y UltraGrif completos
- Viole todavía en curva de aprendizaje

# Próximos Pasos

- Lytton: armar la propuesta de ads de Meli Retis para el viernes
- Cargar el calendario de las primeras dos semanas de noviembre
  - Arrancar antes alternando contenido`;

test("puntos de acción: la sección de próximos pasos y los renglones con algo pendiente", () => {
  assert.deepEqual(
    actionLines(SUMMARY).map((x) => [x.text, x.detail]),
    [
      ["Meta para el lunes: Odoo y UltraGrif completos", []],
      ["Lytton: armar la propuesta de ads de Meli Retis para el viernes", []],
      ["Cargar el calendario de las primeras dos semanas de noviembre", ["Arrancar antes alternando contenido"]],
    ],
  );
  assert.equal(actionLines("- Meta para el lunes: Odoo completo\n- Viole en curva de aprendizaje").length, 1);
});

test("borradores de tareas desde una reunión, con fechas contadas desde el día de la reunión", () => {
  const m = toMeeting({ id: "n1", title: "MR Lytton + Coni: 30/10", created_at: "2026-10-30T19:42:00Z", summary_markdown: SUMMARY });
  assert.equal(m.date, "2026-10-30");
  const items = extractLocal(m, ctx);
  assert.equal(items.length, 3);
  const [meta, a, b] = items;
  assert.deepEqual([meta.title, meta.due_date, meta.client_id], ["Odoo y UltraGrif completos", "2026-11-02", "ug"]);
  assert.equal(a.title, "Armar la propuesta de ads de Meli Retis");
  assert.equal(a.due_date, "2026-11-06");
  assert.deepEqual(a.assignee_ids, ["lyt"]);
  assert.equal(b.title, "Cargar el calendario de las primeras dos semanas de noviembre");
  assert.equal(b.start_date, "2026-10-30");
  assert.match(b.description, /• Arrancar antes alternando contenido[\s\S]*De la reunión «MR Lytton \+ Coni: 30\/10»/);
});

test("lee la API de Granola: lista, filtra y pide la nota completa", async () => {
  const calls: string[] = [];
  const http = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const url = String(u);
    calls.push(url);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer grn_x");
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (/\/notes\?/.test(url))
      return json({
        notes: [
          { id: "a", title: "MR Lytton + Coni", created_at: "2026-10-30T19:00:00Z" },
          { id: "b", title: "Customer calls", created_at: "2026-10-30T19:00:00Z" },
          { id: "c", title: "MR Viole + Coni", created_at: "2026-10-29T19:00:00Z" },
        ],
        hasMore: false,
      });
    if (/\/notes\/a$/.test(url)) return json({ id: "a", title: "MR Lytton + Coni", created_at: "2026-10-30T19:00:00Z", summary_markdown: SUMMARY });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const list = await fetchMeetings(http, { key: "grn_x", days: 21, ...cfg }, new Set(["c"]));
  assert.deepEqual(list.map((m) => m.id), ["a"]);
  assert.ok(!calls.some((c) => /\/notes\/b/.test(c)), "no pide reuniones que no son MR");
});
