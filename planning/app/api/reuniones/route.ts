// Tareas desde reuniones de Granola.
// GET  → lee las reuniones "MR" nuevas, saca sus puntos de acción (una sola vez por reunión) y devuelve
//        las que faltan revisar. POST → marca reuniones como revisadas (después de elegir qué importar).
// Solo para quien tiene la clave de Granola configurada (GRANOLA_USERS, o admins si no se configuró).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { extractLocal, fetchMeetings, granolaConfig, itemKey, type Meeting, type MeetingItem } from "@/lib/granola";
import { loadVoiceContext } from "@/lib/voice/server";
import type { VoiceContext } from "@/lib/voice/plan";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const allowed = (me: Profile, authEmail: string | undefined) => {
  const list = (process.env.GRANOLA_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const emails = [authEmail, me.email].filter(Boolean).map((e) => e!.toLowerCase());
  return list.length ? emails.some((e) => list.includes(e)) : me.role === "admin" && me.active;
};

const Items = z.object({
  items: z.array(
    z.object({
      title: z.string().describe("Título corto y accionable, verbo en infinitivo"),
      description: z.string().describe("Contexto útil de la reunión para hacer la tarea"),
      priority: z.enum(["baja", "media", "alta", "urgente"]),
      assignee_ids: z.array(z.string()).describe("ids de personas asignables que quedaron a cargo; vacío = quien importa"),
      client_id: z.string().nullable(),
      project_id: z.string().nullable().describe("id de un proyecto existente si corresponde"),
      new_project: z.string().nullable().describe("Nombre de un proyecto nuevo si la tarea es de un proyecto que no existe; si no, null"),
      start_date: z.string().nullable().describe("AAAA-MM-DD"),
      due_date: z.string().nullable().describe("AAAA-MM-DD"),
    }),
  ),
});

async function extractAi(m: Meeting, ctx: VoiceContext): Promise<MeetingItem[]> {
  const model = process.env.VOICE_MODEL || "claude-opus-5-5";
  const fallback = !/haiku/.test(model);
  const client = new Anthropic();
  const context = {
    quien_importa: { id: ctx.me.id, nombre: ctx.me.name },
    personas: ctx.people.filter((p) => p.assignable).map((p) => ({ id: p.id, nombre: p.name })),
    clientes: ctx.clients,
    proyectos: ctx.projects.filter((p) => p.status !== "completado").map((p) => ({ id: p.id, nombre: p.name, client_id: p.client_id })),
  };
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort: "low", format: betaZodOutputFormat(Items) },
    system: `Sos el asistente de planificación de Modus Retis, una agencia tecnológica argentina.
Recibís el resumen de una reunión interna y sacás los puntos de acción: cosas concretas que alguien tiene que hacer después de la reunión.
- Una tarea por acción. No conviertas en tarea lo que es solo información, contexto o algo ya hecho.
- Título breve que empiece con un verbo en infinitivo ("Cargar catálogo de UltraGrif en Meli Retis").
- La reunión fue el ${m.date}: resolvé fechas relativas desde ese día. Si no hay fecha, start_date = día de la reunión y due_date null.
- Responsables: solo ids de la lista de personas; si no queda claro, vacío.
- Cliente y proyecto: solo ids de las listas, aunque el nombre esté mal escrito. Si es claramente un proyecto que no existe, poné su nombre en new_project.
- Prioridad: urgente si se dijo que es urgente o con fecha muy próxima; alta si es importante; si no, media.`,
    messages: [{ role: "user", content: `<contexto>\n${JSON.stringify(context)}\n</contexto>\n\n<reunion titulo="${m.title.replace(/"/g, "'")}" fecha="${m.date}">\n${m.summary.slice(0, 30000)}\n</reunion>` }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return extractLocal(m, ctx);
  const ok = <T extends { id: string }>(list: T[], id: string | null) => (id && list.some((x) => x.id === id) ? id : null);
  const isDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const assignable = ctx.people.filter((p) => p.assignable);
  return response.parsed_output.items.map((x, i) => {
    const ids = x.assignee_ids.filter((id) => assignable.some((p) => p.id === id));
    const project = ok(ctx.projects, x.project_id);
    return {
      key: itemKey(m.id, i),
      meeting_id: m.id,
      title: x.title.trim().slice(0, 200),
      description: `${x.description.trim()}\n\nDe la reunión «${m.title}» (${m.date}): ${m.url}`.trim(),
      priority: x.priority,
      assignee_ids: ids.length ? ids : [ctx.me.id],
      client_id: ok(ctx.clients, x.client_id) ?? (project ? (ctx.projects.find((p) => p.id === project)?.client_id ?? null) : null),
      project_id: project,
      new_project: project ? null : x.new_project?.trim() || null,
      start_date: isDate(x.start_date) ?? (m.date || null),
      due_date: isDate(x.due_date),
    };
  });
}

export async function GET() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const cfg = granolaConfig();
  if (!cfg) return NextResponse.json({ error: "missing_config" }, { status: 503 });
  const loaded = await loadVoiceContext(supabase, user.id);
  if (!loaded) return NextResponse.json({ error: "No encontramos tu perfil" }, { status: 403 });
  if (!allowed(loaded.me, user.email)) return NextResponse.json({ error: "not_enabled" }, { status: 403 });

  const { data: known, error } = await supabase.from("meeting_notes").select("meeting_id").eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Falta correr el SQL 0007_reuniones en Supabase" }, { status: 500 });

  let errorMsg: string | null = null;
  try {
    const fresh = await fetchMeetings(fetch, cfg, new Set((known ?? []).map((k) => k.meeting_id)));
    const ai = !!process.env.ANTHROPIC_API_KEY;
    for (const m of fresh) {
      let items: MeetingItem[];
      try {
        items = ai ? await extractAi(m, loaded.ctx) : extractLocal(m, loaded.ctx);
      } catch (e) {
        console.error("reuniones: IA", (e as Error).message);
        items = extractLocal(m, loaded.ctx);
      }
      await supabase.from("meeting_notes").upsert({
        user_id: user.id,
        meeting_id: m.id,
        title: m.title,
        meeting_date: m.date || null,
        url: m.url,
        items,
        status: items.length ? "pendiente" : "revisada",
      });
    }
  } catch (e) {
    // Si Granola falla igual se muestran las que ya estaban leídas
    errorMsg = (e as Error).message;
  }

  const { data: pending } = await supabase
    .from("meeting_notes")
    .select("meeting_id, title, meeting_date, url, items")
    .eq("user_id", user.id)
    .eq("status", "pendiente")
    .order("meeting_date", { ascending: true });
  return NextResponse.json({ meetings: pending ?? [], ai: !!process.env.ANTHROPIC_API_KEY, error: errorMsg });
}

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { reviewed } = (await req.json().catch(() => ({}))) as { reviewed?: { meeting_id: string; imported: number }[] };
  for (const r of reviewed ?? []) {
    await supabase
      .from("meeting_notes")
      .update({ status: "revisada", imported: r.imported ?? 0, reviewed_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("meeting_id", r.meeting_id);
  }
  return NextResponse.json({ ok: true });
}
