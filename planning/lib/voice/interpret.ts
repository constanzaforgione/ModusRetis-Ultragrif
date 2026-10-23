// Intérprete del dictado sin IA (gratis, en el navegador). Entiende pedidos habituales:
//   "En el proyecto Dashboards Meli agregá tres tareas: revisar métricas, armar el informe y presentarlo el viernes"
//   "Para el lunes tengo que llamar a Ultragrif, es urgente, que lo haga Yani"
//   "Marcá como hecha la de kit de publicaciones" · "Pasá el plan de Ads para el 30"
//   "Creá un proyecto Rediseño web para Ultragrif de noviembre a enero"
// Separa las ideas, detecta proyecto, cliente, persona, fechas y prioridad, y redacta títulos cortos.
// Con la clave de IA configurada, el servidor interpreta mucho mejor y esto queda de respaldo.
import type { Priority, ProjectStatus, TaskStatus } from "../types";
import type { ProjectChanges, TaskChanges, TaskDraftFields, VoiceAction, VoiceContext, VoicePlan } from "./plan";

// ---------------------------------------------------------------- texto
/** Minúsculas sin tildes, con el MISMO largo que el original (para cortar partes del texto original) */
export function fold(s: string) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i].normalize("NFD")[0].toLowerCase();
    out += c.length === 1 ? c : s[i];
  }
  return out;
}

const STOP = new Set(
  "a al el la las los lo le les de del en con para por que y o u un una unos unas mi tu su sus es esta este esto ese esa eso hay tengo tenemos hacer ver tarea tareas proyecto".split(" "),
);
const words = (s: string) => fold(s).match(/[a-z0-9ñ]+/g) ?? [];
const keyWords = (s: string) => words(s).filter((w) => w.length > 2 && !STOP.has(w));

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseISO = (s: string) => new Date(`${s}T12:00:00Z`);
const addDays = (s: string, n: number) => {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const addMonths = (s: string, n: number) => {
  const d = parseISO(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
};
const endOfMonth = (s: string) => {
  const d = parseISO(s);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)));
};
const weekdayOf = (s: string) => parseISO(s).getUTCDay(); // 0 domingo

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MONTH_RE = Object.keys(MONTHS).join("|");
const DAYS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const DAY_RE = Object.keys(DAYS).join("|");
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10, quince: 15, veinte: 20 };
const NUM_RE = `\\d+|${Object.keys(NUM).join("|")}`;
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM[s] ?? 1);

// ---------------------------------------------------------------- partes que se reconocen y se sacan del título
type Span = [number, number];

interface Found {
  due: string | null;
  start: string | null;
  time: string | null;
  priority: Priority | null;
  spans: Span[];
}

const DUE_CUE = "(?:para|hasta|antes del?|que venza|vence|vencimiento|entrega(?:rlo|rla)?|como tarde)";
const START_CUE = "(?:desde|a partir del?|empezando|arrancando|que (?:empiece|arranque))";

