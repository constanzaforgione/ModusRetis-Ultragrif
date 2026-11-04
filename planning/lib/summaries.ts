import { canonicalClient } from "./clientAliases";

// Resúmenes mensuales de los clientes (vienen de ClickUp): qué página es un resumen, de qué mes,
// cuántas horas, y qué nunca se muestra (credenciales, contraseñas).

export interface SummaryPage {
  /** doc:<doc>:<page> o task:<id> */
  key: string;
  client: string;
  name: string;
  /** "2026-07" */
  month: string;
  hours: number | null;
  content: string;
  url: string;
  updated: string;
  /** Otras versiones del mismo mes (borradores, "v2", "completo") */
  versions: { name: string; url: string; updated: string }[];
  /** Guardado en la base de la app (id de monthly_summaries) */
  id?: string | null;
  client_id?: string | null;
  /** app: escrito en la app · clickup: escrito en ClickUp */
  source?: "app" | "clickup";
  /** Está (o se mandó) en ClickUp */
  clickup_key?: string | null;
  sent_at?: string | null;
}

/** Fila de monthly_summaries */
export interface StoredSummary {
  id: string;
  client_id: string | null;
  client_name: string;
  month: string;
  title: string;
  content: string;
  hours: number | null;
  source: "app" | "clickup";
  clickup_key: string | null;
  clickup_url: string;
  edited: boolean;
  sent_at: string | null;
  updated_at: string;
}

