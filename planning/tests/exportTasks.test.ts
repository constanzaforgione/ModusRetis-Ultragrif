// Exportar tareas para armar un resumen con Claude (lib/exportTasks.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { claudePrompt, selectTasks, toCSV, type ExportTask } from "../lib/exportTasks";

const t = (title: string, p: Partial<ExportTask> = {}): ExportTask => ({
  title, description: "", status: "hecha", priority: "media", client_id: "pc", project_id: null, assignee_id: "yani",
  start_date: null, due_date: null, completed_at: null, ...p,
});
const look = {
  client: (id: string | null) => ({ pc: "Placebo / Confort Iván", ug: "Ultragrif" })[id ?? ""] ?? null,
  project: (id: string | null) => (id === "p1" ? { name: "Catálogo Mercado Libre", client_id: "pc" } : null),
  person: (id: string) => ({ yani: "Yani", maxi: "Maxi" })[id] ?? "—",
};
const tasks = [
  t("Cargar catálogo", { project_id: "p1", client_id: null, completed_at: "2026-10-10T15:00:00Z", description: "30 productos\ncon fotos" }),
  t("Llamar al cliente", { completed_at: "2026-10-05T12:00:00Z", assignee_id: "maxi" }),
  t("De septiembre", { completed_at: "2026-09-28T12:00:00Z" }),
  t("De Ultragrif", { client_id: "ug", completed_at: "2026-10-10T12:00:00Z" }),
  t("Campaña Black Friday", { status: "en_curso", start_date: "2026-10-20", due_date: "2026-11-27" }),
  t("Algo de diciembre", { status: "pendiente", due_date: "2026-12-10" }),
];
const f = { from: "2026-10-01", to: "2026-10-31", people: [], client_id: "pc", include: "todas" as const };

test("elige las tareas del período, cliente (o sus proyectos) y colaboradores", () => {
  assert.deepEqual(selectTasks(tasks, f, look).map((x) => x.title), ["Llamar al cliente", "Cargar catálogo", "Campaña Black Friday"]);
  assert.deepEqual(selectTasks(tasks, { ...f, include: "hechas" }, look).map((x) => x.title), ["Llamar al cliente", "Cargar catálogo"]);
  assert.deepEqual(selectTasks(tasks, { ...f, people: ["maxi"] }, look).map((x) => x.title), ["Llamar al cliente"]);
  assert.equal(selectTasks(tasks, { ...f, client_id: null }, look).length, 4);
});

test("el texto para Claude trae las instrucciones y las tareas agrupadas", () => {
  const list = selectTasks(tasks, f, look);
  const p = claudePrompt(list, f, look, { audience: "cliente" });
  assert.match(p, /resumen de avance para Placebo \/ Confort Iván del período 01\/10\/2026 al 31\/10\/2026/);
  assert.match(p, /sin nombres de colaboradores/);
  assert.match(p, /### Placebo \/ Confort Iván › Catálogo Mercado Libre\n- \[Hecha\] Cargar catálogo · Yani · prioridad media · cerrada 10\/10\/2026\n  Detalle: 30 productos con fotos/);
  assert.match(p, /\[En curso\] Campaña Black Friday · Yani · prioridad media · vence 27\/11\/2026/);
  assert.match(claudePrompt(list, f, look, { audience: "interno" }), /podés nombrar a los responsables/);
});

test("CSV con comillas escapadas", () => {
  const csv = toCSV([t('Revisar "kit"', { completed_at: "2026-10-01T10:00:00Z" })], look);
  assert.equal(csv.split("\n")[1], '"Placebo / Confort Iván","","Revisar ""kit""","Hecha","Media","Yani","","","2026-10-01",""');
});

test("lo que venció antes y sigue abierto también entra (está pendiente)", () => {
  const late = t("Vencida de septiembre", { status: "pendiente", due_date: "2026-09-20" });
  assert.deepEqual(selectTasks([late], f, look).map((x) => x.title), ["Vencida de septiembre"]);
  assert.equal(selectTasks([late], { ...f, include: "hechas" }, look).length, 0);
});