/** Fecha suelta en el texto (ya en minúsculas sin tildes) desde `at` */
function dateAt(n: string, today: string): { date: string; start: number; end: number } | null {
  const tries: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [/\bpasado manana\b/, () => addDays(today, 2)],
    [/(?<!la |por la |a la |de la )\bmanana\b/, () => addDays(today, 1)],
    [/\bhoy\b/, () => today],
    [/\bfin de (?:mes|este mes)\b/, () => endOfMonth(today)],
    [/\bfin del mes que viene\b/, () => endOfMonth(addMonths(today, 1))],
    [/\bfin de ano\b/, () => `${today.slice(0, 4)}-12-31`],
    [/\besta semana\b/, () => (weekdayOf(today) >= 5 || weekdayOf(today) === 0 ? today : addDays(today, 5 - weekdayOf(today)))],
    [/\b(?:la semana que viene|la proxima semana|la semana proxima)\b/, () => addDays(today, ((5 - weekdayOf(today) + 7) % 7) + 7 - (weekdayOf(today) === 6 ? 7 : 0))],
    [/\b(?:el mes que viene|el proximo mes)\b/, () => endOfMonth(addMonths(today, 1))],
    [new RegExp(`\\b(?:en|dentro de)\\s+(${NUM_RE})\\s+(dias?|semanas?|mes(?:es)?)\\b`), (m) => {
      const k = num(m[1]);
      return m[2].startsWith("dia") ? addDays(today, k) : m[2].startsWith("semana") ? addDays(today, 7 * k) : addMonths(today, k);
    }],
    [new RegExp(`\\b(?:el\\s+)?(?:proximo\\s+)?(${DAY_RE})(?:\\s+(\\d{1,2}))?(\\s+(?:que viene|proximo))?\\b`), (m) => {
      const want = DAYS[m[1]];
      if (m[2]) {
        // "el lunes 10": manda el número
        const d = Number(m[2]);
        let c = `${today.slice(0, 8)}${pad(d)}`;
        if (c < today) c = addMonths(c, 1);
        return c;
      }
      // Mismo día de la semana que hoy: es el de la semana que viene (si fuera hoy, se dice "hoy")
      let diff = (want - weekdayOf(today) + 7) % 7 || 7;
      if (m[3] && /proximo/.test(m[0]) && diff < 7 && !m[3]) diff += 7;
      return addDays(today, diff);
    }],
    [/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/, (m) => {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4));
      let c = `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
      if (!m[3] && c < today) c = `${y + 1}${c.slice(4)}`;
      return Number(m[2]) <= 12 && Number(m[1]) <= 31 ? c : null;
    }],
    [new RegExp(`\\b(?:el\\s+)?(\\d{1,2})\\s+de\\s+(${MONTH_RE})(?:\\s+(?:de|del)?\\s*(20\\d\\d))?\\b`), (m) => {
      const y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
      let c = `${y}-${pad(MONTHS[m[2]])}-${pad(Number(m[1]))}`;
      if (!m[3] && c < today) c = `${y + 1}${c.slice(4)}`;
      return c;
    }],
    [/\bel\s+(\d{1,2})\b(?![/.-]\d)(?!\s*(?:%|hs|horas|:|de\s))/, (m) => {
      const d = Number(m[1]);
      if (d < 1 || d > 31) return null;
      let c = `${today.slice(0, 8)}${pad(d)}`;
      if (c < today) c = addMonths(c, 1);
      return c;
    }],
  ];
  let best: { date: string; start: number; end: number } | null = null;
  for (const [re, f] of tries) {
    const m = re.exec(n);
    if (!m) continue;
    const date = f(m);
    if (!date) continue;
    if (!best || m.index < best.start) best = { date, start: m.index, end: m.index + m[0].length };
  }
  return best;
}

function findTime(n: string): { time: string; span: Span } | null {
  const m =
    /\ba las (\d{1,2})(?:[:.](\d{2})| y (media|cuarto))?(?:\s*(?:hs|horas|h)\b)?(?:\s+de la (tarde|noche|manana))?/.exec(n) ??
    /\b(\d{1,2}):(\d{2})\s*(?:hs|horas)?\b()()/.exec(n);
  if (!m) {
    // "a la mañana" / "a la tarde" sin hora
    const part = /\b(?:a|por) la (manana|tarde)\b/.exec(n);
    return part ? { time: part[1] === "manana" ? "09:00:00" : "15:00:00", span: [part.index, part.index + part[0].length] } : null;
  }
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : m[3] === "media" ? 30 : m[3] === "cuarto" ? 15 : 0;
  if ((m[4] === "tarde" || m[4] === "noche") && h < 12) h += 12;
  if (!m[4] && h >= 1 && h <= 7) h += 12; // "a las 3" en una agenda de trabajo es a la tarde
  if (h > 23 || min > 59) return null;
  return { time: `${pad(h)}:${pad(min)}:00`, span: [m.index, m.index + m[0].length] };
}

function findDates(n: string, today: string): Found {
  const spans: Span[] = [];
  let due: string | null = null;
  let start: string | null = null;
  let rest = n;
  // Hasta dos fechas por frase ("desde el lunes hasta el viernes")
  for (let k = 0; k < 2; k++) {
    const d = dateAt(rest, today);
    if (!d) break;
    const before = rest.slice(0, d.start);
    const cue = new RegExp(`(?:${START_CUE}|${DUE_CUE})\\s*(?:el\\s+|la\\s+)?$`).exec(before);
    const isStart = !!cue && new RegExp(START_CUE).test(cue[0]);
    const s0 = cue ? d.start - cue[0].length : d.start;
    if (isStart) start ??= d.date;
    else due ??= d.date;
    spans.push([s0, d.end]);
    rest = rest.slice(0, s0) + " ".repeat(d.end - s0) + rest.slice(d.end);
  }
  const t = findTime(rest);
  if (t) spans.push(t.span);
  return { due, start, time: t?.time ?? null, priority: null, spans };
}

const PRIORITY: [RegExp, Priority][] = [
  [/\b(?:es\s+)?(?:muy\s+)?(?:urgente|urgentisim[oa]|lo antes posible|cuanto antes|ya mismo|si o si|asap)\b/, "urgente"],
  [/\b(?:es\s+)?(?:muy\s+)?(?:importante|prioritari[oa]|con prioridad alta|prioridad alta|alta prioridad)\b/, "alta"],
  [/\b(?:sin apuro|cuando (?:puedas|pueda|se pueda|tengas tiempo)|no es urgente|baja prioridad|prioridad baja|tranqui(?:lo)?)\b/, "baja"],
];
function findPriority(n: string): { priority: Priority; span: Span } | null {
  for (const [re, p] of PRIORITY) {
    const m = re.exec(n);
    if (m) return { priority: p, span: [m.index, m.index + m[0].length] };
  }
  return null;
}

const STATUS_WORDS: [RegExp, TaskStatus][] = [
  [/\b(?:hech[oa]s?|terminad[oa]s?|list[oa]s?|completad[oa]s?|cerrad[oa]s?|finalizad[oa]s?|resuelt[oa]s?)\b/, "hecha"],
  [/\b(?:en curso|en proceso|empezad[oa]|arrancad[oa]|haciendo)\b/, "en_curso"],
  [/\b(?:bloquead[oa]|trabad[oa]|frenad[oa])\b/, "bloqueada"],
  [/\b(?:en revision|para revisar|a revisar)\b/, "en_revision"],
  [/\b(?:pendiente|sin empezar|reabrir|reabrila|reabrilo)\b/, "pendiente"],
];

// ---------------------------------------------------------------- personas, clientes y proyectos
function findPeople(n: string, ctx: VoiceContext): { ids: string[]; spans: Span[] } {
  const ids: string[] = [];
  const spans: Span[] = [];
  if (/\b(?:lo hago yo|la hago yo|me encargo|me lo asigno|para mi\b|asignamela|asignamelo)/.test(n)) ids.push(ctx.me.id);
  for (const p of ctx.people) {
    const first = fold(p.name).split(/\s+/)[0];
    const full = fold(p.name);
    if (first.length < 3) continue;
    // Con una pista: "para Yani", "asignada a Yani", "que lo haga Yani", "Yani se encarga", "a cargo de Yani"
    // "Yani" por "Yanina": alcanza con las primeras letras del nombre
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const name = `(?:${esc(full)}|${esc(first.slice(0, 4))}\\p{L}*)`;
    const re = new RegExp(
      `(?:\\b(?:para|asignad[oa]s?\\s+a|asignal[ao]s?\\s+a|asigna(?:sela|selo|la|lo)?\\s+a|que (?:lo|la) haga|que (?:lo|la) hagan|le toca a|a cargo de|responsable(?:s)?:?|con)\\s+${name}\\b(?:\\s+y\\s+(\\p{L}+))?)|(?:\\b${name}\\s+se\\s+encarga\\b)`,
      "u",
    );
    const m = re.exec(n);
    if (m) {
      if (!ids.includes(p.id)) ids.push(p.id);
      spans.push([m.index, m.index + m[0].length]);
      // "para Yani y Maxi"
      if (m[1]) {
        const other = ctx.people.find((q) => m[1].length >= 3 && fold(q.name).split(/\s+/)[0].startsWith(m[1].slice(0, 4)));
        if (other && !ids.includes(other.id)) ids.push(other.id);
      }
    }
  }
  return { ids, spans };
}

const squash = (s: string) => fold(s).replace(/[^a-z0-9]/g, "");

function findClient(n: string, ctx: VoiceContext): { id: string; span: Span | null } | null {
  const flat = n.replace(/[^a-z0-9]/g, "");
  const sorted = [...ctx.clients].sort((a, b) => b.name.length - a.name.length);
  for (const c of sorted) {
    const key = squash(c.name);
    if (key.length < 3 || !flat.includes(key)) continue;
    // Sacar del título "para Ultragrif" / "del cliente Ultragrif"; en "llamar a Ultragrif" queda (es de qué se trata)
    const re = new RegExp(`\\b(?:para(?:\\s+el\\s+cliente)?|del\\s+cliente|cliente)\\s+${fold(c.name).split(/\s+/).join("\\s*")}\\b`);
    const m = re.exec(n);
    return { id: c.id, span: m ? [m.index, m.index + m[0].length] : null };
  }
  return null;
}

/** Qué tan bien coincide un texto con un nombre (0 a 1): palabras clave del nombre presentes en el texto */
function overlap(text: string, name: string) {
  const t = new Set(keyWords(text));
  const k = keyWords(name);
  if (!k.length) return 0;
  const hit = k.filter((w) => t.has(w) || [...t].some((x) => x.length >= 4 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))));
  return hit.length / k.length;
}

export function findProject(n: string, ctx: VoiceContext, clientId: string | null): { id: string | null; name?: string; span: Span | null } | null {
  // "en el proyecto X", "al proyecto X", "del proyecto X", "para el proyecto X"
  const m = /\b(?:en|al|a|del|de|para|dentro del?|sobre)\s+(?:el\s+)?proyecto\s+(?:de\s+|llamado\s+)?(.+?)(?=\s*(?:[,:]|\b(?:(?:agrega|suma|anota|carga|pone|crea|mete|arma)(?:me|le|les|r)?|hay que|tengo que|tenemos que|necesito|que|para el|para la|con)\b|$))/.exec(n);
  const candidates = clientId ? ctx.projects.filter((p) => p.client_id === clientId) : ctx.projects;
  const pick = (text: string) => {
    let best: { id: string; score: number } | null = null;
    for (const p of candidates.length ? candidates : ctx.projects) {
      const s = overlap(text, p.name);
      if (s > (best?.score ?? 0)) best = { id: p.id, score: s };
    }
    return best;
  };
  if (m) {
    const b = pick(m[1]);
    const span: Span = [m.index, m.index + m[0].length];
    if (b && b.score >= 0.5) return { id: b.id, span };
    return { id: null, name: m[1].trim(), span };
  }
  // Sin la palabra "proyecto": solo si el nombre completo del proyecto aparece
  const b = pick(n);
  if (b && b.score >= 0.99) {
    const p = ctx.projects.find((x) => x.id === b.id)!;
    const first = keyWords(p.name)[0];
    const i = first ? n.indexOf(first) : -1;
    return { id: b.id, span: null, ...(i >= 0 ? {} : {}) };
  }
  return null;
}

function findTask(n: string, ctx: VoiceContext): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const t of ctx.tasks) {
    const s = overlap(n, t.title);
    const strong = keyWords(t.title).filter((w) => new Set(keyWords(n)).has(w)).length;
    if ((s >= 0.5 || strong >= 2) && s > (best?.score ?? 0)) best = { id: t.id, score: s };
  }
  return best;
}

// ---------------------------------------------------------------- títulos
const COMMAND =
  /^(?:\s*(?:bueno|eh+|este|o sea|dale|ok|listo|che|entonces|y|tambien|ademas|despues|luego|aparte|otra cosa|por otro lado|por ultimo|primero|segundo|tercero)[\s,]+)*\s*(?:(?:por favor|porfa)\s+)?(?:(?:agrega(?:me|le)?|agregar|suma(?:me|le)?|sumar|anota(?:me|le)?|anotar|crea(?:me|le)?|crear|carga(?:me|le)?|cargar|pone(?:me|le)?|mete(?:me|le)?|meter|(?:arma(?:me|le)?|armar|hace(?:me)?|necesito)(?=\s+(?:(?:una|unas|\d+|dos|tres|cuatro|cinco|otra|otras)\s+)?(?:nuevas?\s+)?(?:tareas?|pendientes?)\b))\s+(?:(?:una|la|las|unas|otra|otras|\d+|dos|tres|cuatro|cinco)\s+)?(?:nuevas?\s+)?(?:tareas?|cosas?|pendientes?)?\s*(?:nuevas?\s+)?(?:de|para|que|:)?\s*)?(?:(?:hay que|tengo que|tenemos que|tienen que|tiene que|necesito(?: que)?|necesitamos(?: que)?|quiero(?: que)?|me falta|nos falta|falta|acordate de|acordarme de|recordame(?: que)?|recorda(?:me)? que|no te olvides de|no me olvide de|habria que|deberia(?:mos)?|hay que ir a)\s+)?/;

const IRREGULAR: Record<string, string> = { hace: "hacer", pone: "poner", deci: "decir", veni: "venir", sali: "salir", tene: "tener", anda: "ir", ve: "ir", haz: "hacer", pon: "poner", di: "decir" };

/** "mandá el informe" → "Mandar el informe"; "revisá" → "Revisar"; "escribí" → "Escribir" */
export function toInfinitive(title: string) {
  const m = /^(\S+)(.*)$/s.exec(title.trim());
  if (!m) return title;
  let [, first, rest] = m;
  const f = fold(first).replace(/[^a-zñ]/g, "");
  if (IRREGULAR[f] && /[áéí]$/.test(first)) first = IRREGULAR[f];
  else if (/á$/.test(first)) first = first.slice(0, -1) + "ar";
  else if (/é$/.test(first)) first = first.slice(0, -1) + "er";
  else if (/í$/.test(first)) first = first.slice(0, -1) + "ir";
  // "mandale" → "Mandarle"
  else if (/^\p{L}{3,}(?:a|e|i)(?:le|les)$/u.test(fold(first)) || (/(?:a|e|i)(?:le|les|lo|la|los|las|me|nos)$/.test(fold(first)) && /[áéí]/.test(first))) {
    const base = first.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const mm = /^(.*?)(a|e|i)(le|les|lo|la|los|las|me|nos)$/.exec(base);
    if (mm) first = `${mm[1]}${mm[2]}r${mm[3]}`;
  }
  const out = `${first}${rest}`;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function cut(text: string, spans: Span[]) {
  const keep = text.split("");
  for (const [a, b] of spans) for (let i = a; i < b && i < keep.length; i++) keep[i] = "\u0000";
  return keep.join("").replace(/\u0000+/g, " ");
}

function tidy(s: string) {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:])[,.;:\s]*(?=[,.;:])/g, "")
    .replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, "")
    .replace(/\b(?:y|que|de|para|a|el|la|con|en)$/i, "")
    .replace(/[\s,]+$/, "")
    .trim();
}

export function buildTitle(raw: string, spans: Span[]): { title: string; description: string } {
  let s = cut(raw, spans);
  const n = fold(s);
  const m = COMMAND.exec(n);
  if (m && m[0].length) s = s.slice(m[0].length);
  s = tidy(s.replace(/^\s*(?:que|de|a|y)\s+/i, ""));
  if (!s) return { title: "", description: "" };
  // Largo: el título es la primera parte; el resto, descripción
  let title = s;
  let description = "";
  if (s.length > 90) {
    const br = /,|\s(?:porque|para que|ya que|así|asi que|como para|y que)\s/.exec(s.slice(20));
    const at = br ? br.index + 20 : 80;
    title = tidy(s.slice(0, at));
    description = s;
  }
  return { title: toInfinitive(title).slice(0, 140), description };
}

// ---------------------------------------------------------------- frases y listas
const SPLIT = /(?:[.;!?\n]+|\s*,?\s*\b(?:y despues|despues|ademas|tambien|por otro lado|aparte|otra cosa|luego|por ultimo|y por ultimo|y otra)\b\s*,?)/;

/** Corta el dictado en ideas (con sus posiciones en el original) */
function clauses(text: string): string[] {
  const n = fold(text);
  const out: string[] = [];
  let last = 0;
  const re = new RegExp(SPLIT.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(n))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  out.push(text.slice(last));
  return out.map((c) => c.trim()).filter((c) => c.replace(/[\s,]/g, "").length > 2);
}

/** "agregá tres tareas: revisar métricas, armar el informe y presentarlo" → los ítems */
function listItems(clause: string): { head: string; items: string[] } | null {
  const n = fold(clause);
  const colon = clause.indexOf(":");
  const listCue = /\b(?:tareas|cosas|pendientes)\b/.test(n);
  let head = "";
  let body = clause;
  if (colon > 0) {
    head = clause.slice(0, colon);
    body = clause.slice(colon + 1);
  } else if (listCue) {
    const m = /\b(?:tareas|cosas|pendientes)\b\s*(?:que son|de|para|:)?\s*/.exec(n);
    if (!m) return null;
    head = clause.slice(0, m.index + m[0].length);
    body = clause.slice(m.index + m[0].length);
  } else return null;
  const parts = body
    .split(/\s*,\s*|\s+y\s+(?=\S)|\s+e\s+(?=[ií])/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 2);
  return parts.length >= 2 ? { head, items: parts } : null;
}

// ---------------------------------------------------------------- intérprete
export function interpretLocal(text: string, ctx: VoiceContext): VoicePlan {
  const actions: VoiceAction[] = [];
  const unmatched: string[] = [];
  let carryProject: { id: string | null; ref: string | null; client: string | null } = { id: ctx.scope.project_id ?? null, ref: null, client: ctx.scope.client_id ?? null };
  let projectRefs = 0;
  const projectClient = (id: string | null) => (id ? ctx.projects.find((p) => p.id === id)?.client_id ?? null : null);
  const assignable = new Set(ctx.people.filter((p) => p.assignable).map((p) => p.id));

  for (const clause of clauses(text)) {
    const n = fold(clause);

    // ---- proyecto nuevo
    if (/\b(?:crea|crear|creame|arma|armar|armame|agrega|agregar|suma|sumar|abri|abrir|nuevo|nueva|da de alta|dar de alta)\b[^.]*?\bproyecto\b/.test(n) && !/\b(?:en|al|del|dentro del?|para el|a)\s+(?:el\s+)?proyecto\b/.test(n.split(/\bproyecto\b/)[0] + "proyecto")) {
      const client = findClient(n, ctx);
      const range = new RegExp(`\\b(?:de|desde)\\s+(?:el\\s+)?(${MONTH_RE}|\\d{1,2}[/.-]\\d{1,2}|hoy)\\s+(?:a|al|hasta(?:\\s+el)?|hasta fin de)\\s+(${MONTH_RE}|\\d{1,2}[/.-]\\d{1,2})\\b`).exec(n);
      let start = ctx.today;
      let end = addMonths(ctx.today, 1);
      const monthDate = (w: string, isEnd: boolean) => {
        if (w === "hoy") return ctx.today;
        if (MONTHS[w]) {
          let y = Number(ctx.today.slice(0, 4));
          if (MONTHS[w] < Number(ctx.today.slice(5, 7))) y++;
          const d = `${y}-${pad(MONTHS[w])}-01`;
          return isEnd ? endOfMonth(d) : d < ctx.today ? ctx.today : d;
        }
        return dateAt(w.replace(/^/, ""), ctx.today)?.date ?? (isEnd ? end : start);
      };
      const spans: Span[] = [];
      if (range) {
        start = monthDate(range[1], false);
        end = monthDate(range[2], true);
        if (end < start) end = addMonths(end, 12);
        spans.push([range.index, range.index + range[0].length]);
      } else {
        const d = findDates(n, ctx.today);
        if (d.start) start = d.start;
        if (d.due) end = d.due;
        spans.push(...d.spans);
      }
      if (client?.span) spans.push(client.span);
      const who = findPeople(n, ctx);
      spans.push(...who.spans);
      const rest = cut(clause, spans);
      const nm = /\bproyecto\s+(?:nuevo\s+)?(?:llamado\s+|que se llame\s+|de nombre\s+|de\s+)?(.+)$/.exec(fold(rest));
      const name = nm ? tidy(rest.slice(nm.index + nm[0].length - nm[1].length).replace(/["«»“”]/g, "")) : "";
      if (!name) {
        unmatched.push(clause);
        continue;
      }
      const ref = `nuevo-${++projectRefs}`;
      actions.push({
        kind: "create_project",
        ref,
        project: { name: name.charAt(0).toUpperCase() + name.slice(1), description: "", client_id: client?.id ?? ctx.scope.client_id ?? null, start_date: start, end_date: end, owner_ids: who.ids },
        warning: !ctx.me.staff ? "Solo admins y líderes crean proyectos." : !client && !ctx.scope.client_id ? "Elegí el cliente del proyecto." : undefined,
      });
      carryProject = { id: null, ref, client: client?.id ?? null };
      continue;
    }

    // ---- cambios en un proyecto que existe
    if (/\bproyecto\b/.test(n) && /\b(?:termina|terminar|cierra|cerrar|extende|extender|alarga|alargar|posterga|postergar|pospone|posponer|mueve|move|mover|pausa|pausar|pone en pausa|reactiva|reactivar|completa|completar|empieza|arranca|corre|correr)\b/.test(n)) {
      const pr = findProject(n, ctx, findClient(n, ctx)?.id ?? null);
      const pid = pr?.id ?? (ctx.scope.project_id && /\b(?:este|el) proyecto\b/.test(n) ? ctx.scope.project_id : null);
      if (pid) {
        const changes: ProjectChanges = {};
        const d = findDates(n, ctx.today);
        if (/\b(?:pausa|pausar|pone en pausa|frena|frenar)\b/.test(n)) changes.status = "en_pausa";
        else if (/\b(?:reactiva|reactivar|retoma|retomar)\b/.test(n)) changes.status = "en_curso";
        else if (/\b(?:completa|completar|cerralo|da por terminado|dar por terminado)\b/.test(n) && !d.due) changes.status = "completado";
        if (/\b(?:empieza|arranca|empezar|arrancar)\b/.test(n) && (d.due || d.start)) changes.start_date = (d.start ?? d.due)!;
        else if (d.due) changes.end_date = d.due;
        const ext = new RegExp(`\\b(?:extende|alarga|posterga|pospone|corre|mueve|move)\\w*\\b.*?\\b(${NUM_RE})\\s+(semanas?|mes(?:es)?|dias?)\\b`).exec(n);
        if (ext && !changes.end_date) {
          const p = ctx.projects.find((x) => x.id === pid)!;
          const k = num(ext[1]);
          changes.end_date = ext[2].startsWith("mes") ? addMonths(p.end_date, k) : addDays(p.end_date, ext[2].startsWith("semana") ? 7 * k : k);
        }
        if (Object.keys(changes).length) {
          actions.push({ kind: "update_project", project_id: pid, changes, warning: !ctx.me.staff ? "Solo admins y líderes cambian proyectos." : undefined });
          continue;
        }
      }
    }

    // ---- cambios en una tarea que existe
    const statusCue = /\b(?:marca|marcar|marcala|marcalo|pasa|pasar|pasala|pasalo|pone|poner|ponela|ponelo|deja|dejala|dejalo|cambia|cambiar|cambiala|mueve|move|movela|ya (?:termine|hice|mande|envie|esta|estan|quedo)|termine|hice|complete|mande|envie|reabri|reabrir)\b/.test(n);
    const status = STATUS_WORDS.find(([re]) => re.test(n))?.[1] ?? (/\b(?:ya (?:termine|hice|mande|envie|quedo)|termine|hice|complete|mande|envie)\b/.test(n) ? "hecha" : undefined);
    const moveCue = /\b(?:pasa|pasar|pasala|pasalo|mueve|move|movela|movelo|posterga|postergar|posponer|pospone|adelanta|adelantar|corre|correr|correla|cambia la fecha|cambiale la fecha|reprograma|reprogramar)\b/.test(n);
    const assignCue = /\b(?:pasasela|pasaselo|pasale|asignale|asignasela|asignaselo|dasela|daselo|reasigna|reasignar)\b/.test(n);
    if ((statusCue && status) || moveCue || assignCue) {
      const t = findTask(n, ctx);
      if (t) {
        const changes: TaskChanges = {};
        if (status && statusCue) changes.status = status;
        const d = findDates(n, ctx.today);
        if (moveCue || d.due) {
          if (d.due) changes.due_date = d.due;
          if (d.start) changes.start_date = d.start;
          if (d.time) changes.start_time = d.time;
          const by = new RegExp(`\\b(?:posterga|pospone|corre|mueve|move)\\w*\\b.*?\\b(${NUM_RE})\\s+(dias?|semanas?)\\b`).exec(n);
          const task = ctx.tasks.find((x) => x.id === t.id)!;
          if (by && !d.due && task.due_date) changes.due_date = addDays(task.due_date, num(by[1]) * (by[2].startsWith("semana") ? 7 : 1));
        }
        const pr = findPriority(n);
        if (pr) changes.priority = pr.priority;
        const who = findPeople(n, ctx);
        const named = ctx.people.find((p) => new RegExp(`\\b(?:a|para)\\s+${fold(p.name).split(/\s+/)[0]}\\b`).test(n));
        if (assignCue && named) changes.assignee_ids = [named.id];
        else if (who.ids.length && assignCue) changes.assignee_ids = who.ids;
        const proj = /\bproyecto\b/.test(n) ? findProject(n, ctx, null) : null;
        if (proj?.id) changes.project_id = proj.id;
        if (Object.keys(changes).length) {
          const bad = changes.assignee_ids?.find((id) => !assignable.has(id));
          actions.push({ kind: "update_task", task_id: t.id, changes, warning: bad ? "Solo admins y líderes asignan tareas a otras personas." : t.score < 0.7 ? "Revisá que sea esta la tarea." : undefined });
          continue;
        }
      } else if (statusCue && status) {
        unmatched.push(clause);
        continue;
      }
    }

    // ---- tareas nuevas (una o una lista)
    const list = listItems(clause);
    const headText = list ? list.head : clause;
    const hn = fold(headText);
    const client = findClient(n, ctx);
    const proj = findProject(hn, ctx, client?.id ?? null) ?? (list ? null : findProject(n, ctx, client?.id ?? null));
    let projectId: string | null = null;
    let projectRef: string | null = null;
    let warning: string | undefined;
    if (proj?.id) projectId = proj.id;
    else if (proj?.name) {
      // "en el proyecto X" que no existe: ¿es el nuevo del mismo dictado?
      const created = actions.filter((a): a is Extract<VoiceAction, { kind: "create_project" }> => a.kind === "create_project").find((a) => overlap(proj.name!, a.project.name) >= 0.5);
      if (created) projectRef = created.ref;
      else warning = `No encontré el proyecto «${proj.name}»: va sin proyecto (elegilo abajo).`;
    } else if (!client) {
      projectId = carryProject.id;
      projectRef = carryProject.ref;
    }
    const clientId = client?.id ?? projectClient(projectId) ?? (projectRef ? carryProject.client : null) ?? (projectId || projectRef ? null : ctx.scope.client_id ?? null);
    if (projectId || projectRef) carryProject = { id: projectId, ref: projectRef, client: clientId };

    const headDates = findDates(hn, ctx.today);
    let headPrio = findPriority(hn);
    const headPeople = findPeople(hn, ctx);
    let items = list ? list.items : [clause];
    // "…, que lo haga Yani" / "…, todo para el viernes" al final de una lista: vale para toda la lista
    if (list) {
      items = items.filter((item) => {
        const inn = fold(item);
        const d = findDates(inn, ctx.today);
        const pr = findPriority(inn);
        const who = findPeople(inn, ctx);
        const spans: Span[] = [...d.spans, ...who.spans, ...(pr ? [pr.span] : [])];
        if (!spans.length || buildTitle(item.replace(/^\s*(?:todo|todas?|las dos|las tres)\b/i, ""), spans).title.replace(/\b(?:todo|todas)\b/gi, "").trim().length >= 3) return true;
        if (who.ids.length) headPeople.ids.push(...who.ids.filter((id) => !headPeople.ids.includes(id)));
        headDates.due ??= d.due;
        headDates.start ??= d.start;
        headDates.time ??= d.time;
        headPrio ??= pr;
        return false;
      });
    }
    let made = 0;
    for (const item of items) {
      const inn = fold(item);
      const d = list ? findDates(inn, ctx.today) : findDates(inn, ctx.today);
      const pr = findPriority(inn) ?? (list ? null : null);
      const who = findPeople(inn, ctx);
      const spans: Span[] = [...d.spans, ...who.spans];
      if (pr) spans.push(pr.span);
      const ownClient = findClient(inn, ctx);
      if (ownClient?.span && (projectId || projectRef || client)) spans.push(ownClient.span);
      const ownProj = list ? null : proj;
      if (ownProj?.span) spans.push(ownProj.span);
      const { title, description } = buildTitle(item, spans);
      if (!title || title.length < 3) continue;
      const people = who.ids.length ? who.ids : headPeople.ids.length ? headPeople.ids : [ctx.me.id];
      const bad = people.find((id) => !assignable.has(id));
      const task: TaskDraftFields = {
        title,
        description,
        priority: pr?.priority ?? headPrio?.priority ?? "media",
        assignee_ids: bad ? [ctx.me.id] : people,
        client_id: ownClient?.id ?? clientId,
        project_id: projectId,
        project_ref: projectRef,
        start_date: d.start ?? headDates.start,
        due_date: d.due ?? headDates.due,
        start_time: d.time ?? headDates.time,
      };
      actions.push({ kind: "create_task", task, warning: bad ? "Solo admins y líderes asignan tareas a otras personas: quedó a tu nombre." : warning });
      made++;
    }
    if (!made) unmatched.push(clause);
  }
  return { actions, unmatched };
}

export type { ProjectStatus };