export interface RawPage {
  key: string;
  client: string;
  name: string;
  content: string;
  url: string;
  created: string;
  updated: string;
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, sptiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
export const MONTH_NAME = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Clientes cuyos resúmenes no se muestran en la app */
export const HIDDEN_CLIENTS = /\bwega\b/;

/** Páginas que nunca se muestran, aunque estén en el mismo doc */
export const SENSITIVE = /credencial|contrase|password|clave|acceso|login|usuarios?\b/;

/** ¿Es un resumen mensual? Tiene que decir "resumen" y un mes, y no ser de credenciales ni semanal */
export function isMonthlySummary(name: string) {
  const n = norm(name);
  if (SENSITIVE.test(n) || /\bsemanas?\b/.test(n)) return false;
  return /resu?m/.test(n) && monthOf(name, new Date().toISOString()) !== null;
}

/** Mes del resumen: del nombre ("Julio 2026"); si no dice el año, el del momento en que se escribió */
export function monthOf(name: string, created: string): string | null {
  const n = norm(name);
  const m = n.match(new RegExp(`\\b(${Object.keys(MONTHS).join("|")})\\b(?:\\s*(?:de\\s+)?(20\\d\\d))?`));
  if (!m) return null;
  const month = MONTHS[m[1]];
  let year = m[2] ? Number(m[2]) : NaN;
  if (!year) {
    const c = new Date(created);
    year = c.getUTCFullYear();
    // Un resumen de diciembre escrito en enero es del año anterior
    if (month > c.getUTCMonth() + 1) year--;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Horas del mes, si el resumen las dice: "Detalle de trabajos realizados (18 horas)" */
export function hoursOf(content: string): number | null {
  const head = content.split("\n").slice(0, 6).join(" ");
  const m = head.match(/\((\d+(?:[.,]\d+)?)\s*(?:h|hs|horas?)\b/i) ?? head.match(/(\d+(?:[.,]\d+)?)\s*horas/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** Por las dudas: cualquier renglón con usuario/contraseña/token se oculta */
export function redact(content: string) {
  return content
    .split("\n")
    .map((l) => (/contrase[ñn]a|password|passwd|\bclave\s*:|\busuario\s*:|\buser\s*:|\btoken\b|api[\s_-]?key/i.test(l) ? "_[dato sensible oculto]_" : l))
    .join("\n");
}

/** Arma la lista final: solo resúmenes mensuales, uno por cliente y mes (el consolidado o el más nuevo) */
export function buildSummaries(raw: RawPage[]): SummaryPage[] {
  const groups = new Map<string, RawPage[]>();
  for (const p of raw) {
    if (HIDDEN_CLIENTS.test(norm(p.client)) || HIDDEN_CLIENTS.test(norm(p.name))) continue;
    if (!isMonthlySummary(p.name)) continue;
    const month = monthOf(p.name, p.created);
    if (!month) continue;
    const k = `${p.client}|${month}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const out: SummaryPage[] = [];
  for (const [k, list] of groups) {
    const month = k.split("|")[1];
    const rank = (p: RawPage) => (/consolidad|complet|final/i.test(p.name) ? 1 : 0);
    const sorted = [...list].sort((a, b) => rank(b) - rank(a) || b.updated.localeCompare(a.updated) || b.content.length - a.content.length);
    const main = sorted[0];
    const content = redact(main.content.trim());
    out.push({
      key: main.key,
      // "Placebo Amoblamientos" y "Confort Iván" se muestran como el cliente de la app ("Placebo / Confort Iván")
      client: canonicalClient(main.client),
      name: main.name,
      month,
      hours: hoursOf(content),
      content,
      url: main.url,
      updated: main.updated,
      versions: sorted.slice(1).map((p) => ({ name: p.name, url: p.url, updated: p.updated })),
    });
  }
  return out.sort((a, b) => b.month.localeCompare(a.month) || a.client.localeCompare(b.client));
}

/** "003- PLACEBO AMOBLAMIENTOS" → "Placebo Amoblamientos" */
export function clientFromFolder(folder: string) {
  const s = folder.replace(/^\s*\d+\s*[-–.)]\s*/, "").trim();
  // Siglas cortas ("KUMI") quedan como están; el resto en mayúsculas pasa a "Placebo Amoblamientos"
  if (s !== s.toUpperCase() || /^\p{L}{2,4}$/u.test(s)) return s;
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

/** Une el nombre de ClickUp con un cliente de la app ("Placebo Amoblamientos" → "Placebo").
 *  Un cliente de la app con varios nombres ("Placebo / Confort Iván") junta a todos. */
export function matchClient<T extends { name: string }>(clickupName: string, clients: T[]): T | undefined {
  const n = norm(canonicalClient(clickupName));
  if (!n) return undefined;
  const parts = (c: T) => norm(c.name).split(/\s*(?:\/|\||\+|&|,|\by\b)\s*/).filter((x) => x.length >= 3);
  return (
    clients.find((c) => norm(c.name) === n) ??
    clients.find((c) => n.includes(norm(c.name))) ??
    clients.find((c) => norm(c.name).includes(n)) ??
    clients.find((c) => parts(c).length > 1 && parts(c).some((x) => n.includes(x) || x.includes(n)))
  );
}

export const monthLabel = (m: string) => `${MONTH_NAME[Number(m.slice(5))]} ${m.slice(0, 4)}`;

// ---------------------------------------------------------------- resúmenes guardados en la app
/** Copias que hay que guardar en la app de lo que está en ClickUp: los nuevos y los que cambiaron (si no se editaron acá) */
export function copiesToSave(live: SummaryPage[], stored: StoredSummary[]) {
  const byKey = new Map(stored.filter((x) => x.clickup_key).map((x) => [x.clickup_key!, x]));
  const insert: SummaryPage[] = [];
  const update: { id: string; page: SummaryPage }[] = [];
  for (const p of live) {
    const s = byKey.get(p.key);
    if (!s) insert.push(p);
    else if (!s.edited && s.source === "clickup" && (s.content !== p.content || s.title !== p.name)) update.push({ id: s.id, page: p });
  }
  return { insert, update };
}

/** La lista que se ve: lo guardado en la app más lo de ClickUp que todavía no tiene copia */
export function mergeSummaries(
  stored: StoredSummary[],
  live: SummaryPage[],
  clientName: (id: string | null) => string | null,
  /** Cliente de la app para un nombre de ClickUp (así "Placebo Amoblamientos" va con "Placebo / Confort Iván") */
  appClient: (name: string) => { id: string; name: string } | undefined = () => undefined,
): SummaryPage[] {
  const liveByKey = new Map(live.map((p) => [p.key, p]));
  const out: SummaryPage[] = stored
    .filter((s) => !HIDDEN_CLIENTS.test(norm(clientName(s.client_id) ?? s.client_name)))
    .map((s) => {
      const l = s.clickup_key ? liveByKey.get(s.clickup_key) : undefined;
      const app = s.client_id ? null : appClient(s.client_name);
      return {
        key: `app:${s.id}`,
        id: s.id,
        client_id: s.client_id ?? app?.id ?? null,
        client: clientName(s.client_id) ?? app?.name ?? canonicalClient(s.client_name),
        name: s.title || `Resumen de avance - ${monthLabel(s.month)}`,
        month: s.month,
        hours: s.hours ?? hoursOf(s.content),
        content: s.content,
        url: s.clickup_url,
        updated: s.updated_at,
        versions: l?.versions ?? [],
        source: s.source,
        clickup_key: s.clickup_key,
        sent_at: s.sent_at,
      };
    });
  const copied = new Set(stored.map((s) => s.clickup_key).filter(Boolean));
  for (const p of live) {
    if (copied.has(p.key)) continue;
    const c = appClient(p.client);
    out.push({ ...p, source: "clickup", id: null, ...(c ? { client: c.name, client_id: c.id } : {}) });
  }
  return out.sort((a, b) => b.month.localeCompare(a.month) || a.client.localeCompare(b.client));
}

// ---------------------------------------------------------------- borrador con las tareas del planning
interface PlanTask {
  title: string;
  status: string;
  client_id: string | null;
  project_id: string | null;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  updated_at?: string | null;
}

/** Las tareas del planning que van al resumen de un cliente y mes: las de ese cliente o de sus proyectos */
export function summaryTasks<T extends PlanTask>(tasks: T[], projects: { id: string; name: string; client_id: string }[], clientId: string, month: string) {
  const proj = new Map(projects.map((p) => [p.id, p]));
  const mine = tasks.filter((t) => t.client_id === clientId || (t.project_id && proj.get(t.project_id)?.client_id === clientId));
  const m = (d: string | null | undefined) => (d ?? "").slice(0, 7);
  const item = (t: T) => ({ title: t.title, project: t.project_id ? (proj.get(t.project_id)?.name ?? null) : null });
  const done = mine.filter((t) => t.status === "hecha" && m(t.completed_at ?? t.due_date ?? t.start_date) === month);
  // En curso: se trabajaron en el mes y siguen abiertas
  const doing = mine.filter(
    (t) => ["en_curso", "en_revision", "bloqueada"].includes(t.status) && (m(t.start_date ?? t.due_date ?? t.updated_at) <= month || m(t.updated_at) === month),
  );
  // Próximos pasos: lo pendiente que vence después del mes (o sin fecha)
  const next = mine.filter((t) => t.status === "pendiente" && (!t.due_date || m(t.due_date) > month || m(t.due_date) === month)).slice(0, 12);
  return { done: done.map(item), doing: doing.map(item), next: next.map(item) };
}

const byProject = (list: { title: string; project: string | null }[], other = "Otras tareas") => {
  const groups = new Map<string, string[]>();
  for (const t of list) groups.set(t.project ?? other, [...(groups.get(t.project ?? other) ?? []), t.title]);
  // Primero los proyectos, al final las sueltas
  return [...groups].sort(([a], [b]) => Number(a === other) - Number(b === other)).map(([g, items]) => `### ${g}\n${items.map((x) => `* ${x}`).join("\n")}`).join("\n\n");
};

/** Borrador de un resumen nuevo: lo hecho en el mes por proyecto, lo que sigue en curso y los próximos pasos */
export function summaryDraft(client: string, month: string, t: ReturnType<typeof summaryTasks>) {
  return [
    `# Resumen de avance - ${monthLabel(month)} · ${client}`,
    "",
    "## Detalle de trabajos realizados ( horas)",
    "",
    byProject(t.done) || "* ",
    ...(t.doing.length ? ["", "## En curso", "", byProject(t.doing)] : []),
    "",
    "## Próximos pasos",
    "",
    t.next.length ? t.next.map((x) => `* ${x.title}${x.project ? ` (${x.project})` : ""}`).join("\n") : "* ",
  ].join("\n");
}
