// Piezas comunes de la publicación automática: qué recibe cada red y qué devuelve cada paso.
// Cada red publica en "pasos": algunos videos tardan en procesarse, así que un paso puede pedir
// volver a intentar más tarde (el servidor revisa cada 5 minutos) guardando en `state` por dónde iba.
import type { Network, PostFormat } from "../types";

export type Http = typeof fetch;

export interface MediaItem {
  url: string;
  kind: "image" | "video" | "document";
  mime: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

export interface PostToPublish {
  id: string;
  title: string;
  copy: string;
  hashtags: string;
  format: PostFormat;
  first_comment: string;
}

export interface AccountToPublish {
  external_id: string;
  username: string;
  access_token: string;
}

export type StepResult =
  /** sigue procesando: volver a intentar en `retryInSec` con este `state` */
  | { kind: "wait"; state: Record<string, unknown>; retryInSec: number; message?: string }
  | { kind: "done"; external_id: string; permalink: string; message?: string }
  /** no se puede automáticamente (o quedó en borradores): alguien la termina a mano */
  | { kind: "manual"; message: string; state?: Record<string, unknown> }
  | { kind: "error"; message: string; retry: boolean; state?: Record<string, unknown> };

export interface Publisher {
  network: Network;
  /** null si se puede publicar sola; si no, por qué hay que hacerla a mano */
  check(post: PostToPublish, media: MediaItem[]): string | null;
  step(input: { post: PostToPublish; media: MediaItem[]; account: AccountToPublish; state: Record<string, unknown> }, http: Http): Promise<StepResult>;
}

/** Copy + hashtags, como se publica */
export const captionOf = (p: Pick<PostToPublish, "copy" | "hashtags">) => [p.copy.trim(), p.hashtags.trim()].filter(Boolean).join("\n\n");

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** errores que no se arreglan reintentando (permiso, formato inválido…) */
    public permanent = false,
  ) {
    super(message);
  }
}

/** fetch + JSON, con el mensaje de error de la API en castellano cuando se puede */
export async function callJson<T = Record<string, unknown>>(
  http: Http,
  url: string,
  init: RequestInit,
  pickError: (body: Record<string, unknown>) => string | null,
): Promise<{ body: T; headers: Headers }> {
  const res = await http(url, init);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  const apiErr = pickError(body);
  if (!res.ok || apiErr) {
    const msg = apiErr ?? `${res.status} ${res.statusText || "error"}${body.raw ? `: ${String(body.raw).slice(0, 200)}` : ""}`;
    // 4xx (salvo 429) no se arregla reintentando igual
    throw new ApiError(msg, res.status, res.status >= 400 && res.status < 500 && res.status !== 429);
  }
  return { body: body as T, headers: res.headers };
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
