// Fechas como "AAAA-MM-DD" en hora de Argentina, para que "hoy" sea el mismo en el navegador y en el cron.
export const TZ = "America/Argentina/Buenos_Aires";

export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function addMonths(s: string, n: number): string {
  const d = parseISO(s);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return toISO(d);
}

export function startOfMonth(s: string): string {
  return s.slice(0, 8) + "01";
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / 86_400_000);
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function fmtShort(s: string | null | undefined): string {
  if (!s) return "—";
  const d = parseISO(s);
  return `${d.getUTCDate()} ${MES[d.getUTCMonth()]}`;
}

export function fmtMonth(s: string, long = false): string {
  const d = parseISO(s);
  return long ? `${MES_LARGO[d.getUTCMonth()]} ${d.getUTCFullYear()}` : `${MES[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** "hoy", "mañana", "en 3 días", "hace 2 días" */
export function relative(s: string, today: string): string {
  const n = diffDays(s, today);
  if (n === 0) return "hoy";
  if (n === 1) return "mañana";
  if (n === -1) return "ayer";
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}
