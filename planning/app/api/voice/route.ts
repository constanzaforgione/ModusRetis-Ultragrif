// Dictado por voz → plan de cambios (tareas y proyectos nuevos, cambios en los que ya existen).
// Con ANTHROPIC_API_KEY lo interpreta Claude; sin clave devuelve { ai: false } y el navegador usa el
// intérprete local (gratis). Siempre son borradores: la persona los revisa antes de guardar y RLS valida al guardar.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { todayISO } from "@/lib/dates";
import { buildVoiceContext, sanitizePlan, type VoiceAction, type VoiceContext } from "@/lib/voice/plan";
import type { Profile } from "@/lib/types";

export const maxDuration = 60;

const PRIORITY = z.enum(["baja", "media", "alta", "urgente"]);
const STATUS = z.enum(["pendiente", "en_curso", "bloqueada", "en_revision", "hecha"]);
const PSTATUS = z.enum(["planificado", "en_curso", "en_pausa", "completado"]);
const DATE = z.string().nullable().describe("AAAA-MM-DD, o null si no se dijo");

const AiPlan = z.object({
  new_projects: z.array(
    z.object({
      ref: z.string().describe("Identificador corto (nuevo-1, nuevo-2…) para que las tareas nuevas de este dictado lo usen en project_ref"),
      name: z.string(),
      description: z.string(),
      client_id: z.string().nullable(),
      start_date: z.string().describe("AAAA-MM-DD; si no se dijo, hoy"),
      end_date: z.string().describe("AAAA-MM-DD; si no se dijo, un mes después del inicio"),
      owner_ids: z.array(z.string()),
    }),
  ),
  project_changes: z.array(
    z.object({
      project_id: z.string(),
      status: PSTATUS.nullable(),
      start_date: DATE,
      end_date: DATE,
      name: z.string().nullable(),
    }),
  ),
  new_tasks: z.array(
    z.object({
      title: z.string().describe("Título corto y accionable, verbo en infinitivo"),
      description: z.string().describe("Detalle o contexto dictado; vacío si no hay"),
      priority: PRIORITY,
      assignee_ids: z.array(z.string()).describe("ids de personas asignables; vacío = quien dicta"),
      client_id: z.string().nullable(),
      project_id: z.string().nullable().describe("id de un proyecto existente"),
      project_ref: z.string().nullable().describe("ref de un proyecto nuevo de este mismo dictado"),
      start_date: DATE,
      due_date: DATE,
      start_time: z.string().nullable().describe("HH:MM si se dijo una hora"),
    }),
  ),
  task_changes: z.array(
    z.object({
      task_id: z.string(),
      status: STATUS.nullable(),
      priority: PRIORITY.nullable(),
      start_date: DATE,
      due_date: DATE,
      start_time: z.string().nullable(),
      assignee_ids: z.array(z.string()).nullable(),
      project_id: z.string().nullable(),
      title: z.string().nullable(),
      note: z.string().nullable().describe("Texto para agregar a la descripción"),
    }),
  ),
  not_understood: z.array(z.string()).describe("Partes del dictado que no se pudieron convertir en nada"),
});

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const SYSTEM = (today: string) => `Sos el asistente de planificación de Modus Retis, una agencia tecnológica argentina.
Recibís lo que una persona dictó por voz (con errores de transcripción, muletillas, ideas mezcladas o en desorden) y lo convertís en cambios concretos en la app:
- new_projects: proyectos nuevos del roadmap (solo si pide crear uno).
- project_changes: cambios en proyectos existentes (estado, fechas, nombre).
- new_tasks: tareas nuevas. Una por cada cosa a hacer, aunque las diga todas juntas. Interpretá la intención: el título es breve, claro y empieza con un verbo en infinitivo ("Enviar presupuesto a Placebo"), no la frase tal cual; el contexto útil va a la descripción.
- task_changes: cambios en tareas existentes (estado, prioridad, fechas, responsables, proyecto, título) cuando se refiere a una de la lista.
Reglas:
- Hoy es ${DIAS[new Date(`${today}T12:00:00Z`).getUTCDay()]} ${today} (Argentina). Resolvé fechas relativas ("el viernes", "la semana que viene", "fin de mes", "en dos semanas") a AAAA-MM-DD. "Para el X" = due_date.
- Prioridad: "urgente", "ya", "sí o sí" → urgente; "importante" → alta; "cuando puedas", "sin apuro" → baja; si no dice, media.
- "contexto.desde" es dónde está parada la persona: si dice "agregá tareas" sin nombrar proyecto o cliente, van a ese proyecto o cliente. Si nombra otro proyecto, va al que nombra.
- Las tareas de un proyecto llevan el client_id del proyecto. Si las tareas van a un proyecto nuevo del mismo dictado, usá project_ref con su ref.
- Matcheá nombres aunque estén mal transcriptos ("ultra grif" = Ultragrif, "Yani" = Yanina). Usá solo ids de las listas; si no hay uno claro, null.
- assignee_ids solo con personas asignables. Si la persona no se puede asignar, dejalo vacío.
- No inventes nada que no se haya dicho. Si algo no se entiende, ponelo en not_understood.`;

