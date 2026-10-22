// LinkedIn con varias páginas: GET lista las páginas para elegir, POST guarda la elegida
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentUser } from "@/lib/social/auth";
import { saveAccount } from "@/lib/social/store";

export const dynamic = "force-dynamic";

type Pending = { id: string; client_id: string; created_by: string; created_at: string; payload: { accounts: { external_id: string; name: string; username: string; avatar_url: string }[]; tokens: Parameters<typeof saveAccount>[2] } };

async function load(id: string | null) {
  const me = await currentUser();
  if (!me?.staff || !id) return { me, pending: null };
  const { data } = await supabaseAdmin().from("social_oauth_pending").select("*").eq("id", id).eq("created_by", me.id).maybeSingle();
  const p = data as Pending | null;
  return { me, pending: p && Date.now() - new Date(p.created_at).getTime() < 30 * 60_000 ? p : null };
}

export async function GET(req: Request) {
  const { pending } = await load(new URL(req.url).searchParams.get("pending"));
  if (!pending) return NextResponse.json({ error: "La elección venció: volvé a conectar LinkedIn." }, { status: 404 });
  return NextResponse.json({ client_id: pending.client_id, pages: pending.payload.accounts.map((a) => ({ id: a.external_id, name: a.name, username: a.username })) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { pending?: string; page?: string };
  const { me, pending } = await load(body.pending ?? null);
  if (!me || !pending) return NextResponse.json({ error: "La elección venció: volvé a conectar LinkedIn." }, { status: 404 });
  const page = pending.payload.accounts.find((a) => a.external_id === body.page);
  if (!page) return NextResponse.json({ error: "Elegí una página" }, { status: 400 });
  const db = supabaseAdmin();
  await saveAccount(db, { client_id: pending.client_id, network: "linkedin", connected_by: me.id, ...page }, pending.payload.tokens);
  await db.from("social_oauth_pending").delete().eq("id", pending.id);
  return NextResponse.json({ ok: true });
}
