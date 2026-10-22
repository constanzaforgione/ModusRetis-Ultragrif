// TikTok: API de publicación de contenido. TikTok baja el video o las fotos desde nuestra URL pública
// (el dominio tiene que estar verificado en el portal de desarrolladores).
// Dos modos (TIKTOK_MODE):
//   "inbox"  (por defecto) el video llega a la bandeja de borradores de TikTok y alguien toca Publicar.
//            Funciona sin la auditoría de TikTok.
//   "direct" se publica solo. Sin auditoría aprobada, TikTok solo deja publicar en privado.
// https://developers.tiktok.com/doc/content-posting-api-get-started
import { ApiError, callJson, captionOf, describe, type Http, type Publisher, type StepResult } from "./common";

const API = "https://open.tiktokapis.com/v2";

const ttError = (b: Record<string, unknown>) => {
  const e = b.error as { code?: string; message?: string } | undefined;
  return e && e.code && e.code !== "ok" ? e.message || e.code : null;
};

async function tt<T = Record<string, unknown>>(http: Http, token: string, path: string, body: unknown) {
  const { body: r } = await callJson<{ data: T }>(
    http,
    `${API}/${path}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) },
    ttError,
  );
  return r.data;
}

export const tiktokMode = () => (process.env.TIKTOK_MODE === "direct" ? "direct" : "inbox");

export const tiktok: Publisher = {
  network: "tiktok",

  check(post, media) {
    if (post.format === "historia") return "Las stories de TikTok se publican desde la app.";
    if (post.format === "articulo") return "TikTok no publica artículos.";
    if (!media.length) return "TikTok necesita un video o fotos.";
    if (media.some((m) => m.kind === "document")) return "TikTok no publica PDF.";
    const videos = media.filter((m) => m.kind === "video");
    if (videos.length > 1 || (videos.length && media.length > 1)) return "En TikTok va un video solo, o hasta 35 fotos.";
    if (media.length > 35) return "TikTok admite hasta 35 fotos por publicación.";
    if (media.some((m) => m.kind === "image" && !/jpe?g|webp/.test(m.mime))) return "TikTok solo acepta fotos JPG o WEBP.";
    return null;
  },

  async step({ post, media, account, state }, http): Promise<StepResult> {
    const token = account.access_token;
    const mode = tiktokMode();
    const caption = captionOf(post);
    const isVideo = media[0].kind === "video";
    try {
      // 1. Iniciar la publicación (TikTok baja el material de nuestra URL)
      let publishId = state.publish_id as string | undefined;
      if (!publishId) {
        let privacy = "SELF_ONLY";
        if (mode === "direct") {
          const info = await tt<{ privacy_level_options?: string[] }>(http, token, "post/publish/creator_info/query/", {});
          const opts = info.privacy_level_options ?? [];
          privacy = opts.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : (opts[0] ?? "SELF_ONLY");
        }
        if (isVideo) {
          const path = mode === "direct" ? "post/publish/video/init/" : "post/publish/inbox/video/init/";
          const body =
            mode === "direct"
              ? { post_info: { title: caption.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false }, source_info: { source: "PULL_FROM_URL", video_url: media[0].url } }
              : { source_info: { source: "PULL_FROM_URL", video_url: media[0].url } };
          publishId = (await tt<{ publish_id: string }>(http, token, path, body)).publish_id;
        } else {
          publishId = (
            await tt<{ publish_id: string }>(http, token, "post/publish/content/init/", {
              post_info: { title: post.title.slice(0, 90), description: caption.slice(0, 4000), privacy_level: privacy, disable_comment: false, auto_add_music: true },
              source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: media.map((m) => m.url) },
              post_mode: mode === "direct" ? "DIRECT_POST" : "MEDIA_UPLOAD",
              media_type: "PHOTO",
            })
          ).publish_id;
        }
      }

      // 2. Seguir el estado hasta que termine
      const st = await tt<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(http, token, "post/publish/status/fetch/", { publish_id: publishId });
      const next = { ...state, publish_id: publishId };
      if (st.status === "FAILED") return { kind: "error", retry: true, message: `TikTok no pudo publicarlo (${st.fail_reason ?? "sin detalle"}).`, state: {} };
      if (st.status === "SEND_TO_USER_INBOX" || (mode === "inbox" && st.status === "PUBLISH_COMPLETE" && !st.publicaly_available_post_id?.length))
        return { kind: "manual", message: `Ya está en los borradores de TikTok de ${account.username || "la cuenta"}: abrí TikTok, revisá y tocá Publicar. Copy listo para pegar en la pieza.`, state: next };
      if (st.status === "PUBLISH_COMPLETE") {
        const id = st.publicaly_available_post_id?.[0];
        return {
          kind: "done",
          external_id: String(id ?? publishId),
          permalink: id ? `https://www.tiktok.com/@${account.username}/video/${id}` : `https://www.tiktok.com/@${account.username}`,
          message: mode === "direct" && !id ? "Publicada en privado: TikTok todavía no aprobó la app para publicar en público." : undefined,
        };
      }
      return { kind: "wait", state: next, retryInSec: 60, message: "TikTok está procesando…" };
    } catch (e) {
      return { kind: "error", retry: !(e instanceof ApiError && e.permanent), message: describe(e), state };
    }
  },
};

// ---------------------------------------------------------------- conexión (OAuth)
export const TIKTOK_SCOPES = ["user.info.basic", "user.info.profile", "video.upload", "video.publish"];

export function tiktokAuthUrl(clientKey: string, redirectUri: string, state: string) {
  const q = new URLSearchParams({ client_key: clientKey, response_type: "code", scope: TIKTOK_SCOPES.join(","), redirect_uri: redirectUri, state });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

const tokenError = (b: Record<string, unknown>) => (b.error && b.error !== "ok" && typeof b.error === "string" ? String(b.error_description ?? b.error) : null);

export async function tiktokToken(http: Http, params: Record<string, string>) {
  const { body } = await callJson<{ access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number; open_id: string }>(
    http,
    `${API}/oauth/token/`,
    { method: "POST", body: new URLSearchParams(params), headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    tokenError,
  );
  return body;
}

export async function tiktokConnect(http: Http, clientKey: string, secret: string, redirectUri: string, code: string) {
  const tok = await tiktokToken(http, { client_key: clientKey, client_secret: secret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
  const { body } = await callJson<{ data: { user: { open_id: string; display_name?: string; username?: string; avatar_url?: string } } }>(
    http,
    `${API}/user/info/?fields=open_id,display_name,username,avatar_url`,
    { headers: { Authorization: `Bearer ${tok.access_token}` } },
    ttError,
  );
  const u = body.data.user;
  return { ...tok, account: { external_id: u.open_id ?? tok.open_id, name: u.display_name ?? "", username: u.username ?? "", avatar_url: u.avatar_url ?? "" } };
}
