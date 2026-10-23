// Lo que puede hacer un dictado: crear o cambiar tareas y proyectos. Lo arma el asistente de IA (si hay
// clave) o el intérprete local; la persona lo revisa y confirma antes de que se guarde nada.
import type { Priority, ProjectStatus, TaskStatus } from "../types";

export interface TaskDraftFields {
  title: string;
  description: string;
  priority: Priority;
  assignee_ids: string[];
  client_id: string | null;
  project_id: string | null;
  /** Proyecto nuevo del mismo dictado (su `ref`) */
  project_ref: string | null;
  start_date: string | null;
  due_date: string | null;
  start_time: string | null;
}

export interface TaskChanges {
  status?: TaskStatus;
  priority?: Priority;
  start_date?: string | null;
  due_date?: string | null;
  start_time?: string | null;
  assignee_ids?: string[];
  project_id?: string | null;
  title?: string;
  /** Se agrega al final de la descripción */
  note?: string;
}

export interface ProjectDraftFields {
  name: string;
  description: string;
  client_id: string | null;
  start_date: string;
  end_date: string;
  owner_ids: string[];
}

export interface ProjectChanges {
  status?: ProjectStatus;
  start_date?: string;
  end_date?: string;
  name?: string;
}

export type VoiceAction =
  | { kind: "create_task"; task: TaskDraftFields; warning?: string }
  | { kind: "update_task"; task_id: string; changes: TaskChanges; warning?: string }
  | { kind: "create_project"; ref: string; project: ProjectDraftFields; warning?: string }
  | { kind: "update_project"; project_id: string; changes: ProjectChanges; warning?: string };

export interface VoicePlan {
  actions: VoiceAction[];
  /** Partes del dictado que no se pudieron convertir en nada */
  unmatched: string[];
}

/** Lo que el intérprete necesita saber de la app */
export interface VoiceContext {
  today: string;
  me: { id: string; name: string; staff: boolean };
  people: { id: string; name: string; assignable: boolean }[];
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; client_id: string; start_date: string; end_date: string; status: ProjectStatus }[];
  /** Tareas abiertas que quien dicta puede cambiar */
  tasks: { id: string; title: string; project_id: string | null; client_id: string | null; status: TaskStatus; due_date: string | null }[];
  /** Desde dónde se dicta: el proyecto o cliente abierto es el destino por defecto */
  scope: { project_id?: string | null; client_id?: string | null };
}

// ---------------------------------------------------------------- armar el contexto y sanear lo que vuelve
import type { Profile, Project, Task } from "../types";
import { assignableProfiles, canEditTask, isStaff } from "../permissions";

type ProfileLike = Pick<Profile, "id" | "full_name" | "role" | "lead_id" | "active">;

export function buildVoiceContext(a: {
  me: ProfileLike;
  profiles: ProfileLike[];
  clients: { id: string; name: string; active?: boolean }[];
  projects: Pick<Project, "id" | "name" | "client_id" | "start_date" | "end_date" | "status">[];
  tasks: (Pick<Task, "id" | "title" | "project_id" | "client_id" | "status" | "due_date" | "assignee_id" | "created_by"> & { assignee_ids?: string[] })[];
  today: string;
  scope?: VoiceContext["scope"];
}): VoiceContext {
  const me = a.me as Profile;
  const profiles = a.profiles as Profile[];
  const can = new Set(assignableProfiles(me, profiles).map((p) => p.id));
  return {
    today: a.today,
    me: { id: me.id, name: me.full_name, staff: isStaff(me) },
    people: profiles.filter((p) => p.active).map((p) => ({ id: p.id, name: p.full_name, assignable: can.has(p.id) })),
    clients: a.clients.filter((c) => c.active !== false).map((c) => ({ id: c.id, name: c.name })),
    projects: a.projects.map((p) => ({ id: p.id, name: p.name, client_id: p.client_id, start_date: p.start_date, end_date: p.end_date, status: p.status })),
    tasks: a.tasks
      .filter((t) => t.status !== "hecha" && canEditTask(me, t, profiles))
      .slice(0, 400)
      .map((t) => ({ id: t.id, title: t.title, project_id: t.project_id, client_id: t.client_id, status: t.status, due_date: t.due_date })),
    scope: a.scope ?? {},
  };
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown): s is string => typeof s === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(s);

