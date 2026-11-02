// Reuniones de Granola → tareas. Lee las notas con la API de Granola (solo servidor, GRANOLA_API_KEY),
// se queda con las reuniones "MR …" con las personas elegidas y saca sus puntos de acción.
// Sin IA, los puntos salen de las secciones "Próximos pasos", "Action items", "Pendientes"… y de los
// renglones que dicen algo para hacer ("hay que", "pendiente", "meta para el lunes"). Con IA, los arma Claude.
import { draftTask, fold } from "./voice/interpret";
import type { VoiceContext } from "./voice/plan";
import type { Priority } from "./types";

const API = process.env.GRANOLA_API_URL || "https://public-api.granola.ai/v1";

export interface GranolaConfig {
  key: string;
  /** Prefijo del título: "MR" → "MR Lytton + Coni 30/10" */
  prefix: string;
  /** Nombres (o el comienzo): con al menos uno en el título o entre los participantes */
  people: string[];
  /** Hasta cuántos días para atrás se buscan reuniones nuevas */
  days: number;
}

export function granolaConfig(): GranolaConfig | null {
  const key = process.env.GRANOLA_API_KEY;
  if (!key) return null;
  const list = (v: string | undefined, def: string) =>
    (v ?? def)
      .split(",")
      .map((s) => fold(s.trim()))
      .filter(Boolean);
  return {
    key,
    prefix: (process.env.GRANOLA_PREFIX ?? "MR").trim(),
    people: list(process.env.GRANOLA_PEOPLE, "lytton,mauri,barbi,viole,yani"),
    days: Number(process.env.GRANOLA_DAYS) || 21,
  };
}

/** Una reunión, con lo que nos importa (la API puede cambiar nombres: se aceptan varios) */
export interface Meeting {
  id: string;
  title: string;
  /** AAAA-MM-DD, día de la reunión */
  date: string;
  url: string;
  people: string[];
  summary: string;
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

const dayOf = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);
};

export function toMeeting(n: Raw): Meeting {
  const ev = (n.calendar_event ?? n.event ?? {}) as Raw;
  const when = str(ev.scheduled_start_time) || str(ev.start_time) || str(n.meeting_at) || str(n.created_at);
  const people = [
    ...arr(n.attendees),
    ...arr(ev.invitees),
    ...arr(ev.attendees),
    ...(n.owner ? [n.owner as Raw] : []),
  ].flatMap((p) => [str(p.name), str(p.email)].filter(Boolean));
  const id = str(n.id);
  return {
    id,
    title: str(n.title) || str(ev.event_title) || "Reunión",
    date: dayOf(when),
    url: str(n.web_url) || str(n.url) || `https://notes.granola.ai/d/${id}`,
    people,
    summary: str(n.summary_markdown) || str(n.summary_text) || str(n.summary) || str(n.notes_markdown),
  };
}

/** ¿Es una reunión de Modus Retis (título "MR …") con alguna de las personas elegidas? */
export function isWanted(m: Pick<Meeting, "title" | "people">, cfg: Pick<GranolaConfig, "prefix" | "people">) {
  const p = cfg.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (p && !new RegExp(`^[\\s\\[(#·-]*${p}\\b`, "i").test(m.title)) return false;
  if (!cfg.people.length) return true;
  const words = fold([m.title, ...m.people].join(" ")).match(/[a-z0-9ñ]+/g) ?? [];
  return cfg.people.some((name) => words.some((w) => w.startsWith(name)));
}

