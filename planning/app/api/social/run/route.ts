// Publicador: lo llama Supabase cada 5 minutos (pg_cron, ver supabase/cron_publicacion.sql).
// Publica lo que ya tiene que salir y renueva las conexiones que están por vencer.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseStore } from "@/lib/social/store";
import { freshToken, runDue } from "@/lib/social/runner";
import type { Network } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const store = supabaseStore(db);
  const results = await runDue(store, fetch, { budgetMs: 40_000 });

  // Conexiones que vencen en menos de 7 días aunque no haya nada para publicar (Instagram vence a los 60 días)
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const { data: accounts } = await db.from("social_accounts").select("client_id, network").eq("status", "conectada").lt("expires_at", soon).limit(10);
  let refreshed = 0;
  for (const a of (accounts ?? []) as { client_id: string; network: Network }[]) {
    const acc = await store.loadAccount(a.client_id, a.network);
    if (!acc) continue;
    try {
      if ((await freshToken(store, acc, a.network, fetch)) !== acc.access_token) refreshed++;
    } catch {}
  }
  return NextResponse.json({ ok: true, published: results, refreshed });
}

export const GET = run;
export const POST = run;
