// Avance de un proyecto = tareas hechas / tareas del proyecto. Sin tareas, 0%.
import type { Task } from "./types";

export interface Progress {
  done: number;
  total: number;
  pct: number;
}

export function projectProgress(projectId: string | undefined, tasks: Task[]): Progress {
  if (!projectId) return { done: 0, total: 0, pct: 0 };
  const linked = tasks.filter((t) => t.project_id === projectId);
  const done = linked.filter((t) => t.status === "hecha").length;
  return { done, total: linked.length, pct: linked.length ? Math.round((done / linked.length) * 100) : 0 };
}

export const progressLabel = (p: Progress) => (p.total ? `${p.done}/${p.total} · ${p.pct}%` : "sin tareas");
