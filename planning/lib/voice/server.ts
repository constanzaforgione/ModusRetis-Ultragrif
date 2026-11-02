// Contexto del intérprete armado desde la base, con los permisos de quien pide (solo servidor)
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO } from "../dates";
import type { Profile } from "../types";
import { buildVoiceContext, type VoiceContext } from "./plan";

export async function loadVoiceContext(supabase: SupabaseClient, userId: string, scope: VoiceContext["scope"] = {}): Promise<{ ctx: VoiceContext; me: Profile } | null> {
  const [{ data: profiles }, { data: clients }, { data: projects }, { data: tasks }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, lead_id, role, active"),
    supabase.from("clients").select("id, name, active"),
    supabase.from("projects").select("id, name, client_id, start_date, end_date, status").limit(300),
    supabase.from("tasks").select("id, title, project_id, client_id, status, due_date, assignee_id, assignee_ids, created_by").neq("status", "hecha").limit(600),
  ]);
  const me = profiles?.find((p) => p.id === userId) as Profile | undefined;
  if (!me) return null;
  const ctx = buildVoiceContext({
    me,
    profiles: (profiles ?? []) as Profile[],
    clients: clients ?? [],
    projects: projects ?? [],
    tasks: tasks ?? [],
    today: todayISO(),
    scope: { project_id: scope.project_id ?? null, client_id: scope.client_id ?? null },
  });
  return { ctx, me };
}
