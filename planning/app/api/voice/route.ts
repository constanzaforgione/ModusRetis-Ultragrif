// Dictado por voz → Claude ordena el texto en tareas nuevas y cambios sobre tareas existentes.
// Devuelve borradores: la persona los revisa en pantalla antes de guardar (y RLS valida al guardar).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { todayISO } from "@/lib/dates";

export const maxDuration = 60;

const PRIORITY = z.enum(["baja", "media", "alta", "urgente"]);
const STATUS = z.enum(["pendiente", "en_curso", "bloqueada", "en_revision", "hecha"]);

const Plan = z.object({
  tasks: z.array(
    z.object({
      title: z.string().describe("Título corto y accionable, empieza con verbo"),
      description: z.string().describe("Detalle o contexto dictado; vacío si no hay"),
      priority: PRIORITY,
      assignee_id: z.string().nullable().describe("id de la persona; null = quien dicta"),
      client_id: z.string().nullable().describe("id del cliente; null si es interna o no se menciona"),
      start_date: z.string().nullable().describe("AAAA-MM-DD"),
      due_date: z.string().nullable().describe("AAAA-MM-DD"),
    }),
  ),
  updates: z.array(
    z.object({
      task_id: z.string().describe("id de una tarea existente de la lista"),
      status: STATUS.nullable(),
      priority: PRIORITY.nullable(),
      start_date: z.string().nullable(),
      due_date: z.string().nullable(),
      summary: z.string().describe("Qué cambia, en una frase"),
    }),
  ),
});
export type VoicePlan = z.infer<typeof Plan>;

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { transcript } = (await req.json().catch(() => ({}))) as { transcript?: string };
  const text = (transcript ?? "").trim().slice(0, 6000);
  if (!text) return NextResponse.json({ error: "No llegó texto dictado" }, { status: 400 });

  if (!process.env.ANTHROPIC_API_KEY) {
    // Sin IA: una sola tarea con lo dictado
    const plan: VoicePlan = {
      tasks: [{ title: text.slice(0, 120), description: text.length > 120 ? text : "", priority: "media", assignee_id: null, client_id: null, start_date: null, due_date: null }],
      updates: [],
    };
    return NextResponse.json({ plan, ai: false });
  }

  const [{ data: profiles }, { data: clients }, { data: tasks }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, lead_id, role").eq("active", true),
    supabase.from("clients").select("id, name").eq("active", true),
    supabase.from("tasks").select("id, title, assignee_id, status, due_date").neq("status", "hecha").limit(300),
  ]);
  const me = profiles?.find((p) => p.id === user.id);
  // Solo tareas que quien dicta puede editar (mismo criterio que la base)
  const manageable = new Set(
    (profiles ?? [])
      .filter((p) => p.id === user.id || me?.role === "admin" || (me?.role === "lider" && p.lead_id === user.id))
      .map((p) => p.id),
  );
  const editable = (tasks ?? []).filter((t) => manageable.has(t.assignee_id));

  const today = todayISO();
  const weekday = DIAS[new Date(`${today}T12:00:00Z`).getUTCDay()];

  const system = `Sos el asistente de planificación de Modus Retis, una agencia tecnológica argentina.
Recibís lo que una persona dictó por voz (puede tener errores de transcripción, muletillas o varias ideas mezcladas) y lo convertís en:
- "tasks": tareas nuevas. Una por cada cosa a hacer. Título breve que empiece con verbo en infinitivo; el resto va en la descripción.
- "updates": cambios sobre tareas que ya existen (cambiar estado, prioridad o fechas) cuando la persona se refiere claramente a una de la lista.
Reglas:
- Hoy es ${weekday} ${today} (hora de Argentina). Resolvé fechas relativas ("el viernes", "la semana que viene", "fin de mes") a AAAA-MM-DD. "Para el X" = due_date.
- Prioridad: "urgente", "ya", "hoy sí o sí" → urgente; "importante" → alta; "cuando puedas", "sin apuro" → baja; si no dice nada, media.
- assignee_id: solo ids de "personas asignables". Si no se nombra a nadie o la persona no es asignable, null.
- client_id: solo ids de la lista de clientes, matcheando aunque la transcripción escriba mal el nombre (ej. "meli retis", "ultra grif"). Si no hay cliente claro, null.
- No inventes tareas que no se dictaron. No uses ids que no estén en las listas.`;

  const context = {
    quien_dicta: { id: user.id, nombre: me?.full_name },
    personas_asignables: (profiles ?? []).filter((p) => manageable.has(p.id)).map((p) => ({ id: p.id, nombre: p.full_name })),
    clientes: (clients ?? []).map((c) => ({ id: c.id, nombre: c.name })),
    tareas_existentes_editables: editable.map((t) => ({ id: t.id, titulo: t.title, estado: t.status, vence: t.due_date })),
  };

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(Plan) },
      system,
      messages: [
        {
          role: "user",
          content: `<contexto>\n${JSON.stringify(context)}\n</contexto>\n\n<dictado>\n${text}\n</dictado>`,
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return NextResponse.json({ error: "No pudimos interpretar el dictado. Probá de nuevo o cargala a mano." }, { status: 422 });
    }
    const plan = response.parsed_output;
    // Saneamos ids inventados
    const validPeople = new Set(context.personas_asignables.map((p) => p.id));
    const validClients = new Set(context.clientes.map((c) => c.id));
    const validTasks = new Set(editable.map((t) => t.id));
    const isDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
    plan.tasks = plan.tasks.map((t) => ({
      ...t,
      assignee_id: t.assignee_id && validPeople.has(t.assignee_id) ? t.assignee_id : null,
      client_id: t.client_id && validClients.has(t.client_id) ? t.client_id : null,
      start_date: isDate(t.start_date),
      due_date: isDate(t.due_date),
    }));
    plan.updates = plan.updates
      .filter((u) => validTasks.has(u.task_id))
      .map((u) => ({ ...u, start_date: isDate(u.start_date), due_date: isDate(u.due_date) }));
    return NextResponse.json({ plan, ai: true });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Mucho uso en este momento, probá en un minuto." }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("voice: Claude API", err.status, err.message);
      return NextResponse.json({ error: "El asistente no respondió. Probá de nuevo." }, { status: 502 });
    }
    throw err;
  }
}
