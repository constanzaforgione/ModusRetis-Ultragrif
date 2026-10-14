"use client";
// Calendario de tareas: semana (con horarios) o mes. Cada tarea va el día que vence (o el de inicio
// si no tiene vencimiento); si tiene horario se ubica en esa franja, si no, arriba como "todo el día".
// En celular, la semana se muestra como agenda día por día.
import { useEffect, useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { Avatar } from "./ui";
import { addDays, addMonths, dayName, fmtMonth, fmtShort, hhmm, startOfMonth, startOfWeek, weekday } from "@/lib/dates";
import type { Task } from "@/lib/types";
import type { TaskDraft } from "./TaskDrawer";

const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const HOUR_PX = 48;

const dayOf = (t: Task) => t.due_date ?? t.start_date;
const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export function CalendarView({ tasks, onOpen, onNew, selectedId }: { tasks: Task[]; onOpen: (t: Task) => void; onNew: (t: TaskDraft) => void; selectedId?: string }) {
  const { today, byId } = useData();
  const [mode, setMode] = useState<"semana" | "mes">("semana");
  const [anchor, setAnchor] = useState(today);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const d = dayOf(t);
      if (!d) continue;
      m.set(d, [...(m.get(d) ?? []), t]);
    }
    for (const list of m.values()) list.sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));
    return m;
  }, [tasks]);
  const undated = tasks.filter((t) => !dayOf(t) && t.status !== "hecha").length;

  const weekStart = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const move = (n: number) => setAnchor(mode === "semana" ? addDays(anchor, 7 * n) : addMonths(anchor, n));
  const title =
    mode === "mes"
      ? fmtMonth(monthStart, true)
      : `${fmtShort(days[0])} – ${fmtShort(days[6])}`;

  const chip = (t: Task, compact = false) => {
    const c = t.client_id ? byId.client.get(t.client_id) : undefined;
    const late = t.status !== "hecha" && t.due_date && t.due_date < today;
    return (
      <button
        key={t.id}
        className={`cal-chip ${t.status === "hecha" ? "done" : ""} ${late ? "late" : ""} ${selectedId === t.id ? "sel" : ""}`}
        style={{ borderLeftColor: c?.color ?? "var(--border)" }}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(t);
        }}
        data-hover-task={t.id}
      >
        {t.start_time && <span className="mono">{hhmm(t.start_time)}</span>}
        {t.recurring_id && <span aria-label="Se repite">🔁</span>}
        <span className="t">{t.title}</span>
        {!compact && <Avatar p={byId.profile.get(t.assignee_id)} sm />}
      </button>
    );
  };

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="seg">
          <button onClick={() => move(-1)} aria-label="Anterior">
            ←
          </button>
          <button onClick={() => setAnchor(today)}>Hoy</button>
          <button onClick={() => move(1)} aria-label="Siguiente">
            →
          </button>
        </div>
        <b className="cal-title">{title}</b>
        <div className="spacer" />
        {undated > 0 && <span className="muted" style={{ fontSize: 12 }}>{undated} sin fecha (no aparecen acá)</span>}
        <div className="seg">
          <button className={mode === "semana" ? "on" : ""} onClick={() => setMode("semana")}>
            Semana
          </button>
          <button className={mode === "mes" ? "on" : ""} onClick={() => setMode("mes")}>
            Mes
          </button>
        </div>
      </div>

      {mode === "mes" ? (
        <div className="cal-month">
          {["lun", "mar", "mié", "jue", "vie", "sáb", "dom"].map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}
          {monthDays.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div
                key={d}
                className={`cal-cell ${d.slice(0, 7) !== monthStart.slice(0, 7) ? "out" : ""} ${d === today ? "today" : ""} ${weekday(d) > 4 ? "we" : ""}`}
                onClick={() => onNew({ due_date: d })}
                title="Clic en un espacio libre para crear una tarea ese día"
              >
                <span className="cal-num">{Number(d.slice(8))}</span>
                {list.slice(0, mobile ? 2 : 4).map((t) => chip(t, true))}
                {list.length > (mobile ? 2 : 4) && (
                  <button
                    className="cal-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAnchor(d);
                      setMode("semana");
                    }}
                  >
                    +{list.length - (mobile ? 2 : 4)} más
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : mobile ? (
        // Agenda: un bloque por día
        <div className="cal-agenda">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={d} className={`cal-aday ${d === today ? "today" : ""}`}>
                <div className="cal-ahead">
                  <b>
                    {dayName(d)} {Number(d.slice(8))}
                  </b>
                  <button className="btn ghost sm" onClick={() => onNew({ due_date: d })}>
                    + Tarea
                  </button>
                </div>
                {list.length ? list.map((t) => chip(t)) : <div className="muted" style={{ fontSize: 12.5 }}>Sin tareas</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="cal-week">
          <div className="cal-whead">
            <div />
            {days.map((d) => (
              <div key={d} className={`cal-wday ${d === today ? "today" : ""}`}>
                {dayName(d)} <b>{Number(d.slice(8))}</b>
              </div>
            ))}
          </div>
          <div className="cal-allday">
            <div className="cal-hlabel">Todo el día</div>
            {days.map((d) => (
              <div key={d} className="cal-adcell" onClick={() => onNew({ due_date: d })}>
                {(byDay.get(d) ?? []).filter((t) => !t.start_time).map((t) => chip(t, true))}
              </div>
            ))}
          </div>
          <div className="cal-grid" style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_PX }}>
            <div className="cal-hours">
              {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => (
                <div key={i} style={{ top: i * HOUR_PX }}>
                  {String(FIRST_HOUR + i).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {days.map((d) => {
              const timed = (byDay.get(d) ?? []).filter((t) => t.start_time);
              // Tareas que se superponen se ponen lado a lado
              const lanes: string[] = [];
              const lane = new Map<string, number>();
              for (const t of timed) {
                const s = minutes(t.start_time!);
                let i = lanes.findIndex((end) => minutes(end) <= s);
                if (i < 0) i = lanes.push("") - 1;
                lanes[i] = t.end_time ?? hhmm(`${String(Math.min(23, Math.floor(s / 60) + 1)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
                lane.set(t.id, i);
              }
              const n = Math.max(1, lanes.length);
              return (
                <div
                  key={d}
                  className={`cal-col ${d === today ? "today" : ""} ${weekday(d) > 4 ? "we" : ""}`}
                  onClick={(e) => {
                    const y = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
                    const h = Math.min(LAST_HOUR - 1, FIRST_HOUR + Math.floor(y / HOUR_PX));
                    const p = (x: number) => `${String(x).padStart(2, "0")}:00`;
                    onNew({ due_date: d, start_time: p(h), end_time: p(h + 1) });
                  }}
                >
                  {d === today && <NowLine />}
                  {timed.map((t) => {
                    const s = minutes(t.start_time!);
                    const e = t.end_time ? minutes(t.end_time) : s + 60;
                    const top = ((s - FIRST_HOUR * 60) / 60) * HOUR_PX;
                    const height = Math.max(22, ((e - s) / 60) * HOUR_PX - 2);
                    const c = t.client_id ? byId.client.get(t.client_id) : undefined;
                    const i = lane.get(t.id) ?? 0;
                    return (
                      <button
                        key={t.id}
                        className={`cal-block ${height < 40 ? "short" : ""} ${t.status === "hecha" ? "done" : ""} ${selectedId === t.id ? "sel" : ""}`}
                        style={{
                          top: Math.max(0, top),
                          height,
                          left: `calc(${(i / n) * 100}% + 2px)`,
                          width: `calc(${100 / n}% - 4px)`,
                          borderLeftColor: c?.color ?? "var(--primary)",
                        }}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onOpen(t);
                        }}
                        data-hover-task={t.id}
                      >
                        <span className="mono">
                          {hhmm(t.start_time)}
                          {t.end_time ? `–${hhmm(t.end_time)}` : ""}
                        </span>
                        <span className="t">
                          {t.recurring_id ? "🔁 " : ""}
                          {t.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="meta-line">Tocá un espacio libre para crear una tarea en ese día y horario.</div>
    </div>
  );
}

function NowLine() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(iv);
  }, []);
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })
    .format(now)
    .split(":")
    .map(Number);
  const top = ((h * 60 + m - FIRST_HOUR * 60) / 60) * HOUR_PX;
  if (top < 0 || top > (LAST_HOUR - FIRST_HOUR) * HOUR_PX) return null;
  return <div className="cal-now" style={{ top }} />;
}
