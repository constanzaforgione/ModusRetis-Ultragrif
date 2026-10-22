// Vuelta del login de cada red: se guarda la cuenta del cliente con sus credenciales (solo servidor)
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { callbackUrl, readState } from "@/lib/social/oauthState";
import { saveAccount } from "@/lib/social/store";
import { instagramConnect } from "@/lib/social/instagram";
import { linkedinConnect } from "@/lib/social/linkedin";
import { tiktokConnect } from "@/lib/social/tiktok";
import type { Network } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: Promise<{ network: string }> }) {
  const { network } = await params;
  const url = new URL(req.url);
  const go = (q: string) => NextResponse.redirect(new URL(`/rrss?cuentas=1&${q}`, url.origin));
  const fail = (msg: string) => go(`error=${encodeURIComponent(msg)}`);

  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (denied) return fail(`La red no autorizó la conexión: ${denied}`);
  const state = readState(url.searchParams.get("state"));
  if (!state || state.network !== network) return fail("El link de conexión venció. Probá de nuevo.");
  const code = url.searchParams.get("code");
  if (!code) return fail("La red no devolvió el código de autorización.");

  const db = supabaseAdmin();
  const redirect = callbackUrl(url.origin, network);
  const base = { client_id: state.client, network: network as Network, connected_by: state.user };
  try {
    if (network === "instagram") {
      const r = await instagramConnect(fetch, process.env.INSTAGRAM_APP_ID!, process.env.INSTAGRAM_APP_SECRET!, redirect, code);
      await saveAccount(db, { ...base, ...r.account }, r);
    } else if (network === "tiktok") {
      const r = await tiktokConnect(fetch, process.env.TIKTOK_CLIENT_KEY!, process.env.TIKTOK_CLIENT_SECRET!, redirect, code);
      await saveAccount(db, { ...base, ...r.account }, r);
    } else if (network === "linkedin") {
      const r = await linkedinConnect(fetch, process.env.LINKEDIN_CLIENT_ID!, process.env.LINKEDIN_CLIENT_SECRET!, redirect, code);
      if (!r.accounts.length) return fail("Esa cuenta de LinkedIn no administra ninguna página de empresa.");
      const tokens = { access_token: r.access_token, refresh_token: r.refresh_token, expires_in: r.expires_in, refresh_expires_in: r.refresh_token_expires_in };
      if (r.accounts.length === 1) {
        await saveAccount(db, { ...base, ...r.accounts[0] }, tokens);
      } else {
        // Varias páginas: que elija cuál es la del cliente
        const { data, error } = await db
          .from("social_oauth_pending")
          .insert({ client_id: state.client, network, payload: { accounts: r.accounts, tokens }, created_by: state.user })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        return go(`elegir=${(data as { id: string }).id}`);
      }
    } else {
      return fail("Red desconocida.");
    }
  } catch (e) {
    return fail(`No se pudo conectar: ${(e as Error).message}`);
  }
  return go(`ok=${network}`);
}
