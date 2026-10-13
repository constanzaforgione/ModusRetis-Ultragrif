// Reglas de alertas, compartidas por la pantalla "Atención" y el cron diario de avisos.
import type { Task } from "./types";
import { addDays, diffDays } from "./dates";

export type AlertKind = "vencida" | "por_vencer" | "bloqueada" | "sin_movimiento";

export interface Alert {
  task: Task;
  kind: AlertKind;
  text: string;
}

export const DUE_SOON_DAYS = 2;
export const STALE_DAYS = 5;

export const ALERT_META: Record<AlertKind, { label: string; order: number }> = {
  vencida: { label: "Vencida", order: 0 },
  por_vencer: { label: "Por vencer", order: 1 },
  bloqueada: { label: "Bloqueada", order: 2 },
  sin_movimiento: { label: "Sin movimiento", order: 3 },
};

/** Una alerta por tarea (la más importante). `today` en formato AAAA-MM-DD. */
export function alertFor(task: Task, today: string): Alert | null {
  if (task.status === "hecha") return null;
  if (task.due_date && task.due_date < today) {
    const n = diffDays(today, task.due_date);
    return { task, kind: "vencida", text: `Venció hace ${n} ${n === 1 ? "día" : "días"}` };
  }
  if (task.due_date && task.due_date <= addDays(today, DUE_SOON_DAYS)) {
    const n = diffDays(task.due_date, today);
    return { task, kind: "por_vencer", text: n === 0 ? "Vence hoy" : n === 1 ? "Vence mañana" : `Vence en ${n} días` };
  }
  if (task.status === "bloqueada") return { task, kind: "bloqueada", text: "Está bloqueada" };
  const idle = diffDays(today, task.updated_at.slice(0, 10));
  if (idle >= STALE_DAYS) return { task, kind: "sin_movimiento", text: `Sin cambios hace ${idle} días` };
  if (task.status === "pendiente" && task.start_date && diffDays(today, task.start_date) >= STALE_DAYS) {
    return { task, kind: "sin_movimiento", text: `Debía arrancar el ${task.start_date.slice(8)}/${task.start_date.slice(5, 7)}` };
  }
  return null;
}

export function alertsFor(tasks: Task[], today: string): Alert[] {
  return tasks
    .map((t) => alertFor(t, today))
    .filter((a): a is Alert => a !== null)
    .sort((a, b) => ALERT_META[a.kind].order - ALERT_META[b.kind].order || (a.task.due_date ?? "9999").localeCompare(b.task.due_date ?? "9999"));
}
