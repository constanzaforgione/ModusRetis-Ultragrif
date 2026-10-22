// Quién está pidiendo: usuario con sesión y su rol (para las rutas de RRSS)
import { supabaseServer } from "../supabase/server";

export async function currentUser() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase.from("profiles").select("id, role, active").eq("id", user.id).single();
  if (!me?.active) return null;
  return { id: user.id, role: me.role as string, staff: me.role === "admin" || me.role === "lider", supabase };
}

export const configured = {
  instagram: () => !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
  linkedin: () => !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
  tiktok: () => !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
};
