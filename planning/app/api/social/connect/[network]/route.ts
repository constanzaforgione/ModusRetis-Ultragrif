// Conectar una cuenta: /api/social/connect/instagram?client=<id> → login de la red → vuelve a /callback
import { NextResponse } from "next/server";
import { currentUser, configured } from "@/lib/social/auth";
import { callbackUrl, makeState } from "@/lib/social/oauthState";
import { instagramAuthUrl } from "@/lib/social/instagram";
import { linkedinAuthUrl } from "@/lib/social/linkedin";
import { tiktokAuthUrl } from "@/lib/social/tiktok";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ network: string }> }) {
  const { network } = await params;
  const url = new URL(req.url);
  const back = (msg: string) => NextResponse.redirect(new URL(`/rrss?cuentas=1&error=${encodeURIComponent(msg)}`, url.origin));
  const me = await currentUser();
  if (!me) return NextResponse.redirect(new URL("/login", url.origin));
  if (!me.staff) return back("Solo admins y líderes conectan cuentas.");
  const client = url.searchParams.get("client");
  if (!client) return back("Falta elegir el cliente.");
  if (!(network in configured) || !configured[network as keyof typeof configured]())
    return back(`Falta configurar la app de ${network} en Vercel (ver GUIA_REDES.md).`);

  let state: string;
  try {
    state = makeState({ client, network, user: me.id });
  } catch (e) {
    return back((e as Error).message);
  }
  const redirect = callbackUrl(url.origin, network);
  const to =
    network === "instagram"
      ? instagramAuthUrl(process.env.INSTAGRAM_APP_ID!, redirect, state)
      : network === "linkedin"
        ? linkedinAuthUrl(process.env.LINKEDIN_CLIENT_ID!, redirect, state)
        : tiktokAuthUrl(process.env.TIKTOK_CLIENT_KEY!, redirect, state);
  return NextResponse.redirect(to);
}
