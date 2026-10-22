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
      client: main.client,
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
  // Siglas cortas ("WEGA") quedan como están; el resto en mayúsculas pasa a "Placebo Amoblamientos"
  if (s !== s.toUpperCase() || /^\p{L}{2,4}$/u.test(s)) return s;
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

/** Une el nombre de ClickUp con un cliente de la app ("Placebo Amoblamientos" → "Placebo") */
export function matchClient<T extends { name: string }>(clickupName: string, clients: T[]): T | undefined {
  const n = norm(clickupName);
  return clients.find((c) => n.includes(norm(c.name))) ?? clients.find((c) => norm(c.name).includes(n));
}

export const monthLabel = (m: string) => `${MONTH_NAME[Number(m.slice(5))]} ${m.slice(0, 4)}`;
