// Exportar tareas del planning (por período, colaboradores y cliente) en un texto listo para pegar en Claude,
// con las instrucciones para que arme un resumen de avance en Markdown para ClickUp. También CSV.
import { STATUS_LABEL, PRIORITY_LABEL, type Priority, type TaskStatus } from "./types";

export interface ExportTask {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  client_id: string | null;
  project_id: string | null;
  assignee_id: string;
  assignee_ids?: string[];
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
}

export interface ExportFilters {
  from: string;
  to: string;
  /** Vacío = todos */
  people: string[];
  /** null = todos los clientes */
  client_id: string | null;
  /** hechas: solo lo cerrado en el período · todas: también lo abierto que cae en el período */
  include: "hechas" | "todas";
}

export interface ExportLookup {
  client: (id: string | null) => string | null;
  project: (id: string | null) => { name: string; client_id: string } | null;
  person: (id: string) => string;
}

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const people = (t: ExportTask) => (t.assignee_ids?.length ? t.assignee_ids : [t.assignee_id]);

/** Fecha que ubica la tarea en el período: cuándo se cerró, o cuándo vence o empieza si sigue abierta */
export const periodDate = (t: ExportTask) => (t.status === "hecha" ? (day(t.completed_at) ?? t.due_date ?? t.start_date) : (t.due_date ?? t.start_date));

export function selectTasks<T extends ExportTask>(tasks: T[], f: ExportFilters, look: ExportLookup): T[] {
  const inRange = (d: string | null) => !!d && d >= f.from && d <= f.to;
  return tasks
    .filter((t) => {
      if (f.client_id && t.client_id !== f.client_id && look.project(t.project_id)?.client_id !== f.client_id) return false;
      if (f.people.length && !people(t).some((p) => f.people.includes(p))) return false;
      if (t.status === "hecha") return inRange(periodDate(t));
      if (f.include === "hechas") return false;
      // Abierta: vence o empieza en el período, o ya estaba (empezó o venció antes) y sigue abierta
      const d = t.start_date ?? t.due_date;
      return inRange(periodDate(t)) || (!!d && d <= f.to);
    })
    .sort((a, b) => (periodDate(a) ?? "9").localeCompare(periodDate(b) ?? "9"));
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const fmt = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");

/** El texto para Claude: instrucciones + las tareas agrupadas por cliente y proyecto */
export function claudePrompt(list: ExportTask[], f: ExportFilters, look: ExportLookup, opts: { audience: "cliente" | "interno" }) {
  const clientName = f.client_id ? look.client(f.client_id) : null;
  const who = f.people.length ? f.people.map(look.person).join(", ") : "todo el equipo";
  const groups = new Map<string, ExportTask[]>();
  for (const t of list) {
    const p = look.project(t.project_id);
    const c = look.client(t.client_id) ?? look.client(p?.client_id ?? null) ?? "Interno";
    const k = `${c} › ${p?.name ?? "Sin proyecto"}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const lines = [...groups].map(([k, ts]) =>
    [
      `### ${k}`,
      ...ts.map((t) => {
        const desc = clean(t.description ?? "").slice(0, 400);
        return `- [${STATUS_LABEL[t.status]}] ${clean(t.title)} · ${people(t).map(look.person).join(", ")} · prioridad ${PRIORITY_LABEL[t.priority].toLowerCase()} · ${
          t.status === "hecha" ? `cerrada ${fmt(day(t.completed_at) ?? t.due_date)}` : `vence ${fmt(t.due_date)}`
        }${desc ? `\n  Detalle: ${desc}` : ""}`;
      }),
    ].join("\n"),
  );

  const forClient = opts.audience === "cliente";
  return `Sos parte del equipo de Modus Retis, una consultora argentina. Armá un resumen de avance${clientName ? ` para ${clientName}` : ""} del período ${fmt(f.from)} al ${fmt(f.to)}, a partir de las tareas del planning que te paso abajo (${who}).

Cómo lo quiero:
- En Markdown, listo para pegar en un doc de ClickUp.
- Título: "# Resumen de avance - ${clientName ?? "[cliente]"} · ${fmt(f.from)} al ${fmt(f.to)}".
- Secciones: "## Detalle de trabajos realizados" (lo terminado, agrupado por proyecto o área, con "###" por grupo), "## En curso" (lo que sigue abierto) y "## Próximos pasos".
- Redactá cada punto como un logro o avance concreto, breve y claro; uní tareas repetidas o muy parecidas. No copies los títulos tal cual si se pueden decir mejor.
- ${forClient ? "Es para mandarle al cliente: tono profesional y cercano, sin nombres de colaboradores ni detalles internos (bloqueos, prioridades, problemas del equipo)." : "Es de uso interno: podés nombrar a los responsables y marcar lo que está bloqueado."}
- No inventes nada que no esté en las tareas. Si algo no queda claro, dejalo afuera.
- Español rioplatense.

Tareas (${list.length}):

${lines.join("\n\n") || "(no hay tareas con esos filtros)"}`;
}

/** Las mismas tareas en CSV (para Excel o Sheets) */
export function toCSV(list: ExportTask[], look: ExportLookup) {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const head = ["Cliente", "Proyecto", "Tarea", "Estado", "Prioridad", "Responsables", "Inicio", "Vence", "Cerrada", "Descripción"];
  const rows = list.map((t) => {
    const p = look.project(t.project_id);
    return [
      look.client(t.client_id) ?? look.client(p?.client_id ?? null) ?? "Interno",
      p?.name ?? "",
      t.title,
      STATUS_LABEL[t.status],
      PRIORITY_LABEL[t.priority],
      people(t).map(look.person).join(", "),
      t.start_date ?? "",
      t.due_date ?? "",
      day(t.completed_at) ?? "",
      clean(t.description ?? ""),
    ];
  });
  return [head, ...rows].map((r) => r.map((v) => q(String(v))).join(",")).join("\n");
}
