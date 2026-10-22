// Íconos de cada tipo de aviso y cómo abrir lo que menciona (tarea, proyecto o pieza de redes).
import type { Notification } from "./types";

export const NOTIF_ICON: Record<string, string> = {
  asignada: "📌",
  proyecto_asignado: "📁",
  cambio: "✏️",
  proyecto_cambio: "✏️",
  reasignada: "↪️",
  tarea_en_proyecto: "➕",
  completada: "✅",
  equipo_bloqueada: "⛔",
  bloqueada: "⛔",
  vence_hoy: "⏰",
  por_vencer: "⏰",
  vencio: "⚠️",
  vencida: "⚠️",
  equipo_vencida: "⚠️",
  proyecto_por_terminar: "🏁",
  proyecto_vencido: "⚠️",
  repeticion: "🔁",
  publicacion_ok: "📣",
  publicacion_error: "⚠️",
  publicacion_manual: "✋",
};

export const iconFor = (n: Notification) => NOTIF_ICON[n.kind] ?? "🔔";

/** Abre la tarea o el proyecto del aviso: si ya estamos en esa pantalla, sin recargar. */
export function openFromNotification(n: Notification, push: (href: string) => void) {
  const target = n.task_id
    ? { path: "/tareas", key: "tarea", id: n.task_id }
    : n.project_id
      ? { path: "/roadmap", key: "proyecto", id: n.project_id }
      : n.post_id
        ? { path: "/rrss", key: "pieza", id: n.post_id }
        : null;
  if (!target) return;
  if (window.location.pathname.startsWith(target.path)) {
    window.dispatchEvent(new CustomEvent("mr-open", { detail: { key: target.key, id: target.id } }));
  } else {
    push(`${target.path}?${target.key}=${target.id}`);
  }
}

/** "hace 5 min", "hace 2 h", "ayer", "12 oct" */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 172800) return "ayer";
  const d = new Date(iso);
  return `${d.getDate()} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][d.getMonth()]}`;
}
