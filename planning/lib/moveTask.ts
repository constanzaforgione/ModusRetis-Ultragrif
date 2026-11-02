// Mover una tarea arrastrándola: a otro día (y horario) o a otro proyecto. Devuelve solo lo que cambia.
import { addDays, diffDays } from "./dates";
import type { Task } from "./types";

export interface MoveTarget {
  /** Nuevo día (AAAA-MM-DD): vence ese día; si tiene inicio, se corre lo mismo */
  date?: string;
  /** Horario: "HH:MM:SS" lo ubica ahí (con la misma duración); null lo pasa a "todo el día" */
  time?: string | null;
  /** Otro proyecto (null = sin proyecto); el cliente pasa a ser el del proyecto */
  project?: { id: string | null; client_id: string | null };
}

const mins = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const hms = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;

export function movePatch(t: Pick<Task, "due_date" | "start_date" | "start_time" | "end_time" | "project_id" | "client_id">, to: MoveTarget): Partial<Task> | null {
  const patch: Partial<Task> = {};
  if (to.date) {
    const was = t.due_date ?? t.start_date;
    if (t.due_date) {
      if (t.due_date !== to.date) patch.due_date = to.date;
      if (t.start_date && was) {
        const s = addDays(t.start_date, diffDays(to.date, was));
        if (s !== t.start_date) patch.start_date = s;
      }
    } else if (t.start_date) {
      if (t.start_date !== to.date) patch.start_date = to.date;
    } else patch.due_date = to.date;
  }
  if (to.time === null && (t.start_time || t.end_time)) {
    patch.start_time = null;
    patch.end_time = null;
  } else if (to.time) {
    const len = t.start_time && t.end_time ? mins(t.end_time) - mins(t.start_time) : 60;
    const start = Math.min(mins(to.time), 23 * 60 + 45);
    if (hms(start) !== t.start_time) patch.start_time = hms(start);
    const end = hms(Math.min(start + Math.max(len, 15), 23 * 60 + 59));
    if (end !== t.end_time) patch.end_time = end;
  }
  if (to.project && to.project.id !== t.project_id) {
    patch.project_id = to.project.id;
    if (to.project.id && to.project.client_id !== t.client_id) patch.client_id = to.project.client_id;
  }
  return Object.keys(patch).length ? patch : null;
}
