"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useData } from "./DataProvider";
import { Avatar } from "./ui";
import { Iso } from "./Logo";
import { alertsFor } from "@/lib/alerts";
import { ROLE_LABEL } from "@/lib/types";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, tasks, notifications, today, loading } = useData();
  const path = usePathname();

  const myAlerts = useMemo(() => alertsFor(tasks.filter((t) => t.assignee_id === me.id), today), [tasks, me.id, today]);
  const unread = notifications.filter((n) => !n.read_at).length;
  const urgent = myAlerts.filter((a) => a.kind === "vencida" || a.kind === "por_vencer").length;

  // Una notificación del navegador por día con el resumen de lo que hay que atender
  useEffect(() => {
    if (loading || !urgent || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const key = `mr-notified-${me.id}`;
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch {
      return;
    }
    const n = new Notification("Planning Modus Retis", {
      body: `Tenés ${urgent} ${urgent === 1 ? "tarea vencida o por vencer" : "tareas vencidas o por vencer"}.`,
      icon: "/icon.svg",
    });
    n.onclick = () => {
      window.focus();
      window.location.href = "/atencion";
    };
  }, [loading, urgent, me.id, today]);

  const tabs = [
    { href: "/roadmap", label: "Roadmap" },
    { href: "/tareas", label: "Tareas" },
    { href: "/atencion", label: "Atención", badge: myAlerts.length },
    { href: "/equipo", label: "Equipo" },
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Link href="/tareas" className="brand">
            <Iso />
            <b>
              Modus Retis <em>Planning</em>
            </b>
          </Link>
          <nav className="nav">
            {tabs.map((t) => (
              <Link key={t.href} href={t.href} className={path.startsWith(t.href) ? "on" : ""}>
                {t.label}
                {!!t.badge && <span className="badge">{t.badge}</span>}
              </Link>
            ))}
          </nav>
          <div className="spacer" />
          <div className="me">
            <Link href="/atencion" className="iconbtn" aria-label={`Avisos: ${unread} sin leer`} title="Avisos">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              {unread > 0 && <span className="badge dot">{unread}</span>}
            </Link>
            <div className="who">
              <b>{me.full_name || me.email}</b>
              <small>{ROLE_LABEL[me.role]}</small>
            </div>
            <Avatar p={me} />
            <form action="/auth/signout" method="post">
              <button className="btn ghost sm" title="Salir">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="main">{loading ? <div className="empty">Cargando…</div> : children}</main>
    </>
  );
}
