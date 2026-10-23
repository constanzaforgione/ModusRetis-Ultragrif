// Intérprete local del dictado (lib/voice/interpret.ts): frases como se dicen de verdad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretLocal, toInfinitive } from "../lib/voice/interpret";
import type { VoiceAction, VoiceContext } from "../lib/voice/plan";

// Viernes 23 de octubre de 2026
const ctx: VoiceContext = {
  today: "2026-10-23",
  me: { id: "me", name: "Constanza Forgione", staff: true },
  people: [
    { id: "me", name: "Constanza Forgione", assignable: true },
    { id: "yani", name: "Yanina Pérez", assignable: true },
    { id: "maxi", name: "Maxi Gómez", assignable: true },
  ],
  clients: [
    { id: "ug", name: "Ultragrif" },
    { id: "pl", name: "Placebo" },
  ],
  projects: [
    { id: "p1", name: "Dashboards Meli", client_id: "ug", start_date: "2026-10-01", end_date: "2026-11-30", status: "en_curso" },
    { id: "p2", name: "Plan de Ads", client_id: "pl", start_date: "2026-10-01", end_date: "2026-12-15", status: "en_curso" },
  ],
  tasks: [
    { id: "t1", title: "Kit de publicaciones", project_id: null, client_id: "ug", status: "pendiente", due_date: "2026-10-25" },
    { id: "t2", title: "Presupuesto plan de Ads", project_id: "p2", client_id: "pl", status: "en_curso", due_date: "2026-10-28" },
  ],
  scope: {},
};

const run = (text: string, c: Partial<VoiceContext> = {}) => interpretLocal(text, { ...ctx, ...c });
const tasks = (a: VoiceAction[]) => a.flatMap((x) => (x.kind === "create_task" ? [x.task] : []));

test("varias tareas en un proyecto, con títulos cortos", () => {
  const p = run("En el proyecto Dashboards Meli agregá tres tareas: revisar métricas, armar el informe y presentarlo el lunes");
  assert.deepEqual(
    tasks(p.actions).map((t) => [t.title, t.project_id, t.client_id, t.due_date]),
    [
      ["Revisar métricas", "p1", "ug", null],
      ["Armar el informe", "p1", "ug", null],
      ["Presentarlo", "p1", "ug", "2026-10-26"],
    ],
  );
});

test("una tarea con fecha, cliente, urgencia y persona", () => {
  const [t] = tasks(run("Para el lunes tengo que llamar a Ultragrif, es urgente, que lo haga Yani").actions);
  assert.deepEqual([t.title, t.due_date, t.priority, t.assignee_ids, t.client_id], ["Llamar a Ultragrif", "2026-10-26", "urgente", ["yani"], "ug"]);
});

test("hora y varias ideas en el mismo dictado", () => {
  const p = run("Bueno, hay que mandarle el presupuesto a Placebo antes del 5/11 a las 3 de la tarde, después revisá las campañas del plan de ads, sin apuro");
  const [a, b] = tasks(p.actions);
  assert.deepEqual([a.title, a.due_date, a.start_time, a.client_id], ["Mandarle el presupuesto a Placebo", "2026-11-05", "15:00:00", "pl"]);
  assert.deepEqual([b.title, b.priority, b.project_id], ["Revisar las campañas del plan de ads", "baja", "p2"]);
});

test("proyecto nuevo con sus tareas en el mismo dictado", () => {
  const p = run("Creá un proyecto Rediseño web para Ultragrif de noviembre a enero. Agregale las tareas relevar el sitio actual y armar el wireframe para Maxi");
  const [proj] = p.actions;
  assert.equal(proj.kind, "create_project");
  if (proj.kind !== "create_project") return;
  assert.deepEqual([proj.project.name, proj.project.client_id, proj.project.start_date, proj.project.end_date], ["Rediseño web", "ug", "2026-11-01", "2027-01-31"]);
  assert.deepEqual(
    tasks(p.actions).map((t) => [t.title, t.project_ref, t.assignee_ids]),
    [
      ["Relevar el sitio actual", proj.ref, ["me"]],
      ["Armar el wireframe", proj.ref, ["maxi"]],
    ],
  );
});

