import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { DataProvider } from "@/components/DataProvider";
import { emailAllowed, supabaseServer } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!emailAllowed(user.email)) redirect("/login?error=dominio");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single<Profile>();

  if (!profile || !profile.active) {
    return (
      <main className="login">
        <div className="panel">
          <h2>Tu cuenta está pendiente</h2>
          <p className="muted">Un admin tiene que activarla. Avisale a quien maneje el equipo.</p>
          <form action="/auth/signout" method="post">
            <button className="btn">Salir</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <DataProvider me={profile}>
      <AppShell>{children}</AppShell>
    </DataProvider>
  );
}
