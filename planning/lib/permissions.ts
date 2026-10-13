// Espejo en la interfaz de las reglas RLS de la base (supabase/migrations/0001_init.sql).
// La base es la que manda: esto solo sirve para no mostrar botones que van a fallar.
import type { Profile } from "./types";

export function canManageUser(me: Profile, targetId: string, profiles: Profile[]): boolean {
  if (!me.active) return false;
  if (me.id === targetId || me.role === "admin") return true;
  if (me.role === "lider") return profiles.some((p) => p.id === targetId && p.lead_id === me.id);
  return false;
}

/** Personas a las que `me` puede asignar tareas */
export function assignableProfiles(me: Profile, profiles: Profile[]): Profile[] {
  return profiles.filter((p) => p.active && canManageUser(me, p.id, profiles));
}

export const isStaff = (me: Profile) => me.active && (me.role === "admin" || me.role === "lider");
export const canDelete = (me: Profile) => me.active && me.role === "admin";

/** Ids del equipo de un líder (incluido él/ella). Admin: todos. */
export function teamIds(me: Profile, profiles: Profile[]): Set<string> {
  if (me.role === "admin") return new Set(profiles.map((p) => p.id));
  return new Set([me.id, ...profiles.filter((p) => p.lead_id === me.id).map((p) => p.id)]);
}
