"use client";
// Campanita: desplegable con los últimos avisos. Tocar uno lo marca como leído y abre la tarea o el proyecto.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useData } from "./DataProvider";
import { Avatar } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { iconFor, openFromNotification, timeAgo } from "@/lib/notifications";
import type { Notification } from "@/lib/types";

export function NotificationsMenu() {
  const { me, notifications, reload, byId } = useData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function markRead(ids: string[]) {
    if (!ids.length) return;
    await supabaseBrowser().from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids).eq("user_id", me.id);
    reload("notifications");
  }

  function pick(n: Notification) {
    setOpen(false);
    if (!n.read_at) markRead([n.id]);
    openFromNotification(n, router.push);
  }

  return (
    <div className="notif-menu" ref={box}>
      <button className="iconbtn" aria-label={`Avisos: ${unread} sin leer`} title="Avisos" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="badge dot">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="notif-pop" role="dialog" aria-label="Avisos">
          <div className="notif-pop-h">
            <b>Avisos</b>
            {unread > 0 && (
              <button className="btn ghost sm" onClick={() => markRead(notifications.filter((n) => !n.read_at).map((n) => n.id))}>
                Marcar todo como leído
              </button>
            )}
          </div>
          <div className="notif-pop-b">
            {notifications.length ? (
              notifications.slice(0, 20).map((n) => (
                <NotificationRow key={n.id} n={n} actor={n.actor_id ? byId.profile.get(n.actor_id) : undefined} onClick={() => pick(n)} />
              ))
            ) : (
              <div className="empty">No tenés avisos todavía.</div>
            )}
          </div>
          <Link href="/atencion" className="notif-pop-f" onClick={() => setOpen(false)}>
            Ver todo en Atención →
          </Link>
        </div>
      )}
    </div>
  );
}

export function NotificationRow({ n, actor, onClick }: { n: Notification; actor?: Parameters<typeof Avatar>[0]["p"]; onClick: () => void }) {
  const clickable = !!(n.task_id || n.project_id);
  return (
    <button className={`notif-row ${n.read_at ? "" : "unread"}`} onClick={onClick} disabled={!clickable && !!n.read_at}>
      <span className="notif-ico" aria-hidden="true">
        {actor ? <Avatar p={actor} sm /> : iconFor(n)}
      </span>
      <span className="notif-txt">
        <span>{n.message}</span>
        <small>
          {actor ? `${iconFor(n)} ` : ""}
          {timeAgo(n.created_at)}
        </small>
      </span>
      {!n.read_at && <i className="notif-dot" aria-label="Sin leer" />}
    </button>
  );
}
