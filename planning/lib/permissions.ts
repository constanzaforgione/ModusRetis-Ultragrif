// Espejo en la interfaz de las reglas RLS de la base (supabase/migrations/0001_init.sql).
// La base es la que manda: esto solo sirve para no mostrar botones que van a fallar.
import type { Profile, SocialPost, Task } from "./types";
import { taskPeople } from "./people";

export function canManageUser(me: Profile, targetId: string, profiles: Profile[]): boolean {
  if (!me.active) return false;
  if (me.id === targetId || me.role === "admin") return true;
  if (me.role === "lider") return profiles.some((p) => p.id === targetId && p.lead_id === me.id);
  return false;
}

export const isStaff = (me: Profile) => me.active && (me.role === "admin" || me.role === "lider");

/** Personas a las que `me` puede asignar tareas: admins y líderes, a cualquiera; miembros, a sí mismos */
export function assignableProfiles(me: Profile, profiles: Profile[]): Profile[] {
  return profiles.filter((p) => p.active && (isStaff(me) || canManageUser(me, p.id, profiles)));
}

/** ¿Puede editar esta tarea? Cualquiera de sus responsables, el líder de alguno, un admin, o el admin/líder que la creó */
export function canEditTask(
  me: Profile,
  task: Pick<Task, "assignee_id" | "created_by"> & { assignee_ids?: string[] },
  profiles: Profile[],
): boolean {
  return taskPeople(task).some((id) => canManageUser(me, id, profiles)) || (isStaff(me) && task.created_by === me.id);
}
/** ¿Puede editar esta pieza de redes? Admins/líderes, quien la creó o su responsable (y su líder) */
export function canEditPost(me: Profile, post: Partial<Pick<SocialPost, "created_by" | "assignee_id">>, profiles: Profile[]): boolean {
  if (!me.active) return false;
  return isStaff(me) || post.created_by === me.id || (!!post.assignee_id && canManageUser(me, post.assignee_id, profiles));
}
export const canDelete = (me: Profile) => me.active && me.role === "admin";

/** Ids del equipo de un líder (incluido él/ella). Admin: todos. */
export function teamIds(me: Profile, profiles: Profile[]): Set<string> {
  if (me.role === "admin") return new Set(profiles.map((p) => p.id));
  return new Set([me.id, ...profiles.filter((p) => p.lead_id === me.id).map((p) => p.id)]);
}
