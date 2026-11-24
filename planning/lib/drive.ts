// Presentaciones de los resúmenes mensuales que están en Google Drive (.pptx o Google Slides).
// La app no tiene acceso al Drive: lo lee un script de Google Apps Script que la dueña de la carpeta publica
// (corre con su cuenta, la carpeta sigue privada) y que devuelve la lista de archivos. Ver GUIA_DRIVE.md.
// Cada presentación se une a su resumen por cliente y mes, sacados del nombre:
//   "[Confort Iván] Octubre 2026_ModusRetis" · "Julio 2026_ModusRetis.pptx" (cliente: el de la carpeta)
//   "[Confort Iván] Resultados Meta Ads Oct-Nov 2026" (va con octubre y noviembre)
import { canonicalClient } from "./clientAliases";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  created?: string;
  updated?: string;
  /** Carpetas donde está, de afuera hacia adentro ("Placebo Amoblamientos / Confort Ivan", "Resumenes Mensuales") */
  folders?: string[];
}

export interface Presentation {
  id: string;
  name: string;
  url: string;
  /** Cliente (como se llama en la app si es uno con varios nombres) */
  client: string;
  /** "2026-10" */
  months: string[];
  updated: string | null;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const MONTHS: [RegExp, number][] = [
  [/^ene(ro)?$/, 1], [/^feb(rero)?$/, 2], [/^mar(zo)?$/, 3], [/^abr(il)?$/, 4], [/^may(o)?$/, 5], [/^jun(io)?$/, 6],
  [/^jul(io)?$/, 7], [/^ago(sto)?$/, 8], [/^(sep|set)(tiembre|iembre)?$/, 9], [/^oct(ubre)?$/, 10], [/^nov(iembre)?$/, 11], [/^dic(iembre)?$/, 12],
];
const monthNum = (w: string) => MONTHS.find(([re]) => re.test(w))?.[1] ?? null;

const PRESENTATION = /presentation|powerpoint|presentationml|\.pptx?$|\.key$|pdf/i;

/** Meses que nombra un título: "Octubre 2026" → ["2026-10"]; "Oct-Nov 2026" → ["2026-10", "2026-11"] */
export function monthsIn(title: string, created?: string): string[] {
  const words = fold(title).match(/[a-z]+|\d{4}/g) ?? [];
  const found: number[] = [];
  let year: number | null = null;
  for (const w of words) {
    if (/^\d{4}$/.test(w) && +w > 2000 && +w < 2100) year ??= +w;
    else {
      const m = monthNum(w);
      if (m) found.push(m);
    }
  }
  if (!found.length) return [];
  if (!year) {
    const c = created ? new Date(created) : new Date();
    year = c.getUTCFullYear();
    // Una presentación de diciembre hecha en enero es del año anterior
    if (Math.min(...found) > c.getUTCMonth() + 1) year--;
  }
  // "Oct-Nov": todos los meses del rango. El año dicho es el del último mes ("Nov-Ene 2027": nov y dic son de 2026)
  const seq = found.length === 2 && /[a-z]+\s*(?:-|–|a|al)\s*[a-z]+/.test(fold(title)) ? range(found[0], found[1]) : [...new Set(found)];
  const out: string[] = [];
  let y = year;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (i < seq.length - 1 && seq[i] > seq[i + 1]) y--;
    out.unshift(`${y}-${String(seq[i]).padStart(2, "0")}`);
  }
  return out;
}
function range(a: number, b: number) {
  const out: number[] = [];
  for (let m = a, i = 0; i < 12; i++) {
    out.push(m);
    if (m === b) break;
    m = (m % 12) + 1;
  }
  return out;
}

const GENERIC = /resum|mensual|presentac|informe|reporte|drive|clientes|modus|^\s*$/i;

/** Cliente: el que dice el título entre corchetes, o el de la carpeta (sin contar carpetas genéricas) */
export function clientOf(file: Pick<DriveFile, "name" | "folders">): string | null {
  const br = /\[([^\]]+)\]/.exec(file.name);
  if (br) return canonicalClient(br[1].trim());
  for (const f of [...(file.folders ?? [])].reverse()) if (!GENERIC.test(fold(f))) return canonicalClient(f.trim());
  return null;
}

export function toPresentations(files: DriveFile[]): Presentation[] {
  return files
    .filter((f) => PRESENTATION.test(f.mimeType) || PRESENTATION.test(f.name))
    .map((f) => ({
      id: f.id,
      name: f.name.replace(/\.(pptx?|key|pdf)$/i, ""),
      url: f.url,
      client: clientOf(f) ?? "",
      months: monthsIn(f.name.replace(/\[[^\]]*\]/g, " "), f.created),
      updated: f.updated ?? null,
    }))
    .filter((p) => p.client && p.months.length);
}

export function driveConfig() {
  const url = process.env.DRIVE_SCRIPT_URL;
  return url ? { url, token: process.env.DRIVE_SCRIPT_TOKEN ?? "" } : null;
}

/** Lista de archivos que devuelve el script de Apps Script */
export async function fetchPresentations(http: typeof fetch, cfg: { url: string; token: string }): Promise<Presentation[]> {
  const u = new URL(cfg.url);
  if (cfg.token) u.searchParams.set("token", cfg.token);
  const res = await http(u.toString(), { next: { revalidate: 600 } } as RequestInit);
  if (!res.ok) throw new Error(`Drive respondió ${res.status}`);
  const body = (await res.json().catch(() => null)) as { files?: DriveFile[]; error?: string } | null;
  if (!body || body.error) throw new Error(body?.error === "token" ? "El script de Drive rechazó la clave (DRIVE_SCRIPT_TOKEN)" : "El script de Drive no devolvió la lista de archivos");
  return toPresentations(body.files ?? []);
}

/** Las presentaciones de un resumen: mismo cliente y mes */
export function presentationsFor<T extends { client: string; month: string }>(s: T, list: Presentation[], same: (a: string, b: string) => boolean) {
  return list.filter((p) => p.months.includes(s.month) && same(p.client, s.client));
}
