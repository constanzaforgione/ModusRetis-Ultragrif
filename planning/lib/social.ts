// Calendario de redes: redes, formatos y estados de cada pieza
import type { Network, PostFormat, PostStatus } from "./types";

export const NETWORKS: { key: Network; label: string; short: string; color: string }[] = [
  { key: "instagram", label: "Instagram", short: "IG", color: "#d62976" },
  { key: "linkedin", label: "LinkedIn", short: "in", color: "#0a66c2" },
  { key: "tiktok", label: "TikTok", short: "TT", color: "#111827" },
];
export const NETWORK = Object.fromEntries(NETWORKS.map((n) => [n.key, n])) as Record<Network, (typeof NETWORKS)[number]>;

export const FORMATS: { key: PostFormat; label: string }[] = [
  { key: "post", label: "Post" },
  { key: "carrusel", label: "Carrusel" },
  { key: "reel", label: "Reel" },
  { key: "historia", label: "Historia" },
  { key: "video", label: "Video" },
  { key: "articulo", label: "Artículo" },
];
export const FORMAT_LABEL = Object.fromEntries(FORMATS.map((f) => [f.key, f.label])) as Record<PostFormat, string>;

/** El estado reutiliza los colores de las tareas (pill s-…) */
export const POST_STATUS: { key: PostStatus; label: string; pill: string }[] = [
  { key: "idea", label: "Idea", pill: "s-pendiente" },
  { key: "en_produccion", label: "En producción", pill: "s-en_curso" },
  { key: "en_revision", label: "En revisión", pill: "s-en_revision" },
  { key: "aprobada", label: "Aprobada", pill: "s-aprobada" },
  { key: "programada", label: "Programada", pill: "s-programada" },
  { key: "publicada", label: "Publicada", pill: "s-hecha" },
];
export const POST_STATUS_META = Object.fromEntries(POST_STATUS.map((s) => [s.key, s])) as Record<PostStatus, (typeof POST_STATUS)[number]>;