test("cambios en tareas que ya existen", () => {
  assert.deepEqual(run("Marcá como hecha la de kit de publicaciones").actions, [{ kind: "update_task", task_id: "t1", changes: { status: "hecha" }, warning: undefined }]);
  const [moved] = run("Posterga el kit de publicaciones una semana").actions;
  assert.deepEqual(moved.kind === "update_task" && moved.changes, { due_date: "2026-11-01" });
  const [asg] = run("Asignale a Maxi el kit de publicaciones").actions;
  assert.deepEqual(asg.kind === "update_task" && asg.changes, { assignee_ids: ["maxi"] });
  const [done] = run("Ya mandé el presupuesto del plan de ads").actions;
  assert.deepEqual(done.kind === "update_task" && [done.task_id, done.changes], ["t2", { status: "hecha" }]);
});

test("cambios en proyectos", () => {
  assert.deepEqual(run("Pausá el proyecto Plan de Ads").actions[0], { kind: "update_project", project_id: "p2", changes: { status: "en_pausa" }, warning: undefined });
  const [ext] = run("Extendé el proyecto Dashboards Meli dos semanas").actions;
  assert.deepEqual(ext.kind === "update_project" && ext.changes, { end_date: "2026-12-14" });
});

test("desde un proyecto abierto, las tareas van a ese proyecto", () => {
  const [t] = tasks(run("Agregá revisar el feed mañana a la mañana", { scope: { project_id: "p2" } }).actions);
  assert.deepEqual([t.title, t.project_id, t.due_date, t.start_time], ["Revisar el feed", "p2", "2026-10-24", "09:00:00"]);
});

test("sin permiso para asignar a otros, queda a tu nombre con aviso", () => {
  const p = run("Que lo haga Yani: revisar el feed", { me: { id: "me", name: "Constanza", staff: false }, people: ctx.people.map((x) => ({ ...x, assignable: x.id === "me" })) });
  const [a] = p.actions;
  assert.ok(a.kind === "create_task" && a.task.assignee_ids[0] === "me" && a.warning);
});

test("proyecto que no existe: avisa", () => {
  const [a] = run("En el proyecto Branding Kumi agregá revisar el logo").actions;
  assert.ok(a.kind === "create_task" && a.task.project_id === null && /Branding Kumi/i.test(a.warning ?? ""));
});

test("imperativo a infinitivo", () => {
  assert.equal(toInfinitive("mandá el informe"), "Mandar el informe");
  assert.equal(toInfinitive("escribí el post"), "Escribir el post");
  assert.equal(toInfinitive("revisá"), "Revisar");
  assert.equal(toInfinitive("mandale el mail"), "Mandarle el mail");
});

test("sanear: ids inventados y fechas mal escritas no pasan", async () => {
  const { sanitizePlan } = await import("../lib/voice/plan");
  const p = sanitizePlan(
    {
      actions: [
        { kind: "create_task", task: { title: " Llamar ", description: "", priority: "media", assignee_ids: ["nadie"], client_id: "x", project_id: "p1", project_ref: "nuevo-9", start_date: "mañana", due_date: "2026-10-30", start_time: "15:00" } },
        { kind: "update_task", task_id: "inventada", changes: { status: "hecha" } },
        { kind: "update_project", project_id: "p1", changes: {} },
      ],
      unmatched: [],
    },
    ctx,
  );
  assert.equal(p.actions.length, 1);
  const [a] = p.actions;
  assert.ok(a.kind === "create_task");
  assert.deepEqual([a.task.title, a.task.assignee_ids, a.task.client_id, a.task.project_id, a.task.project_ref, a.task.start_date, a.task.due_date, a.task.start_time], [
    "Llamar", ["me"], null, "p1", null, null, "2026-10-30", "15:00:00",
  ]);
});

test("desde un proyecto: lista con persona al final y cambio del proyecto", () => {
  const p = run("Agregá tres tareas: revisar las métricas, armar el informe para el viernes y presentarlo al cliente el 3/11, que lo haga Yani. Después extendé el proyecto dos semanas.", {
    scope: { project_id: "p1", client_id: "ug" },
  });
  assert.deepEqual(
    tasks(p.actions).map((t) => [t.title, t.project_id, t.assignee_ids, t.due_date]),
    [
      ["Revisar las métricas", "p1", ["yani"], null],
      ["Armar el informe", "p1", ["yani"], "2026-10-30"],
      ["Presentarlo al cliente", "p1", ["yani"], "2026-11-03"],
    ],
  );
  assert.deepEqual(p.actions.at(-1), { kind: "update_project", project_id: "p1", changes: { end_date: "2026-12-14" }, warning: undefined });
});
