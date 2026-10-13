export type Role = "admin" | "lider" | "miembro";
export type TaskStatus = "pendiente" | "en_curso" | "bloqueada" | "en_revision" | "hecha";
export type Priority = "baja" | "media" | "alta" | "urgente";
export type ProjectStatus = "planificado" | "en_curso" | "en_pausa" | "completado";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  lead_id: string | null;
  active: boolean;
  email_alerts: boolean;
  created_at: string;
}

export interface Client {
  id: string;
  name: string;
  color: string;
  description: string;
  active: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  client_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  start_date: string;
  end_date: string;
  progress: number;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  client_id: string | null;
  project_id: string | null;
  assignee_id: string;
  created_by: string;
  status: TaskStatus;
  priority: Priority;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  task_id: string | null;
  kind: string;
  message: string;
  day: string;
  read_at: string | null;
  created_at: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  lider: "Líder",
  miembro: "Miembro",
};

export const STATUS: { key: TaskStatus; label: string }[] = [
  { key: "pendiente", label: "Pendiente" },
  { key: "en_curso", label: "En curso" },
  { key: "bloqueada", label: "Bloqueada" },
  { key: "en_revision", label: "En revisión" },
  { key: "hecha", label: "Hecha" },
];
export const STATUS_LABEL = Object.fromEntries(STATUS.map((s) => [s.key, s.label])) as Record<TaskStatus, string>;

export const PRIORITIES: { key: Priority; label: string }[] = [
  { key: "urgente", label: "Urgente" },
  { key: "alta", label: "Alta" },
  { key: "media", label: "Media" },
  { key: "baja", label: "Baja" },
];
export const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.key, p.label])) as Record<Priority, string>;
export const PRIORITY_RANK: Record<Priority, number> = { urgente: 0, alta: 1, media: 2, baja: 3 };

export const PROJECT_STATUS: { key: ProjectStatus; label: string }[] = [
  { key: "planificado", label: "Planificado" },
  { key: "en_curso", label: "En curso" },
  { key: "en_pausa", label: "En pausa" },
  { key: "completado", label: "Completado" },
];
export const PROJECT_STATUS_LABEL = Object.fromEntries(
  PROJECT_STATUS.map((s) => [s.key, s.label]),
) as Record<ProjectStatus, string>;
