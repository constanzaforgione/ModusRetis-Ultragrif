import { NextResponse } from "next/server";
import { emailAllowed, supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const supabase = await supabaseServer();
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?error=link", url.origin));
    if (!emailAllowed(data.user?.email)) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=dominio", url.origin));
    }
  }
  return NextResponse.redirect(new URL("/tareas", url.origin));
}
