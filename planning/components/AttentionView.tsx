"use client";
import { useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { Avatar, ClientTag, shortNames } from "./ui";
import { TaskDrawer } from "./TaskDrawer";
import { NotificationRow } from "./NotificationsMenu";
import { openFromNotification } from "@/lib/notifications";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ALERT_META, alertsFor, type Alert, type AlertKind } from "@/lib/alerts";
import { isStaff, teamIds } from "@/lib/permissions";
import { hasPerson, taskPeople } from "@/lib/people";
import { STATUS_LABEL, type Task } from "@/lib/types";

const KINDS: AlertKind[] = ["vencida", "por_vencer", "bloqueada", "sin_movimiento"];

export function AttentionView() {
  const { me, profiles, tasks, notifications, today, byId, reload } = useData();
  const [open, setOpen] = useState<Task | null>(null);
  const router = useRouter();
  const [perm, setPerm] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const staff = isStaff(me);

  const mine = useMemo(() => alertsFor(tasks.filter((t) => hasPerson(t, me.id)), today), [tasks, me.id, today]);
  const team = useMemo(() => {
    if (!staff) return [];
    const ids = teamIds(me, profiles);
    return alertsFor(tasks.filter((t) => !hasPerson(t, me.id) && taskPeople(t).some((id) => ids.has(id))), today);
  }, [staff, me, profiles, tasks, today]);

  const byPerson = useMemo(() => {
    const m = new Map<string, Alert[]>();
    const ids = teamIds(me, profiles);
    // una tarea compartida aparece en cada persona del equipo que la tiene
    team.forEach((a) => taskPeople(a.task).filter((id) => ids.has(id)).forEach((id) => m.set(id, [...(m.get(id) ?? []), a])));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [team, me, profiles]);

  async function markAllRead() {
    await supabaseBrowser().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null).eq("user_id", me.id);
    reload("notifications");
  }
  async function enableBrowser() {
    if (typeof Notification === "undefined") return;
    setPerm(await Notification.requestPermission());
  }

  const unread = notifications.filter((n) => !n.read_at);

  const Item = ({ a, showPerson }: { a: Alert; showPerson?: boolean }) => (
    <div className={`item ${open?.id === a.task.id ? "sel" : ""}`} onClick={() => setOpen(a.task)} data-hover-task={a.task.id}>
      <span className={`pill k-${a.kind}`}>{ALERT_META[a.kind].label}</span>
      <div>{a.task.title}</div>
      <div className="meta">
        {a.text} · <ClientTag c={a.task.client_id ? byId.client.get(a.task.client_id) : undefined} /> · {STATUS_LABEL[a.task.status]}
        {showPerson ? ` · ${shortNames(taskPeople(a.task).map((id) => byId.profile.get(id)))}` : ""}
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Atención</div>
          <h1>
            Lo que <em>no puede esperar</em>
          </h1>
        </div>
        <div className="actions">
          {perm === "default" && (
            <button className="btn" onClick={enableBrowser}>
              🔔 Activar avisos del navegador
            </button>
          )}
          {perm === "granted" && <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>Avisos del navegador activados</span>}
        </div>
      </div>

      <div className="kpis">
        {KINDS.map((k) => (
          <div key={k} className={`kpi k-${k}`} style={{ background: "var(--surface)" }}>
            <span className="n">{mine.filter((a) => a.kind === k).length}</span>
            <span className="t">{ALERT_META[k].label}</span>
          </div>
        ))}
      </div>

      <div className="att">
        <div className="panel">
          <h2 style={{ marginBottom: 8 }}>Mis tareas</h2>
          {mine.length ? mine.map((a) => <Item key={a.task.id} a={a} />) : <div className="empty">Nada vencido ni trabado. 🙌</div>}
        </div>

        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h2>Avisos {unread.length > 0 && <span className="badge">{unread.length}</span>}</h2>
            {unread.length > 0 && (
              <button className="btn ghost sm" onClick={markAllRead}>
                Marcar leídos
              </button>
            )}
          </div>
          {notifications.length ? (
            <div className="notif-list">
              {notifications.slice(0, 30).map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  actor={n.actor_id ? byId.profile.get(n.actor_id) : undefined}
                  onClick={async () => {
                    if (!n.read_at) {
                      await supabaseBrowser().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
                      reload("notifications");
                    }
                    const t = n.task_id ? tasks.find((x) => x.id === n.task_id) : undefined;
                    if (t) setOpen(t);
                    else openFromNotification(n, router.push);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="empty">Sin avisos todavía.</div>
          )}
        </div>
      </div>

      {staff && (
        <>
          <div className="group-h" style={{ marginTop: 6 }}>
            {me.role === "admin" ? "Todo el equipo" : "Mi equipo"} <span className="badge soft">{team.length}</span>
          </div>
          {byPerson.length ? (
            <div className="att">
              {byPerson.map(([pid, alerts]) => {
                const p = byId.profile.get(pid);
                return (
                  <div key={pid} className="panel">
                    <h2 style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <Avatar p={p} sm /> {p?.full_name}
                      <span className="badge soft" style={{ marginLeft: "auto" }}>
                        {alerts.length}
                      </span>
                    </h2>
                    {alerts.map((a) => (
                      <Item key={a.task.id} a={a} />
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel empty">Tu equipo está al día.</div>
          )}
        </>
      )}

      {open && <TaskDrawer key={open.id} task={open} onClose={() => setOpen(null)} />}
    </>
  );
}
