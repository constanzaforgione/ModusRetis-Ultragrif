// Resúmenes mensuales de los clientes. Viven en la base de la app (monthly_summaries): se escriben acá y,
// si se quiere, se mandan a ClickUp. Los que están en ClickUp se leen (se guardan 10 minutos; ?fresh=1 los
// vuelve a leer) y se copian a la app por las dudas.
// GET lista · POST { action: "save" | "send" | "delete" }
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/social/auth";
import { clickupConfig, fetchSummaryPages, sendSummaryPage, summaryDocFor } from "@/lib/clickup";
import { buildSummaries, copiesToSave, hoursOf, matchClient, mergeSummaries, monthLabel, redact, type StoredSummary, type SummaryPage } from "@/lib/summaries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COLS = "id, client_id, client_name, month, title, content, hours, source, clickup_key, clickup_url, edited, sent_at, updated_at";

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const supabase = me.supabase;
  const cfg = clickupConfig(new URL(req.url).searchParams.get("fresh") === "1");

  // 1. ClickUp (si está conectado): si falla, igual se muestra lo que hay en la app
  let live: SummaryPage[] = [];
  let clickupError: string | null = null;
  if (cfg) {
    try {
      live = buildSummaries(await fetchSummaryPages(fetch, cfg));
      // Los que vienen de tareas pueden traer facturación con la tarifa de cada colaborador: solo admins
      if (me.role !== "admin") live = live.filter((x) => !x.key.startsWith("task:"));
    } catch (e) {
      clickupError = (e as Error).message;
    }
  }

  const [{ data: rows, error }, { data: clients }] = await Promise.all([
    supabase.from("monthly_summaries").select(COLS).order("month", { ascending: false }),
    supabase.from("clients").select("id, name"),
  ]);
  if (error) {
    // Todavía no se corrió el SQL 0008: solo lo de ClickUp
    if (!cfg) return NextResponse.json({ error: "missing_config" }, { status: 503 });
    return NextResponse.json({ summaries: live.map((p) => ({ ...p, source: "clickup", id: null })), at: new Date().toISOString(), clickupError, needsSql: true });
  }
  let stored = (rows ?? []) as StoredSummary[];

  // 2. Copia en la app de lo que está en ClickUp (la hacen admins y líderes al abrir la pestaña)
  if (live.length && me.staff) {
    const { insert, update } = copiesToSave(live, stored);
    const toRow = (p: SummaryPage) => ({
      client_id: matchClient(p.client, clients ?? [])?.id ?? null,
      client_name: p.client,
      month: p.month,
      title: p.name,
      content: p.content,
      hours: p.hours,
      clickup_url: p.url,
      updated_at: p.updated,
    });
    if (insert.length) await supabase.from("monthly_summaries").upsert(insert.map((p) => ({ ...toRow(p), source: "clickup", clickup_key: p.key })), { onConflict: "clickup_key", ignoreDuplicates: true });
    for (const u of update) await supabase.from("monthly_summaries").update(toRow(u.page)).eq("id", u.id);
    if (insert.length || update.length) stored = ((await supabase.from("monthly_summaries").select(COLS).order("month", { ascending: false })).data ?? stored) as StoredSummary[];
  }
  // Las copias de resúmenes que salen de tareas (facturación) siguen siendo solo para admins
  if (me.role !== "admin") stored = stored.filter((s) => !s.clickup_key?.startsWith("task:"));

  const nameOf = (id: string | null) => (id ? (clients ?? []).find((c) => c.id === id)?.name ?? null : null);
  return NextResponse.json({ summaries: mergeSummaries(stored, live, nameOf, (n) => matchClient(n, clients ?? [])), at: new Date().toISOString(), clickupError, clickup: !!cfg });
}

interface SaveBody {
  id?: string | null;
  clickup_key?: string | null;
  clickup_url?: string;
  client_id: string;
  month: string;
  title: string;
  content: string;
}

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!me.staff) return NextResponse.json({ error: "Solo admins y líderes escriben resúmenes" }, { status: 403 });
  const supabase = me.supabase;
  const body = (await req.json().catch(() => ({}))) as { action?: string; summary?: SaveBody; id?: string };

  if (body.action === "save" && body.summary) {
    const s = body.summary;
    if (!s.client_id || !/^\d{4}-\d{2}$/.test(s.month)) return NextResponse.json({ error: "Elegí cliente y mes" }, { status: 400 });
    const content = redact(s.content ?? "");
    const { data: client } = await supabase.from("clients").select("name").eq("id", s.client_id).maybeSingle();
    const row = {
      client_id: s.client_id,
      client_name: client?.name ?? "",
      month: s.month,
      title: s.title?.trim() || `Resumen de avance - ${monthLabel(s.month)}`,
      content,
      hours: hoursOf(content),
      updated_by: me.id,
      updated_at: new Date().toISOString(),
    };
    const fromClickUp = !s.id && s.clickup_key && /^(doc|task):/.test(s.clickup_key);
    const q = s.id
      ? supabase.from("monthly_summaries").update({ ...row, edited: true }).eq("id", s.id)
      : fromClickUp
        ? supabase
            .from("monthly_summaries")
            .upsert(
              { ...row, source: "clickup", clickup_key: s.clickup_key, clickup_url: /^https:\/\/app\.clickup\.com\//.test(s.clickup_url ?? "") ? s.clickup_url : "", edited: true, created_by: me.id },
              { onConflict: "clickup_key" },
            )
        : supabase.from("monthly_summaries").insert({ ...row, source: "app", created_by: me.id });
    const { data, error } = await q.select(COLS).maybeSingle();
    if (error || !data) return NextResponse.json({ error: error?.message ?? "No se pudo guardar" }, { status: 400 });
    return NextResponse.json({ summary: data });
  }

  if (body.action === "delete" && body.id) {
    const { data, error } = await supabase.from("monthly_summaries").delete().eq("id", body.id).select("id");
    if (error || !data?.length) return NextResponse.json({ error: "Solo un admin borra resúmenes" }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "send" && body.id) {
    const cfg = clickupConfig(true);
    if (!cfg) return NextResponse.json({ error: "Falta conectar ClickUp (CLICKUP_API_TOKEN)" }, { status: 503 });
    const { data: s } = await supabase.from("monthly_summaries").select(COLS).eq("id", body.id).maybeSingle();
    if (!s) return NextResponse.json({ error: "No encontramos el resumen" }, { status: 404 });
    const sum = s as StoredSummary;
    try {
      let docId: string | null = null;
      let pageId: string | null = null;
      if (sum.clickup_key?.startsWith("doc:")) [, docId, pageId] = sum.clickup_key.split(":");
      else {
        const { data: client } = sum.client_id ? await supabase.from("clients").select("name").eq("id", sum.client_id).maybeSingle() : { data: null };
        docId = summaryDocFor(await fetchSummaryPages(fetch, cfg), client?.name ?? sum.client_name);
      }
      if (!docId)
        return NextResponse.json(
          { error: `No encontramos el doc de resúmenes de ${sum.client_name} en ClickUp. Creá un doc "Resumen de avance" en su carpeta y volvé a probar.` },
          { status: 404 },
        );
      const sent = await sendSummaryPage(fetch, cfg, { docId, pageId, name: sum.title, content: sum.content });
      const { data } = await supabase
        .from("monthly_summaries")
        .update({ clickup_key: sent.key, clickup_url: sent.url, sent_at: new Date().toISOString() })
        .eq("id", sum.id)
        .select(COLS)
        .maybeSingle();
      return NextResponse.json({ summary: data, url: sent.url });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
}
