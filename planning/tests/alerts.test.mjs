// Reglas de alertas (lib/alerts.ts) — se compilan al vuelo con el TypeScript del proyecto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "alerts-"));
for (const f of ["dates", "alerts"]) {
  const src = readFileSync(new URL(`../lib/${f}.ts`, import.meta.url), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeFileSync(join(dir, `${f}.mjs`), out.replace(/from "\.\/dates"/g, 'from "./dates.mjs"'));
}
const { alertFor } = await import(join(dir, "alerts.mjs"));

const today = "2026-10-13";
const base = { status: "pendiente", due_date: null, start_date: null, updated_at: "2026-10-12T10:00:00Z" };

test("vencida, por vencer, bloqueada y sin movimiento", () => {
  assert.equal(alertFor({ ...base, due_date: "2026-10-10" }, today).kind, "vencida");
  assert.equal(alertFor({ ...base, due_date: "2026-10-13" }, today).text, "Vence hoy");
  assert.equal(alertFor({ ...base, due_date: "2026-10-15" }, today).kind, "por_vencer");
  assert.equal(alertFor({ ...base, due_date: "2026-10-20" }, today), null);
  assert.equal(alertFor({ ...base, status: "bloqueada" }, today).kind, "bloqueada");
  assert.equal(alertFor({ ...base, updated_at: "2026-10-01T10:00:00Z" }, today).kind, "sin_movimiento");
  assert.equal(alertFor({ ...base, start_date: "2026-10-05" }, today).kind, "sin_movimiento");
});

test("las tareas hechas no generan alertas", () => {
  assert.equal(alertFor({ ...base, status: "hecha", due_date: "2026-10-01" }, today), null);
});
