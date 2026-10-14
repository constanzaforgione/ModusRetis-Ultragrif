// Alta de una persona del equipo por un admin, sin esperar a que entre a la app:
// se crea su cuenta (sin mandar mail) y queda lista para asignarle tareas.
// Cuando entre con ese mail (link o Google), usa esta misma cuenta.
import { NextResponse } from "next/server";
import { emailAllowed, supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, active").eq("id", user.id).single();
  if (!me?.active || me.role !== "admin") return NextResponse.json({ error: "Solo un admin puede sumar personas" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { email?: string; full_name?: string; role?: Role; lead_id?: string | null };
  const email = (body.email ?? "").trim().toLowerCase();
  const full_name = (body.full_name ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !full_name) {
    return NextResponse.json({ error: "Completá nombre y un mail válido" }, { status: 400 });
  }
  if (!emailAllowed(email)) return NextResponse.json({ error: "Ese mail no es de un dominio permitido" }, { status: 400 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel" }, { status: 500 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name } });
  if (error) {
    const msg = /already|registered|exists/i.test(error.message) ? "Ya existe una cuenta con ese mail" : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const role: Role = body.role === "lider" || body.role === "admin" ? body.role : "miembro";
  await admin
    .from("profiles")
    .update({ full_name, role, lead_id: body.lead_id || null })
    .eq("id", data.user.id);
  return NextResponse.json({ ok: true, id: data.user.id });
}
