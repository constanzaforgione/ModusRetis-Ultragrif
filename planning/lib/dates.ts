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

/** Igual que public.next_occurrence en la base: "diaria" saltea sábado y domingo */
export function nextOccurrence(d: string, f: "diaria" | "semanal" | "quincenal" | "mensual"): string {
  if (f === "semanal") return addDays(d, 7);
  if (f === "quincenal") return addDays(d, 14);
  if (f === "mensual") {
    const x = parseISO(d);
    const day = x.getUTCDate();
    const m = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1));
    const last = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate();
    m.setUTCDate(Math.min(day, last));
    return toISO(m);
  }
  const dow = parseISO(d).getUTCDay(); // 0 domingo … 6 sábado
  return addDays(d, dow === 5 ? 3 : dow === 6 ? 2 : 1);
}

export function weekday(s: string): number {
  return (parseISO(s).getUTCDay() + 6) % 7; // 0 lunes … 6 domingo
}

export function startOfWeek(s: string): string {
  return addDays(s, -weekday(s));
}

const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
export const dayName = (s: string) => DIAS[weekday(s)];

/** "14:30:00" → "14:30" */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
