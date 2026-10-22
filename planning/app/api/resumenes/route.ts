// Resúmenes mensuales de los clientes, leídos de ClickUp (se guardan 10 minutos; ?fresh=1 los vuelve a leer)
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/social/auth";
import { clickupConfig, fetchSummaryPages } from "@/lib/clickup";
import { buildSummaries } from "@/lib/summaries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const cfg = clickupConfig(new URL(req.url).searchParams.get("fresh") === "1");
  if (!cfg) return NextResponse.json({ error: "missing_config" }, { status: 503 });
  try {
    const all = buildSummaries(await fetchSummaryPages(fetch, cfg));
    // Los resúmenes que vienen de tareas (WEGA) traen la facturación con la tarifa de cada colaborador: solo admins
    const summaries = me.role === "admin" ? all : all.filter((x) => !x.key.startsWith("task:"));
    return NextResponse.json({ summaries, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
