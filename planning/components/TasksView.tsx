"use client";
import { useEffect, useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { Avatars, ClientTag, shortNames } from "./ui";
import { TaskDrawer, type TaskDraft } from "./TaskDrawer";
import { useVoice } from "./VoiceDialog";
import { CalendarView } from "./CalendarView";
import { canEditTask, isStaff, teamIds } from "@/lib/permissions";
import { taskPeople } from "@/lib/people";
import { alertFor } from "@/lib/alerts";
import { addDays, fmtShort, hhmm, relative } from "@/lib/dates";
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_RANK, STATUS, STATUS_LABEL, type Task, type TaskStatus } from "@/lib/types";

type Scope = "mias" | "equipo" | "todas";
type View = "lista" | "tablero" | "calendario";

const PREFS = "mr-tareas-prefs";

export function TasksView() {
  const { me, profiles, clients, tasks, today, save, toast, byId } = useData();
  const staff = isStaff(me);
  const [scope, setScope] = useState<Scope>("mias");
  const [view, setView] = useState<View>("lista");
  const [client, setClient] = useState("");
  const [person, setPerson] = useState("");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const [hideDone, setHideDone] = useState(true);
  const [open, setOpen] = useState<TaskDraft | null>(null);
  const voice = useVoice();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
      if (p.scope) setScope(p.scope);
      if (p.view) setView(p.view);
      if (typeof p.hideDone === "boolean") setHideDone(p.hideDone);
    } catch {}
    // Link desde el roadmap: /tareas?cliente=<id>
    const c = new URLSearchParams(window.location.search).get("cliente");
    if (c) {
      setClient(c);
      setScope("todas");
    }
  }, []);

  // Abrir una tarea desde un aviso: /tareas?tarea=<id>, o el evento "mr-open" si ya estamos acá
  useEffect(() => {
    const openId = (id: string | null) => {
      const t = id ? tasks.find((x) => x.id === id) : undefined;
      if (t) setOpen(t);
    };
    const q = new URLSearchParams(window.location.search).get("tarea");
    if (q) {
      openId(q);
      window.history.replaceState(null, "", window.location.pathname);
    }
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; id: string }>).detail;
      if (d.key === "tarea") openId(d.id);
    };
    window.addEventListener("mr-open", onOpen);
    return () => window.removeEventListener("mr-open", onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length]);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ scope, view, hideDone }));
    } catch {}
  }, [scope, view, hideDone]);

  const team = useMemo(() => teamIds(me, profiles), [me, profiles]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tasks
      .filter((t) => (scope === "mias" ? taskPeople(t).includes(me.id) : scope === "equipo" ? taskPeople(t).some((id) => team.has(id)) : true))
      .filter((t) => !client || (client === "interno" ? !t.client_id : t.client_id === client))
      .filter((t) => !person || taskPeople(t).includes(person))
      .filter((t) => !priority || t.priority === priority)
      .filter((t) => !s || t.title.toLowerCase().includes(s) || t.description.toLowerCase().includes(s))
      .sort(
        (a, b) =>
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.created_at.localeCompare(b.created_at),
      );
  }, [tasks, scope, me.id, team, client, person, priority, q]);

  // Las que se marcan como hechas acá quedan a la vista (tachadas) hasta recargar, para poder deshacer
  const [justDone, setJustDone] = useState<Set<string>>(new Set());
  const visible = hideDone ? list.filter((t) => t.status !== "hecha" || justDone.has(t.id)) : list;
  const canEdit = (t: Task) => canEditTask(me, t, profiles);

  async function quickUpdate(t: Task, patch: Partial<Task>) {
    const { error } = await save<Task>("tasks", { id: t.id, ...patch });
    if (error) return toast(error, true);
    if (patch.status === "hecha") setJustDone((s) => new Set(s).add(t.id));
  }

  const groups = useMemo(() => {
    const week = addDays(today, 7);
    const g: { key: string; label: string; danger?: boolean; items: Task[] }[] = [
      { key: "vencidas", label: "Vencidas", danger: true, items: [] },
      { key: "hoy", label: "Hoy", items: [] },
      { key: "semana", label: "Próximos 7 días", items: [] },
      { key: "despues", label: "Más adelante", items: [] },
      { key: "sinfecha", label: "Sin fecha", items: [] },
      { key: "hechas", label: "Hechas", items: [] },
    ];
    for (const t of visible) {
      const i =
        t.status === "hecha" && !justDone.has(t.id) ? 5 : !t.due_date ? 4 : t.due_date < today ? 0 : t.due_date === today ? 1 : t.due_date <= week ? 2 : 3;
      g[i].items.push(t);
    }
    g[5].items.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    return g.filter((x) => x.items.length);
  }, [visible, today, justDone]);

  const peopleOptions = scope === "mias" ? [] : profiles.filter((p) => p.active && (scope === "todas" || team.has(p.id)));
  const filtered = client || person || priority || q;
  const open_n = list.filter((t) => t.status !== "hecha").length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Tareas del equipo</div>
          <h1>
            {scope === "mias" ? "Mis " : scope === "equipo" ? "Tareas de mi " : "Todas las "}
            <em>{scope === "equipo" ? "equipo" : "tareas"}</em>
          </h1>
          <div className="muted" style={{ marginTop: 4 }}>
            {open_n} abiertas · {list.length - open_n} hechas
          </div>
        </div>
        <div className="actions">
          <button className="btn cyan" onClick={() => voice.open(client ? { client_id: client } : {})}>
            🎙 Dictar
          </button>
          <button className="btn primary" onClick={() => setOpen({})}>
            + Nueva tarea
          </button>
        </div>
      </div>

      <div className="filters">
        <div className="field">
          <span>Ver</span>
          <div className="seg" role="group">
            <button className={scope === "mias" ? "on" : ""} onClick={() => (setScope("mias"), setPerson(""))}>
              Mías
            </button>
            {staff && (
              <button className={scope === "equipo" ? "on" : ""} onClick={() => setScope("equipo")}>
                Mi equipo
              </button>
            )}
            <button className={scope === "todas" ? "on" : ""} onClick={() => setScope("todas")}>
              Todas
            </button>
          </div>
        </div>
        <label className="field">
          <span>Cliente</span>
          <select value={client} onChange={(e) => setClient(e.target.value)} className={client ? "active" : ""}>
            <option value="">Todos</option>
            <option value="interno">Interno / sin cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {scope !== "mias" && (
          <label className="field">
            <span>Persona</span>
            <select value={person} onChange={(e) => setPerson(e.target.value)} className={person ? "active" : ""}>
              <option value="">Todo el equipo</option>
              {peopleOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Prioridad</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={priority ? "active" : ""}>
            <option value="">Todas</option>
            {PRIORITIES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Buscar</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Título o descripción…" />
        </label>
        <label className="toggle">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Ocultar hechas
        </label>
        {filtered && (
          <button className="btn ghost sm" onClick={() => (setClient(""), setPerson(""), setPriority(""), setQ(""))}>
            Limpiar
          </button>
        )}
        <div className="spacer" />
        <div className="field">
          <span>Vista</span>
          <div className="seg" role="group">
            <button className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>
              Lista
            </button>
            <button className={view === "tablero" ? "on" : ""} onClick={() => setView("tablero")}>
              Tablero
            </button>
            <button className={view === "calendario" ? "on" : ""} onClick={() => setView("calendario")}>
              Calendario
            </button>
          </div>
        </div>
      </div>

      {view === "lista" ? (
        groups.length ? (
          groups.map((g) => (
            <section key={g.key} className="group">
              <div className={`group-h ${g.danger ? "danger" : ""}`}>
                {g.label} <span className="badge soft">{g.items.length}</span>
              </div>
              <div className="tlist">
                {g.items.map((t) => {
                  const editable = canEdit(t);
                  const who = taskPeople(t).map((id) => byId.profile.get(id));
                  const done = t.status === "hecha";
                  const late = !done && t.due_date && t.due_date < today;
                  return (
                    <div key={t.id} className={`trow ${done ? "done" : ""} ${open?.id === t.id ? "sel" : ""}`} onClick={() => setOpen(t)} data-hover-task={t.id}>
                      <button
                        className={`check ${done ? "on" : ""}`}
                        disabled={!editable}
                        title={editable ? (done ? "Reabrir" : "Marcar como hecha") : "Solo la persona asignada o su líder"}
                        onClick={(e) => {
                          e.stopPropagation();
                          quickUpdate(t, { status: done ? "pendiente" : "hecha" });
                        }}
                      >
                        {done ? "✓" : ""}
                      </button>
                      <div className="title">
                        <span className="t">{t.title}</span>
                        <small>
                          <ClientTag c={t.client_id ? byId.client.get(t.client_id) : undefined} />
                          {t.project_id && byId.project.get(t.project_id) ? ` · ${byId.project.get(t.project_id)!.name}` : ""}
                          {t.description ? ` · ${t.description}` : ""}
                        </small>
                      </div>
                      <div className="person">
                        <Avatars people={who} sm />
                        <span>{shortNames(who)}</span>
                      </div>
                      <div className="prio-c">
                        <span className={`prio ${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                      </div>
                      <div className={`due ${late ? "late" : ""}`} title={t.due_date ? `Vence ${fmtShort(t.due_date)}` : "Sin fecha"}>
                        {t.due_date ? (done ? fmtShort(t.due_date) : relative(t.due_date, today)) : <span className="muted">—</span>}
                        {t.start_time && <span className="muted"> · {hhmm(t.start_time)}</span>}
                        {t.recurring_id && <span title="Se repite"> 🔁</span>}
                      </div>
                      <div className="status" onClick={(e) => e.stopPropagation()}>
                        {editable ? (
                          <select
                            value={t.status}
                            onChange={(e) => quickUpdate(t, { status: e.target.value as TaskStatus })}
                            className={`pill s-${t.status}`}
                            style={{ border: 0, padding: "3px 6px" }}
                            aria-label="Estado"
                          >
                            {STATUS.map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`pill s-${t.status}`}>{STATUS_LABEL[t.status]}</span>
                        )}
                      </div>
                      <div className="meta-m">
                        <span className="person">
                          <Avatars people={who} sm /> {shortNames(who)}
                        </span>
                        <span className={`prio ${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                        {t.due_date && <span className={late ? "late" : "muted"}>{relative(t.due_date, today)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <div className="panel empty">
            {filtered ? "No hay tareas con estos filtros." : "No hay tareas abiertas. ¡Sumá una o dictala!"}
          </div>
        )
      ) : view === "calendario" ? (
        <CalendarView tasks={visible} onOpen={(t) => setOpen(t)} onNew={(d) => setOpen(d)} selectedId={open?.id} />
      ) : (
        <div className="kanban">
          {STATUS.filter((s) => !(hideDone && s.key === "hecha")).map((s) => {
            const items = visible.filter((t) => t.status === s.key);
            return (
              <div
                key={s.key}
                className={`col ${overCol === s.key ? "over" : ""}`}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setOverCol(s.key);
                }}
                onDragLeave={() => setOverCol(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const t = tasks.find((x) => x.id === dragId);
                  setOverCol(null);
                  setDragId(null);
                  if (t && t.status !== s.key) quickUpdate(t, { status: s.key });
                }}
              >
                <div className="col-h">
                  <span className={`pill s-${s.key}`}>{s.label}</span>
                  <span className="badge soft">{items.length}</span>
                </div>
                {items.map((t) => {
                  const editable = canEdit(t);
                  const who = taskPeople(t).map((id) => byId.profile.get(id));
                  const alert = alertFor(t, today);
                  return (
                    <div
                      key={t.id}
                      className={`card ${alert && (alert.kind === "vencida" || alert.kind === "bloqueada") ? "alert" : ""} ${dragId === t.id ? "dragging" : ""} ${open?.id === t.id ? "sel" : ""} ${t.status === "hecha" ? "done" : ""}`}
                      data-hover-task={t.id}
                      draggable={editable}
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setOpen(t)}
                    >
                      <ClientTag c={t.client_id ? byId.client.get(t.client_id) : undefined} />
                      <div className="t">{t.title}</div>
                      <div className="row">
                        <span className={`prio ${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {t.due_date && <span className={`mono ${alert?.kind === "vencida" ? "late" : "muted"}`}>{fmtShort(t.due_date)}</span>}
                          <Avatars people={who} sm />
                        </span>
                      </div>
                      {alert && <span className={`pill k-${alert.kind}`}>{alert.text}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {open && <TaskDrawer key={open.id ?? "nueva"} task={open} onClose={() => setOpen(null)} />}
    </>
  );
}
