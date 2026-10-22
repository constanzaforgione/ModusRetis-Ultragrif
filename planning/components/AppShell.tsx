"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "./DataProvider";
import { Avatar } from "./ui";
import { Iso } from "./Logo";
import { HoverLayer } from "./HoverLayer";
import { NotificationsMenu } from "./NotificationsMenu";
import { alertsFor } from "@/lib/alerts";
import { ROLE_LABEL } from "@/lib/types";
import { hasPerson } from "@/lib/people";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, tasks, notifications, today, loading, toast } = useData();
  const path = usePathname();

  const myAlerts = useMemo(() => alertsFor(tasks.filter((t) => hasPerson(t, me.id)), today), [tasks, me.id, today]);
  const unread = notifications.filter((n) => !n.read_at).length;
  const urgent = myAlerts.filter((a) => a.kind === "vencida" || a.kind === "por_vencer").length;

  // Avisos nuevos en vivo: cartelito en la app y, si la pestaña no está a la vista, notificación del navegador
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!seen.current) {
      seen.current = new Set(notifications.map((n) => `${n.id}:${n.created_at}`));
      return;
    }
    const fresh = notifications.filter((n) => !n.read_at && !seen.current!.has(`${n.id}:${n.created_at}`));
    notifications.forEach((n) => seen.current!.add(`${n.id}:${n.created_at}`));
    if (!fresh.length) return;
    toast(fresh.length === 1 ? `🔔 ${fresh[0].message}` : `🔔 Tenés ${fresh.length} avisos nuevos`);
    if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Planning Modus Retis", { body: fresh.length === 1 ? fresh[0].message : `Tenés ${fresh.length} avisos nuevos`, icon: "/icon.svg" });
    }
  }, [notifications, loading, toast]);

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

  // Tema: claro u oscuro. Sin elección, sigue al sistema; el botón lo fija y se recuerda.
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const set = document.documentElement.dataset.theme;
    setDark(set ? set === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("mr-theme", next);
    } catch {}
    setDark(!dark);
  };

  const tabs = [
    { href: "/roadmap", label: "Roadmap" },
    { href: "/tareas", label: "Tareas" },
    { href: "/rrss", label: "RRSS" },
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
            <button
              className="iconbtn theme-btn"
              onClick={toggleTheme}
              aria-label={dark ? "Pasar a modo claro" : "Pasar a modo oscuro"}
              title={dark ? "Modo claro" : "Modo oscuro"}
            >
              {dark ? "☀" : "☾"}
            </button>
            <NotificationsMenu />
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
      <HoverLayer />
    </>
  );
}
