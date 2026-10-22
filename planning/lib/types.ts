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
  /** Tiene calendario de redes (pestaña RRSS) */
  social: boolean;
  created_at: string;
}

export type Network = "instagram" | "linkedin" | "tiktok";
export type PostFormat = "post" | "carrusel" | "reel" | "historia" | "video" | "articulo";
export type PostStatus = "idea" | "en_produccion" | "en_revision" | "aprobada" | "programada" | "publicada";

/** Pieza del calendario de redes (supabase/migrations/0005_rrss.sql) */
export interface SocialPost {
  id: string;
  client_id: string;
  publish_date: string;
  /** "HH:MM:SS" */
  publish_time: string | null;
  networks: Network[];
  format: PostFormat;
  title: string;
  copy: string;
  hashtags: string;
  pillar: string;
  brief: string;
  cta: string;
  asset_url: string;
  post_url: string;
  notes: string;
  /** Se publica como primer comentario (ahí suele ir el link) */
  first_comment: string;
  status: PostStatus;
  assignee_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Foto, video o PDF de una pieza (Supabase Storage, bucket "social") */
export interface SocialMedia {
  id: string;
  post_id: string;
  path: string;
  url: string;
  kind: "image" | "video" | "document";
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  position: number;
  created_by: string | null;
  created_at: string;
}

/** Cuenta de un cliente conectada a una red (las credenciales quedan en el servidor) */
export interface SocialAccount {
  id: string;
  client_id: string;
  network: Network;
  external_id: string;
  name: string;
  username: string;
  avatar_url: string;
  status: "conectada" | "vencida" | "error";
  last_error: string;
  expires_at: string | null;
  connected_by: string | null;
  updated_at: string;
}

export type PublicationStatus = "pendiente" | "procesando" | "publicada" | "error" | "manual";

/** Publicación de una pieza en una red: cuándo sale y qué pasó */
export interface SocialPublication {
  id: string;
  post_id: string;
  network: Network;
  status: PublicationStatus;
  scheduled_at: string;
  attempts: number;
  external_id: string;
  permalink: string;
  message: string;
  published_at: string | null;
  updated_at: string;
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
  /** Responsable principal (= owner_ids[0]) */
  owner_id: string | null;
  /** Todas las personas responsables; quien tiene tareas en el proyecto se suma solo */
  owner_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  client_id: string | null;
  project_id: string | null;
  /** Responsable principal (= assignee_ids[0]) */
  assignee_id: string;
  /** Todas las personas responsables de la tarea */
  assignee_ids: string[];
  created_by: string;
  status: TaskStatus;
  priority: Priority;
  start_date: string | null;
  due_date: string | null;
  /** "HH:MM:SS" — horario dentro del día, para el calendario */
  start_time: string | null;
  end_time: string | null;
  recurring_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type Recurrence = "diaria" | "semanal" | "quincenal" | "mensual";
export const RECURRENCE: { key: Recurrence; label: string; every: string }[] = [
  { key: "diaria", label: "Todos los días hábiles", every: "todos los días hábiles" },
  { key: "semanal", label: "Todas las semanas", every: "todas las semanas" },
  { key: "quincenal", label: "Cada 2 semanas", every: "cada 2 semanas" },
  { key: "mensual", label: "Todos los meses", every: "todos los meses" },
];

export interface RecurringTask {
  id: string;
  title: string;
  description: string;
  client_id: string | null;
  project_id: string | null;
  assignee_id: string;
  created_by: string;
  priority: Priority;
  frequency: Recurrence;
  next_date: string;
  due_offset: number;
  start_time: string | null;
  end_time: string | null;
  active: boolean;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  task_id: string | null;
  project_id: string | null;
  /** Pieza de redes (avisos de publicación) */
  post_id?: string | null;
  actor_id: string | null;
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
