// Instagram: API de Instagram con inicio de sesión de Instagram (graph.instagram.com).
// Publicar = crear un "contenedor" con la URL pública de la foto/video, esperar a que Instagram lo procese
// y publicarlo. Carrusel: un contenedor por foto/video y otro que los agrupa. Stories: una por archivo.
// https://developers.facebook.com/docs/instagram-platform/content-publishing
import { ApiError, callJson, captionOf, describe, type Http, type MediaItem, type Publisher, type StepResult } from "./common";

const VERSION = process.env.INSTAGRAM_GRAPH_VERSION || "v21.0";
const GRAPH = `https://graph.instagram.com/${VERSION}`;

const igError = (b: Record<string, unknown>) => {
  const e = b.error as { message?: string; error_user_msg?: string; code?: number } | undefined;
  return e ? e.error_user_msg || e.message || `Error ${e.code ?? ""}` : null;
};

async function graph<T = Record<string, unknown>>(http: Http, path: string, token: string, params: Record<string, string> = {}, method: "GET" | "POST" = "POST") {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const { body } = await callJson<T>(
    http,
    method === "GET" ? `${GRAPH}/${path}?${qs}` : `${GRAPH}/${path}`,
    method === "GET" ? { method } : { method, body: qs, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    igError,
  );
  return body;
}

const isVideo = (m: MediaItem) => m.kind === "video";

export const instagram: Publisher = {
  network: "instagram",

  check(post, media) {
    if (post.format === "articulo") return "Instagram no publica artículos.";
    if (media.some((m) => m.kind === "document")) return "Instagram no publica PDF: subí las placas como imágenes JPG.";
    if (!media.length) return "Instagram necesita al menos una foto o un video.";
    const notJpeg = media.find((m) => m.kind === "image" && !/jpe?g/.test(m.mime));
    if (notJpeg) return "Instagram solo acepta fotos JPG por la API: volvé a subir la imagen (la app la convierte sola).";
    if (post.format === "carrusel" && media.length > 10) return "Un carrusel de Instagram admite hasta 10 fotos o videos.";
    if (post.format !== "carrusel" && post.format !== "historia" && media.length > 1)
      return "Para varias fotos elegí el formato Carrusel (o Historia para subir varias stories).";
    if (post.format === "reel" && !isVideo(media[0])) return "Un reel necesita un video.";
    return null;
  },

  async step({ post, media, account, state }, http): Promise<StepResult> {
    const token = account.access_token;
    const me = account.external_id;
    const caption = captionOf(post);
    const stories = post.format === "historia";
    const carousel = !stories && media.length > 1;
    try {
      // 1. Contenedores (uno por archivo)
      let containers = (state.containers as string[] | undefined) ?? [];
      if (!containers.length) {
        for (const m of media) {
          const params: Record<string, string> = stories
            ? { media_type: "STORIES", ...(isVideo(m) ? { video_url: m.url } : { image_url: m.url }) }
            : carousel
              ? { is_carousel_item: "true", ...(isVideo(m) ? { media_type: "VIDEO", video_url: m.url } : { image_url: m.url }) }
              : isVideo(m)
                ? { media_type: "REELS", video_url: m.url, caption, share_to_feed: "true" }
                : { image_url: m.url, caption };
          const r = await graph<{ id: string }>(http, `${me}/media`, token, params);
          containers = [...containers, r.id];
        }
      }

      // 2. Esperar a que Instagram procese los videos
      for (const id of containers) {
        const r = await graph<{ status_code?: string; status?: string }>(http, id, token, { fields: "status_code,status" }, "GET");
        if (r.status_code === "ERROR" || r.status_code === "EXPIRED")
          return { kind: "error", retry: true, message: `Instagram no pudo procesar el archivo (${r.status ?? r.status_code}).`, state: {} };
        if (r.status_code && r.status_code !== "FINISHED" && r.status_code !== "PUBLISHED")
          return { kind: "wait", state: { ...state, containers }, retryInSec: 60, message: "Instagram está procesando el video…" };
      }

      // 3. Carrusel: contenedor que agrupa
      let toPublish = containers;
      if (carousel) {
        let group = state.carousel as string | undefined;
        if (!group) group = (await graph<{ id: string }>(http, `${me}/media`, token, { media_type: "CAROUSEL", children: containers.join(","), caption })).id;
        const r = await graph<{ status_code?: string }>(http, group, token, { fields: "status_code" }, "GET");
        if (r.status_code && r.status_code !== "FINISHED")
          return { kind: "wait", state: { ...state, containers, carousel: group }, retryInSec: 30, message: "Instagram está armando el carrusel…" };
        toPublish = [group];
        state = { ...state, carousel: group };
      }

      // 4. Publicar (de a uno, guardando lo publicado para no repetir si algo falla en el medio)
      const published = [...((state.published as string[] | undefined) ?? [])];
      for (const c of toPublish.slice(published.length)) {
        try {
          published.push((await graph<{ id: string }>(http, `${me}/media_publish`, token, { creation_id: c })).id);
        } catch (e) {
          return { kind: "error", retry: !(e instanceof ApiError && e.permanent), message: describe(e), state: { ...state, containers, published } };
        }
      }

      // 5. Link y primer comentario
      const mediaId = published[0];
      let permalink = "";
      try {
        permalink = (await graph<{ permalink?: string }>(http, mediaId, token, { fields: "permalink" }, "GET")).permalink ?? "";
      } catch {}
      let message: string | undefined;
      if (post.first_comment.trim() && !stories) {
        try {
          await graph(http, `${mediaId}/comments`, token, { message: post.first_comment.trim() });
        } catch (e) {
          message = `Se publicó, pero no se pudo poner el primer comentario: ${describe(e)}`;
        }
      }
      return { kind: "done", external_id: published.join(","), permalink: permalink || `https://www.instagram.com/${account.username}/`, message };
    } catch (e) {
      return { kind: "error", retry: !(e instanceof ApiError && e.permanent), message: describe(e), state };
    }
  },
};

// ---------------------------------------------------------------- conexión (OAuth)
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments"];

export function instagramAuthUrl(appId: string, redirectUri: string, state: string) {
  const q = new URLSearchParams({ enable_fb_login: "0", force_authentication: "1", client_id: appId, redirect_uri: redirectUri, response_type: "code", scope: INSTAGRAM_SCOPES.join(","), state });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

/** Código → token de 60 días + datos de la cuenta */
export async function instagramConnect(http: Http, appId: string, secret: string, redirectUri: string, code: string) {
  const { body: short } = await callJson<{ access_token: string; user_id: number | string }>(
    http,
    "https://api.instagram.com/oauth/access_token",
    {
      method: "POST",
      body: new URLSearchParams({ client_id: appId, client_secret: secret, grant_type: "authorization_code", redirect_uri: redirectUri, code }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
    (b) => (b.error_message as string) ?? igError(b),
  );
  const { body: long } = await callJson<{ access_token: string; expires_in: number }>(
    http,
    `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: secret, access_token: short.access_token })}`,
    { method: "GET" },
    igError,
  );
  const me = await graph<{ user_id: string; username: string; name?: string; profile_picture_url?: string }>(
    http,
    "me",
    long.access_token,
    { fields: "user_id,username,name,profile_picture_url" },
    "GET",
  );
  return {
    access_token: long.access_token,
    expires_in: long.expires_in,
    account: { external_id: String(me.user_id), username: me.username, name: me.name || me.username, avatar_url: me.profile_picture_url ?? "" },
  };
}

/** Renueva el token de 60 días (hay que hacerlo antes de que venza) */
export async function instagramRefresh(http: Http, token: string) {
  const { body } = await callJson<{ access_token: string; expires_in: number }>(
    http,
    `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`,
    { method: "GET" },
    igError,
  );
  return body;
}