async function get<T>(http: typeof fetch, cfg: GranolaConfig, path: string): Promise<T> {
  const res = await http(`${API}${path}`, { headers: { Authorization: `Bearer ${cfg.key}` }, cache: "no-store" });
  if (!res.ok) {
    const msg = res.status === 401 || res.status === 403 ? "Granola rechazó la clave (GRANOLA_API_KEY)" : `Granola respondió ${res.status}`;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/** Reuniones "MR" de los últimos días que no estén en `skip` (ya leídas), con su resumen */
export async function fetchMeetings(http: typeof fetch, cfg: GranolaConfig, skip: Set<string>): Promise<Meeting[]> {
  const since = new Date(Date.now() - cfg.days * 86400_000).toISOString();
  const found: Raw[] = [];
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ created_after: since, page_size: "30" });
    if (cursor) q.set("cursor", cursor);
    const r = await get<Raw>(http, cfg, `/notes?${q}`);
    const notes = arr(r.notes ?? r.data ?? r.items);
    found.push(...notes);
    const next = str(r.cursor) || str(r.next_cursor);
    const more = r.hasMore ?? r.has_more ?? !!next;
    if (!more || !next || next === cursor) break;
    cursor = next;
  }
  const out: Meeting[] = [];
  for (const raw of found) {
    const m = toMeeting(raw);
    if (!m.id || skip.has(m.id) || !isWanted(m, cfg)) continue;
    // El listado puede no traer el resumen: se pide la nota completa
    const full = m.summary ? m : toMeeting({ ...raw, ...(await get<Raw>(http, cfg, `/notes/${encodeURIComponent(m.id)}`)) });
    if (full.summary.trim()) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------- puntos de acción sin IA
const ACTION_HEADING = /pr[oó]xim[oa]s? pasos|siguientes pasos|next steps|action items?|acciones|tareas|pendientes|to.?dos?|acuerdos|compromisos|para hacer/i;
const ACTION_CUE =
  /\b(pendiente|meta para|hay que|tiene(?:n)? que|tenemos que|tengo que|queda(?:n|mos)? en|se compromete|a cargo de|se encarga|me encargo|falta(?:n)?|antes del?|para el (?:lunes|martes|miercoles|jueves|viernes)|esta semana|la semana que viene)\b/;

export interface MeetingItem {
  /** Para recordar qué se revisó */
  key: string;
  meeting_id: string;
  title: string;
  description: string;
  priority: Priority;
  assignee_ids: string[];
  client_id: string | null;
  project_id: string | null;
  /** Proyecto que no existe y conviene crear */
  new_project: string | null;
  start_date: string | null;
  due_date: string | null;
}

const clean = (s: string) =>
  s
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();

/** Renglones del resumen que son cosas para hacer (con sus sub-puntos como detalle) */
export function actionLines(summary: string): { text: string; detail: string[] }[] {
  const out: { text: string; detail: string[] }[] = [];
  let heading = "";
  let last: { text: string; detail: string[]; indent: number } | null = null;
  for (const line of summary.split("\n")) {
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line) ?? /^\s*\*\*(.+?)\*\*:?\s*$/.exec(line);
    if (h) {
      heading = clean(h[1]);
      last = null;
      continue;
    }
    const b = /^(\s*)(?:[-*•]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+)$/.exec(line);
    if (!b) continue;
    const indent = b[1].replace(/\t/g, "  ").length;
    const text = clean(b[2]);
    if (!text) continue;
    if (last && indent > last.indent) {
      last.detail.push(text);
      continue;
    }
    const isAction = ACTION_HEADING.test(heading) || ACTION_CUE.test(fold(text));
    if (isAction) {
      last = { text, detail: [], indent };
      out.push(last);
    } else last = null;
  }
  return out.map(({ text, detail }) => ({ text, detail }));
}

export const itemKey = (meetingId: string, i: number) => `${meetingId}#${i}`;

export function extractLocal(m: Meeting, ctx: VoiceContext): MeetingItem[] {
  const c = { ...ctx, today: m.date || ctx.today };
  const items: MeetingItem[] = [];
  actionLines(m.summary).forEach((line, i) => {
    // "Lytton: armar…" → a cargo de Lytton; "Meta para el lunes: …" → la fecha queda, el rótulo no
    let text = line.text;
    let owner: string | null = null;
    const pre = /^([^:]{2,40}):\s+(.+)$/.exec(text);
    if (pre) {
      const head = fold(pre[1]).trim();
      const person = c.people.find((p) => p.assignable && head.split(/\s+/).some((w) => w.length >= 3 && fold(p.name).split(/\s+/)[0].startsWith(w.slice(0, 4))));
      if (person && head.split(/\s+/).length <= 3) {
        owner = person.id;
        text = pre[2];
      } else if (/^(meta|pendiente|proximo paso|siguiente paso|accion|tarea|to ?do)\b/.test(head)) {
        text = `${pre[2]} ${pre[1].replace(/^\S+\s*/, "")}`.trim();
      } else text = `${pre[1]} – ${pre[2]}`;
    }
    const d = draftTask(text, c);
    if (!d) return;
    if (owner) d.assignee_ids = [owner];
    const same = fold(line.text).includes(fold(d.title).slice(0, 40));
    const description = [...(same && !line.detail.length ? [] : [line.text]), ...line.detail.map((x) => `• ${x}`), `De la reunión «${m.title}» (${m.date}): ${m.url}`].join("\n");
    items.push({
      key: itemKey(m.id, i),
      meeting_id: m.id,
      title: d.title,
      description,
      priority: d.priority,
      assignee_ids: d.assignee_ids,
      client_id: d.client_id,
      project_id: d.project_id,
      new_project: null,
      start_date: d.start_date ?? m.date ?? null,
      due_date: d.due_date,
    });
  });
  return items;
}