/** Saca ids que no existen o que no se pueden usar, y fechas mal escritas. Vale para la IA y para el intérprete local. */
export function sanitizePlan(plan: VoicePlan, ctx: VoiceContext): VoicePlan {
  const people = new Set(ctx.people.filter((p) => p.assignable).map((p) => p.id));
  const anyone = new Set(ctx.people.map((p) => p.id));
  const clients = new Set(ctx.clients.map((c) => c.id));
  const projects = new Set(ctx.projects.map((p) => p.id));
  const tasks = new Set(ctx.tasks.map((t) => t.id));
  const refs = new Set(plan.actions.flatMap((a) => (a.kind === "create_project" ? [a.ref] : [])));
  const date = (s: string | null | undefined) => (isDate(s) ? s : null);
  const time = (s: string | null | undefined) => (isTime(s) ? (s.length === 5 ? `${s}:00` : s) : null);
  const actions: VoiceAction[] = [];
  for (const a of plan.actions) {
    if (a.kind === "create_task") {
      const t = a.task;
      if (!t.title?.trim()) continue;
      const ids = (t.assignee_ids ?? []).filter((id) => people.has(id));
      actions.push({
        ...a,
        task: {
          ...t,
          title: t.title.trim().slice(0, 200),
          description: t.description ?? "",
          assignee_ids: ids.length ? [...new Set(ids)] : [ctx.me.id],
          client_id: t.client_id && clients.has(t.client_id) ? t.client_id : null,
          project_id: t.project_id && projects.has(t.project_id) ? t.project_id : null,
          project_ref: t.project_ref && refs.has(t.project_ref) ? t.project_ref : null,
          start_date: date(t.start_date),
          due_date: date(t.due_date),
          start_time: time(t.start_time),
        },
      });
    } else if (a.kind === "update_task") {
      if (!tasks.has(a.task_id)) continue;
      const c: TaskChanges = {};
      const x = a.changes;
      if (x.status) c.status = x.status;
      if (x.priority) c.priority = x.priority;
      if (isDate(x.start_date)) c.start_date = x.start_date;
      if (isDate(x.due_date)) c.due_date = x.due_date;
      if (time(x.start_time)) c.start_time = time(x.start_time);
      const ids = (x.assignee_ids ?? []).filter((id) => people.has(id));
      if (ids.length) c.assignee_ids = [...new Set(ids)];
      if (x.project_id && projects.has(x.project_id)) c.project_id = x.project_id;
      if (x.title?.trim()) c.title = x.title.trim();
      if (x.note?.trim()) c.note = x.note.trim();
      if (Object.keys(c).length) actions.push({ ...a, changes: c });
    } else if (a.kind === "create_project") {
      const p = a.project;
      if (!p.name?.trim()) continue;
      const start = date(p.start_date) ?? ctx.today;
      let end = date(p.end_date) ?? start;
      if (end < start) end = start;
      actions.push({
        ...a,
        project: {
          ...p,
          name: p.name.trim(),
          description: p.description ?? "",
          client_id: p.client_id && clients.has(p.client_id) ? p.client_id : null,
          start_date: start,
          end_date: end,
          owner_ids: [...new Set((p.owner_ids ?? []).filter((id) => anyone.has(id)))],
        },
      });
    } else if (a.kind === "update_project") {
      if (!projects.has(a.project_id)) continue;
      const c: ProjectChanges = {};
      const x = a.changes;
      if (x.status) c.status = x.status;
      if (isDate(x.start_date)) c.start_date = x.start_date;
      if (isDate(x.end_date)) c.end_date = x.end_date;
      if (x.name?.trim()) c.name = x.name.trim();
      if (Object.keys(c).length) actions.push({ ...a, changes: c });
    }
  }
  return { actions, unmatched: plan.unmatched ?? [] };
}
