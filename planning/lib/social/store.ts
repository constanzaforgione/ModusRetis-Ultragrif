// Store del publicador sobre Supabase (service role: lee las credenciales y escribe sin RLS). Solo servidor.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Network } from "../types";
import type { MediaItem } from "./common";
import type { Job, Store, StoredAccount, StoredPost } from "./runner";

export function supabaseStore(db: SupabaseClient): Store {
  const must = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  return {
    async dueJobs(now, limit, postId) {
      let q = db
        .from("social_publications")
        .select("id, post_id, network, status, attempts, state, scheduled_at, updated_at")
        .in("status", ["pendiente", "procesando"])
        .lte("scheduled_at", now.toISOString())
        .lte("next_attempt_at", now.toISOString())
        .order("scheduled_at")
        .limit(limit);
      if (postId) q = q.eq("post_id", postId);
      return must(await q) as Job[];
    },
    async claim(job) {
      const r = await db.from("social_publications").update({ updated_at: new Date().toISOString() }).eq("id", job.id).eq("updated_at", job.updated_at).select("id");
      return !r.error && (r.data?.length ?? 0) > 0;
    },
    async loadPost(id) {
      const r = await db.from("social_posts").select("id, client_id, status, title, copy, hashtags, format, first_comment, assignee_id, created_by").eq("id", id).maybeSingle();
      return must(r) as StoredPost | null;
    },
    async loadMedia(postId) {
      const r = await db.from("social_media").select("url, kind, mime, size_bytes, width, height, duration").eq("post_id", postId).order("position");
      return must(r) as MediaItem[];
    },
    async loadAccount(clientId, network: Network) {
      const r = await db
        .from("social_accounts")
        .select("id, external_id, username, social_account_tokens(access_token, refresh_token, expires_at)")
        .eq("client_id", clientId)
        .eq("network", network)
        .maybeSingle();
      const a = must(r) as { id: string; external_id: string; username: string; social_account_tokens: { access_token: string; refresh_token: string | null; expires_at: string | null } | { access_token: string; refresh_token: string | null; expires_at: string | null }[] | null } | null;
      if (!a) return null;
      const t = Array.isArray(a.social_account_tokens) ? a.social_account_tokens[0] : a.social_account_tokens;
      if (!t) return null;
      return { id: a.id, external_id: a.external_id, username: a.username, ...t } satisfies StoredAccount;
    },
    async clientName(clientId) {
      const r = await db.from("clients").select("name").eq("id", clientId).maybeSingle();
      return (r.data as { name: string } | null)?.name ?? "El cliente";
    },
    async saveJob(id, patch) {
      must(await db.from("social_publications").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id));
    },
    async saveToken(accountId, patch) {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      must(await db.from("social_account_tokens").update({ ...clean, updated_at: new Date().toISOString() }).eq("account_id", accountId));
      must(await db.from("social_accounts").update({ expires_at: patch.expires_at, status: "conectada", last_error: "", updated_at: new Date().toISOString() }).eq("id", accountId));
    },
    async markAccount(accountId, status, error) {
      await db.from("social_accounts").update({ status, last_error: error, updated_at: new Date().toISOString() }).eq("id", accountId);
    },
    async notify(userId, postId, kind, message) {
      if (!userId) return;
      await db.rpc("push_post_notification", { p_user: userId, p_post: postId, p_kind: kind, p_message: message });
    },
  };
}

/** Guarda (o reemplaza) la cuenta conectada de un cliente en una red, con sus credenciales */
export async function saveAccount(
  db: SupabaseClient,
  a: { client_id: string; network: Network; external_id: string; name: string; username: string; avatar_url: string; connected_by: string },
  t: { access_token: string; refresh_token?: string | null; expires_in?: number | null; refresh_expires_in?: number | null },
) {
  const now = Date.now();
  const expires_at = t.expires_in ? new Date(now + t.expires_in * 1000).toISOString() : null;
  const { data, error } = await db
    .from("social_accounts")
    .upsert({ ...a, status: "conectada", last_error: "", expires_at, updated_at: new Date().toISOString() }, { onConflict: "client_id,network" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const r = await db.from("social_account_tokens").upsert({
    account_id: (data as { id: string }).id,
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? null,
    expires_at,
    refresh_expires_at: t.refresh_expires_in ? new Date(now + t.refresh_expires_in * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (r.error) throw new Error(r.error.message);
  return (data as { id: string }).id;
}
