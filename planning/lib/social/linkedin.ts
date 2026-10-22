// LinkedIn: publicaciones en la página de la empresa (API de "Community Management").
// Fotos, varias fotos, video o PDF (carrusel de documento). El material se sube primero a LinkedIn
// y después se crea la publicación. Los artículos largos no se pueden publicar por la API.
// https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
import { ApiError, callJson, captionOf, describe, type Http, type MediaItem, type Publisher, type StepResult } from "./common";

const API = "https://api.linkedin.com/rest";

/** Versión mensual de la API (AAAAMM). Por defecto, la de hace dos meses: siempre vigente. */
export function linkedinVersion(now = new Date()) {
  if (process.env.LINKEDIN_VERSION) return process.env.LINKEDIN_VERSION;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const liError = (b: Record<string, unknown>) => (typeof b.message === "string" && (b.status || b.serviceErrorCode) ? b.message : null);

const headers = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  "LinkedIn-Version": linkedinVersion(),
  "X-Restli-Protocol-Version": "2.0.0",
  "Content-Type": "application/json",
  ...extra,
});

async function li<T = Record<string, unknown>>(http: Http, token: string, path: string, body?: unknown, method = body ? "POST" : "GET") {
  return callJson<T>(http, `${API}/${path}`, { method, headers: headers(token), body: body ? JSON.stringify(body) : undefined }, liError);
}

/** El texto de LinkedIn usa caracteres reservados: se escapan y los #hashtags quedan como hashtags */
export function littleText(text: string) {
  return text.replace(/#([\p{L}\p{N}_]+)|[\\|{}@[\]()<>#*_~]/gu, (m, tag?: string) => (tag ? `{hashtag|\\#|${tag}}` : `\\${m}`));
}

async function download(http: Http, url: string) {
  const res = await http(url);
  if (!res.ok) throw new ApiError(`No se pudo bajar el archivo (${res.status})`, res.status, res.status === 404);
  return new Uint8Array(await res.arrayBuffer());
}

/** Sube una foto o un PDF y devuelve su URN */
async function uploadSimple(http: Http, token: string, owner: string, m: MediaItem) {
  const kind = m.kind === "document" ? "documents" : "images";
  const { body } = await li<{ value: { uploadUrl: string; image?: string; document?: string } }>(http, token, `${kind}?action=initializeUpload`, { initializeUploadRequest: { owner } });
  const bytes = await download(http, m.url);
  const put = await http(body.value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: bytes });
  if (!put.ok) throw new ApiError(`LinkedIn no aceptó el archivo (${put.status})`, put.status);
  return (body.value.image ?? body.value.document)!;
}

/** Sube un video en partes y lo cierra */
async function uploadVideo(http: Http, token: string, owner: string, m: MediaItem) {
  const bytes = await download(http, m.url);
  const { body } = await li<{ value: { video: string; uploadToken: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] } }>(
    http,
    token,
    "videos?action=initializeUpload",
    { initializeUploadRequest: { owner, fileSizeBytes: bytes.byteLength, uploadCaptions: false, uploadThumbnail: false } },
  );
  const parts: string[] = [];
  for (const ins of body.value.uploadInstructions) {
    const put = await http(ins.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes.slice(ins.firstByte, ins.lastByte + 1) });
    if (!put.ok) throw new ApiError(`LinkedIn no aceptó el video (${put.status})`, put.status);
    parts.push(put.headers.get("etag") ?? "");
  }
  await li(http, token, "videos?action=finalizeUpload", { finalizeUploadRequest: { video: body.value.video, uploadToken: body.value.uploadToken, uploadedPartIds: parts } });
  return body.value.video;
}

