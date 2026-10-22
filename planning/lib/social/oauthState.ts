// "state" firmado para conectar cuentas: quién pidió conectar qué cliente a qué red (vale 15 minutos)
import { createHmac, timingSafeEqual } from "node:crypto";

const secret = () => process.env.SOCIAL_STATE_SECRET || process.env.CRON_SECRET || "";
const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export interface OAuthState {
  client: string;
  network: string;
  user: string;
  t: number;
}

export function makeState(s: Omit<OAuthState, "t">, now = Date.now()) {
  if (!secret()) throw new Error("Falta configurar CRON_SECRET (o SOCIAL_STATE_SECRET) en Vercel");
  const data = Buffer.from(JSON.stringify({ ...s, t: now })).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function readState(state: string | null, now = Date.now()): OAuthState | null {
  if (!state || !secret()) return null;
  const [data, sig] = state.split(".");
  if (!data || !sig) return null;
  const good = Buffer.from(sign(data));
  const got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(data, "base64url").toString()) as OAuthState;
    return now - s.t < 15 * 60_000 ? s : null;
  } catch {
    return null;
  }
}

/** Dónde vuelve cada red después de conectar (tiene que coincidir con lo cargado en cada app de desarrollador) */
export const callbackUrl = (origin: string, network: string) => `${(process.env.APP_URL || origin).replace(/\/$/, "")}/api/social/callback/${network}`;
