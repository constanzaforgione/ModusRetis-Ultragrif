// Arrastrar tareas (lib/moveTask.ts): qué cambia al soltarla en otro día, horario o proyecto
import { test } from "node:test";
import assert from "node:assert/strict";
import { movePatch } from "../lib/moveTask";

const t = { due_date: "2026-11-05", start_date: "2026-11-03", start_time: null, end_time: null, project_id: "p1", client_id: "c1" };

test("a otro día: vence ese día y el inicio se corre lo mismo", () => {
  assert.deepEqual(movePatch(t, { date: "2026-11-10" }), { due_date: "2026-11-10", start_date: "2026-11-08" });
  assert.equal(movePatch(t, { date: "2026-11-05" }), null);
  assert.deepEqual(movePatch({ ...t, due_date: null }, { date: "2026-11-04" }), { start_date: "2026-11-04" });
  assert.deepEqual(movePatch({ ...t, due_date: null, start_date: null }, { date: "2026-11-04" }), { due_date: "2026-11-04" });
});

test("a un horario: mantiene la duración; a 'todo el día' le saca el horario", () => {
  const timed = { ...t, start_time: "10:00:00", end_time: "11:30:00" };
  assert.deepEqual(movePatch(timed, { date: "2026-11-06", time: "15:15:00" }), { due_date: "2026-11-06", start_date: "2026-11-04", start_time: "15:15:00", end_time: "16:45:00" });
  assert.deepEqual(movePatch(t, { time: "09:00:00" }), { start_time: "09:00:00", end_time: "10:00:00" });
  assert.deepEqual(movePatch(timed, { time: null }), { start_time: null, end_time: null });
});

test("a otro proyecto: cambia proyecto y cliente", () => {
  assert.deepEqual(movePatch(t, { project: { id: "p2", client_id: "c2" } }), { project_id: "p2", client_id: "c2" });
  assert.deepEqual(movePatch(t, { project: { id: null, client_id: null } }), { project_id: null });
  assert.equal(movePatch(t, { project: { id: "p1", client_id: "c1" } }), null);
});