export const linkedin: Publisher = {
  network: "linkedin",

  check(post, media) {
    if (post.format === "historia") return "LinkedIn no tiene stories.";
    if (post.format === "articulo") return "Los artículos de LinkedIn se escriben y publican desde LinkedIn (la API no lo permite).";
    const docs = media.filter((m) => m.kind === "document");
    const videos = media.filter((m) => m.kind === "video");
    if (docs.length > 1 || (docs.length && media.length > 1)) return "En LinkedIn un carrusel de documento lleva un solo PDF, sin otras fotos.";
    if (videos.length > 1 || (videos.length && media.length > 1)) return "En LinkedIn un video va solo, sin otras fotos.";
    if (media.length > 20) return "LinkedIn admite hasta 20 fotos por publicación.";
    if (!media.length && !post.copy.trim()) return "La publicación no tiene texto ni material.";
    return null;
  },

  async step({ post, media, account, state }, http): Promise<StepResult> {
    const token = account.access_token;
    const owner = account.external_id; // urn:li:organization:123
    try {
      // 1. Subir el material (una sola vez)
      let assets = (state.assets as string[] | undefined) ?? [];
      if (media.length && !assets.length) {
        for (const m of media) assets = [...assets, m.kind === "video" ? await uploadVideo(http, token, owner, m) : await uploadSimple(http, token, owner, m)];
      }
      // 2. Videos: esperar a que LinkedIn los procese
      const video = media.find((m) => m.kind === "video");
      if (video) {
        const { body } = await li<{ status?: string }>(http, token, `videos/${encodeURIComponent(assets[0])}`);
        if (body.status === "PROCESSING_FAILED") return { kind: "error", retry: true, message: "LinkedIn no pudo procesar el video.", state: {} };
        if (body.status && body.status !== "AVAILABLE") return { kind: "wait", state: { ...state, assets }, retryInSec: 60, message: "LinkedIn está procesando el video…" };
      }

      // 3. Crear la publicación
      let postUrn = state.post as string | undefined;
      if (!postUrn) {
        const doc = media[0]?.kind === "document";
        const content =
          assets.length === 0
            ? undefined
            : assets.length > 1
              ? { multiImage: { images: assets.map((id) => ({ id, altText: post.title.slice(0, 120) })) } }
              : { media: { id: assets[0], title: doc ? post.title.slice(0, 200) : undefined, altText: !doc && !video ? post.title.slice(0, 120) : undefined } };
        const { headers: h } = await li(http, token, "posts", {
          author: owner,
          commentary: littleText(captionOf(post)),
          visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
          ...(content ? { content } : {}),
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        });
        postUrn = h.get("x-restli-id") ?? h.get("x-linkedin-id") ?? "";
        if (!postUrn) return { kind: "error", retry: false, message: "LinkedIn no devolvió el id de la publicación.", state: { ...state, assets } };
      }

      // 4. Primer comentario (ahí suele ir el link para no perder alcance)
      let message: string | undefined;
      if (post.first_comment.trim()) {
        try {
          await li(http, token, `socialActions/${encodeURIComponent(postUrn)}/comments`, { actor: owner, object: postUrn, message: { text: post.first_comment.trim() } });
        } catch (e) {
          message = `Se publicó, pero no se pudo poner el primer comentario: ${describe(e)}`;
        }
      }
      return { kind: "done", external_id: postUrn, permalink: `https://www.linkedin.com/feed/update/${postUrn}/`, message };
    } catch (e) {
      return { kind: "error", retry: !(e instanceof ApiError && e.permanent), message: describe(e), state };
    }
  },
};

// ---------------------------------------------------------------- conexión (OAuth)
export const LINKEDIN_SCOPES = ["w_organization_social", "r_organization_social", "rw_organization_admin"];

export function linkedinAuthUrl(clientId: string, redirectUri: string, state: string) {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state, scope: LINKEDIN_SCOPES.join(" ") });
  return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
}

const tokenError = (b: Record<string, unknown>) => (b.error ? String(b.error_description ?? b.error) : null);

export async function linkedinToken(http: Http, params: Record<string, string>) {
  const { body } = await callJson<{ access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number }>(
    http,
    "https://www.linkedin.com/oauth/v2/accessToken",
    { method: "POST", body: new URLSearchParams(params), headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    tokenError,
  );
  return body;
}

/** Código → token + páginas que administra quien se conectó */
export async function linkedinConnect(http: Http, clientId: string, secret: string, redirectUri: string, code: string) {
  const tok = await linkedinToken(http, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: secret });
  const { body } = await li<{ elements: { organization: string }[] }>(http, tok.access_token, "organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED");
  const orgs = [];
  for (const el of body.elements ?? []) {
    const id = el.organization.split(":").pop()!;
    let name = el.organization;
    let vanity = "";
    try {
      const { body: o } = await li<{ localizedName?: string; vanityName?: string }>(http, tok.access_token, `organizations/${id}`);
      name = o.localizedName ?? name;
      vanity = o.vanityName ?? "";
    } catch {}
    orgs.push({ external_id: el.organization, name, username: vanity, avatar_url: "" });
  }
  return { ...tok, accounts: orgs };
}