/** Lo que devuelve Claude, en el formato común de la app */
function toActions(p: z.infer<typeof AiPlan>, ctx: VoiceContext): VoiceAction[] {
  const pid = (id: string | null) => (id && ctx.projects.some((x) => x.id === id) ? id : null);
  return [
    ...p.new_projects.map((x): VoiceAction => ({ kind: "create_project", ref: x.ref, project: { ...x } })),
    ...p.project_changes.map(
      (x): VoiceAction => ({
        kind: "update_project",
        project_id: x.project_id,
        changes: { status: x.status ?? undefined, start_date: x.start_date ?? undefined, end_date: x.end_date ?? undefined, name: x.name ?? undefined },
      }),
    ),
    ...p.new_tasks.map((x): VoiceAction => {
      const project = pid(x.project_id);
      const client = x.client_id ?? (project ? ctx.projects.find((q) => q.id === project)!.client_id : null);
      return { kind: "create_task", task: { ...x, project_id: project, client_id: client } };
    }),
    ...p.task_changes.map(
      (x): VoiceAction => ({
        kind: "update_task",
        task_id: x.task_id,
        changes: {
          status: x.status ?? undefined,
          priority: x.priority ?? undefined,
          start_date: x.start_date ?? undefined,
          due_date: x.due_date ?? undefined,
          start_time: x.start_time ?? undefined,
          assignee_ids: x.assignee_ids ?? undefined,
          project_id: x.project_id ?? undefined,
          title: x.title ?? undefined,
          note: x.note ?? undefined,
        },
      }),
    ),
  ];
}

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { transcript, scope } = (await req.json().catch(() => ({}))) as { transcript?: string; scope?: VoiceContext["scope"] };
  const text = (transcript ?? "").trim().slice(0, 6000);
  if (!text) return NextResponse.json({ error: "No llegó texto dictado" }, { status: 400 });

  // Sin clave: el navegador interpreta con el intérprete local
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ ai: false });

  const [{ data: profiles }, { data: clients }, { data: projects }, { data: tasks }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, lead_id, role, active"),
    supabase.from("clients").select("id, name, active"),
    supabase.from("projects").select("id, name, client_id, start_date, end_date, status").limit(300),
    supabase.from("tasks").select("id, title, project_id, client_id, status, due_date, assignee_id, assignee_ids, created_by").neq("status", "hecha").limit(600),
  ]);
  const me = profiles?.find((p) => p.id === user.id);
  if (!me) return NextResponse.json({ error: "No encontramos tu perfil" }, { status: 403 });
  const ctx = buildVoiceContext({
    me: me as Profile,
    profiles: (profiles ?? []) as Profile[],
    clients: clients ?? [],
    projects: projects ?? [],
    tasks: tasks ?? [],
    today: todayISO(),
    scope: { project_id: scope?.project_id ?? null, client_id: scope?.client_id ?? null },
  });

  const desde = ctx.scope.project_id
    ? { proyecto: ctx.projects.find((p) => p.id === ctx.scope.project_id)?.name, project_id: ctx.scope.project_id }
    : ctx.scope.client_id
      ? { cliente: ctx.clients.find((c) => c.id === ctx.scope.client_id)?.name, client_id: ctx.scope.client_id }
      : "la app en general";
  const context = {
    quien_dicta: { id: ctx.me.id, nombre: ctx.me.name, puede_crear_proyectos: ctx.me.staff },
    desde,
    personas: ctx.people.map((p) => ({ id: p.id, nombre: p.name, asignable: p.assignable })),
    clientes: ctx.clients,
    proyectos: ctx.projects.map((p) => ({ id: p.id, nombre: p.name, client_id: p.client_id, inicio: p.start_date, fin: p.end_date, estado: p.status })),
    tareas_abiertas_editables: ctx.tasks.map((t) => ({ id: t.id, titulo: t.title, project_id: t.project_id, client_id: t.client_id, estado: t.status, vence: t.due_date })),
  };

  // Modelo configurable: VOICE_MODEL=claude-haiku-5-5 sale ~40 veces más barato
  const model = process.env.VOICE_MODEL || "claude-opus-5-5";
  const fallback = !/haiku/.test(model);
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: "low", format: betaZodOutputFormat(AiPlan) },
      system: SYSTEM(ctx.today),
      messages: [{ role: "user", content: `<contexto>\n${JSON.stringify(context)}\n</contexto>\n\n<dictado>\n${text}\n</dictado>` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return NextResponse.json({ error: "No pudimos interpretar el dictado. Probá de nuevo o cargalo a mano." }, { status: 422 });
    }
    const parsed = response.parsed_output;
    const plan = sanitizePlan({ actions: toActions(parsed, ctx), unmatched: parsed.not_understood }, ctx);
    return NextResponse.json({ plan, ai: true });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Mucho uso en este momento, probá en un minuto.", fallback: true }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("voice: Claude API", err.status, err.message);
      return NextResponse.json({ error: "El asistente no respondió.", fallback: true }, { status: 502 });
    }
    throw err;
  }
}
