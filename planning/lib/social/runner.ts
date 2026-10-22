// El que publica: cada 5 minutos toma las publicaciones que ya tienen que salir y avanza un paso cada una.
// La base de datos se usa a través de `Store` para poder probarlo sin Supabase.
import type { Network } from "../types";
import { describe, type AccountToPublish, type Http, type MediaItem, type PostToPublish, type Publisher, type StepResult } from "./common";
import { instagram, instagramRefresh } from "./instagram";
import { linkedin, linkedinToken } from "./linkedin";
import { tiktok, tiktokToken } from "./tiktok";

export const PUBLISHERS: Record<Network, Publisher> = { instagram, linkedin, tiktok };
export const NETWORK_NAME: Record<Network, string> = { instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok" };

export interface Job {
  id: string;
  post_id: string;
  network: Network;
  status: string;
  attempts: number;
  state: Record<string, unknown>;
  scheduled_at: string;
  updated_at: string;
}

export interface StoredPost extends PostToPublish {
  client_id: string;
  status: string;
  assignee_id: string | null;
  created_by: string | null;
}

export interface StoredAccount extends AccountToPublish {
  id: string;
  refresh_token: string | null;
  expires_at: string | null;
}

export interface Store {
  dueJobs(now: Date, limit: number, postId?: string): Promise<Job[]>;
  /** Toma el trabajo si nadie lo tomó mientras tanto (para no publicar dos veces) */
  claim(job: Job): Promise<boolean>;
  loadPost(id: string): Promise<StoredPost | null>;
  loadMedia(postId: string): Promise<MediaItem[]>;
  loadAccount(clientId: string, network: Network): Promise<StoredAccount | null>;
  clientName(clientId: string): Promise<string>;
  saveJob(id: string, patch: Partial<{ status: string; attempts: number; state: Record<string, unknown>; next_attempt_at: string; message: string; external_id: string; permalink: string; published_at: string }>): Promise<void>;
  saveToken(accountId: string, patch: { access_token: string; refresh_token?: string | null; expires_at: string | null; refresh_expires_at?: string | null }): Promise<void>;
  markAccount(accountId: string, status: "conectada" | "vencida" | "error", error: string): Promise<void>;
  notify(userId: string | null, postId: string, kind: string, message: string): Promise<void>;
}

const BACKOFF_MIN = [5, 15, 60];
export const MAX_ATTEMPTS = 3;

const plus = (now: Date, sec: number) => new Date(now.getTime() + sec * 1000).toISOString();

/** Renueva el token si está por vencer. Devuelve el token vigente. */
export async function freshToken(store: Store, acc: StoredAccount, network: Network, http: Http, now = new Date()): Promise<string> {
  const left = acc.expires_at ? new Date(acc.expires_at).getTime() - now.getTime() : Infinity;
  const day = 86_400_000;
  try {
    if (network === "instagram" && left < 7 * day) {
      const r = await instagramRefresh(http, acc.access_token);
      await store.saveToken(acc.id, { access_token: r.access_token, expires_at: plus(now, r.expires_in) });
      return r.access_token;
    }
    if (network === "linkedin" && left < 3 * day && acc.refresh_token) {
      const r = await linkedinToken(http, { grant_type: "refresh_token", refresh_token: acc.refresh_token, client_id: process.env.LINKEDIN_CLIENT_ID ?? "", client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? "" });
      await store.saveToken(acc.id, {
        access_token: r.access_token,
        refresh_token: r.refresh_token ?? acc.refresh_token,
        expires_at: plus(now, r.expires_in),
        refresh_expires_at: r.refresh_token_expires_in ? plus(now, r.refresh_token_expires_in) : undefined,
      });
      return r.access_token;
    }
    if (network === "tiktok" && left < 30 * 60_000 && acc.refresh_token) {
      const r = await tiktokToken(http, { client_key: process.env.TIKTOK_CLIENT_KEY ?? "", client_secret: process.env.TIKTOK_CLIENT_SECRET ?? "", grant_type: "refresh_token", refresh_token: acc.refresh_token });
      await store.saveToken(acc.id, { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: plus(now, r.expires_in), refresh_expires_at: plus(now, r.refresh_expires_in) });
      return r.access_token;
    }
  } catch (e) {
    if (left <= 0) {
      await store.markAccount(acc.id, "vencida", `Venció la conexión: volvé a conectar la cuenta (${describe(e)})`);
      throw new Error("Venció la conexión con la cuenta: hay que volver a conectarla en RRSS → Cuentas.");
    }
  }
  if (left <= 0) {
    await store.markAccount(acc.id, "vencida", "Venció la conexión: volvé a conectar la cuenta.");
    throw new Error("Venció la conexión con la cuenta: hay que volver a conectarla en RRSS → Cuentas.");
  }
  return acc.access_token;
}

/** Avanza una publicación un paso. Devuelve qué pasó, para el resumen. */
export async function runJob(store: Store, job: Job, http: Http, now = new Date()): Promise<StepResult | { kind: "skip"; message: string }> {
  const post = await store.loadPost(job.post_id);
  if (!post || post.status !== "programada") return { kind: "skip", message: "La pieza ya no está programada." };
  const who = post.assignee_id ?? post.created_by;
  const net = NETWORK_NAME[job.network];
  const publisher = PUBLISHERS[job.network];

  const fail = async (message: string, retry: boolean, state = job.state): Promise<StepResult> => {
    const attempts = job.attempts + 1;
    if (retry && attempts < MAX_ATTEMPTS) {
      await store.saveJob(job.id, { status: "pendiente", attempts, state, message: `${message} Se reintenta en ${BACKOFF_MIN[attempts - 1]} min.`, next_attempt_at: plus(now, BACKOFF_MIN[attempts - 1] * 60) });
    } else {
      await store.saveJob(job.id, { status: "error", attempts, state, message });
      await store.notify(who, post.id, "publicacion_error", `No se pudo publicar «${post.title}» en ${net}: ${message}`);
    }
    return { kind: "error", message, retry };
  };

  const media = await store.loadMedia(post.id);
  const reason = publisher.check(post, media);
  if (reason) {
    await store.saveJob(job.id, { status: "manual", message: reason });
    await store.notify(who, post.id, "publicacion_manual", `Hay que publicar a mano «${post.title}» en ${net}: ${reason}`);
    return { kind: "manual", message: reason };
  }

  const acc = await store.loadAccount(post.client_id, job.network);
  if (!acc) {
    const message = `${await store.clientName(post.client_id)} no tiene una cuenta de ${net} conectada (RRSS → Cuentas).`;
    await store.saveJob(job.id, { status: "error", message });
    await store.notify(who, post.id, "publicacion_error", `No se pudo publicar «${post.title}» en ${net}: ${message}`);
    return { kind: "error", message, retry: false };
  }

  let token: string;
  try {
    token = await freshToken(store, acc, job.network, http, now);
  } catch (e) {
    return fail(describe(e), false);
  }

  let r: StepResult;
  try {
    r = await publisher.step({ post, media, account: { ...acc, access_token: token }, state: job.state ?? {} }, http);
  } catch (e) {
    r = { kind: "error", message: describe(e), retry: true };
  }

  switch (r.kind) {
    case "wait":
      await store.saveJob(job.id, { status: "procesando", state: r.state, message: r.message ?? "", next_attempt_at: plus(now, r.retryInSec) });
      return r;
    case "done":
      await store.saveJob(job.id, { status: "publicada", external_id: r.external_id, permalink: r.permalink, message: r.message ?? "", published_at: now.toISOString(), state: {} });
      await store.notify(who, post.id, "publicacion_ok", `Se publicó «${post.title}» en ${net}${r.message ? `. ${r.message}` : ""}`);
      return r;
    case "manual":
      await store.saveJob(job.id, { status: "manual", message: r.message, state: r.state ?? job.state });
      await store.notify(who, post.id, "publicacion_manual", `«${post.title}» en ${net}: ${r.message}`);
      return r;
    case "error":
      return fail(r.message, r.retry, r.state ?? job.state);
  }
}

/** Una vuelta del publicador: todo lo que ya tiene que salir, con un límite de tiempo */
export async function runDue(store: Store, http: Http, opts: { now?: Date; limit?: number; budgetMs?: number; postId?: string } = {}) {
  const now = opts.now ?? new Date();
  const start = Date.now();
  const jobs = await store.dueJobs(now, opts.limit ?? 20, opts.postId);
  const results: { job: string; network: Network; kind: string; message?: string }[] = [];
  for (const job of jobs) {
    if (Date.now() - start > (opts.budgetMs ?? 45_000)) break;
    if (!(await store.claim(job))) continue;
    const r = await runJob(store, job, http, now);
    results.push({ job: job.id, network: job.network, kind: r.kind, message: "message" in r ? r.message : undefined });
  }
  return results;
}
