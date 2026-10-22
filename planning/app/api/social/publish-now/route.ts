// "Publicar ahora" / "Reintentar" desde el panel de la pieza: la programa para ya y la publica en el momento.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseStore } from "@/lib/social/store";
import { runDue } from "@/lib/social/runner";
import { currentUser } from "@/lib/social/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { post_id, network } = (await req.json().catch(() => ({}))) as { post_id?: string; network?: string };
  if (!post_id) return NextResponse.json({ error: "Falta la pieza" }, { status: 400 });
  const { data: can } = await me.supabase.rpc("can_edit_post", { p: post_id });
  if (!can) return NextResponse.json({ error: "No tenés permiso para publicar esta pieza" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel" }, { status: 500 });

  const db = supabaseAdmin();
  const { data: post } = await db.from("social_posts").select("status").eq("id", post_id).single();
  if (post?.status !== "programada") {
    const r = await db.from("social_posts").update({ status: "programada" }).eq("id", post_id);
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }
  const now = new Date().toISOString();
  let q = db
    .from("social_publications")
    .update({ status: "pendiente", attempts: 0, message: "", scheduled_at: now, next_attempt_at: now, updated_at: now })
    .eq("post_id", post_id)
    .in("status", ["pendiente", "error", "manual"]);
  if (network) q = q.eq("network", network);
  const u = await q;
  if (u.error) return NextResponse.json({ error: u.error.message }, { status: 500 });

  const results = await runDue(supabaseStore(db), fetch, { postId: post_id, budgetMs: 45_000 });
  return NextResponse.json({ ok: true, results });
}
