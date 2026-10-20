// Responsables de tareas y proyectos (supabase/migrations/0004_varios_responsables.sql).
// assignee_id / owner_id siguen siendo el principal; las listas tienen a todas las personas.
import type { Project, Task } from "./types";

/** Personas responsables de una tarea, la principal primero */
export function taskPeople(t: Pick<Task, "assignee_id"> & { assignee_ids?: string[] | null }): string[] {
  return t.assignee_ids?.length ? t.assignee_ids : [t.assignee_id];
}

export const hasPerson = (t: Pick<Task, "assignee_id"> & { assignee_ids?: string[] | null }, id: string) => taskPeople(t).includes(id);

/** Responsables del proyecto: los elegidos más quien tenga tareas en él (sin repetir) */
export function projectPeople(p: Pick<Project, "id" | "owner_id"> & { owner_ids?: string[] | null }, tasks: Task[]): string[] {
  const ids = p.owner_ids?.length ? [...p.owner_ids] : p.owner_id ? [p.owner_id] : [];
  for (const t of tasks) if (t.project_id === p.id) for (const a of taskPeople(t)) if (!ids.includes(a)) ids.push(a);
  return ids;
}
