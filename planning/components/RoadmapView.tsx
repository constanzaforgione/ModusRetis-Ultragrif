"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "./DataProvider";
import { Avatar, CLIENT_COLORS, Modal, SidePanel } from "./ui";
import { TaskDrawer, type TaskDraft } from "./TaskDrawer";
import { assignableProfiles, canDelete, canEditTask, isStaff } from "@/lib/permissions";
import { addDays, addMonths, diffDays, fmtMonth, fmtShort, startOfMonth, startOfWeek } from "@/lib/dates";
import { PROJECT_STATUS, PROJECT_STATUS_LABEL, STATUS, type Client, type Project, type Task } from "@/lib/types";

/** Texto blanco u oscuro según qué se lee mejor sobre el color del cliente */
function textOn(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#111827" : "#ffffff";
}

type Unit = "w" | "m";
const SPANS: { key: string; label: string; unit: Unit; n: number }[] = [
  { key: "semanas", label: "Semanas", unit: "w", n: 8 },
  { key: "trimestre", label: "Trimestre", unit: "m", n: 3 },
  { key: "semestre", label: "Semestre", unit: "m", n: 6 },
  { key: "anio", label: "Año", unit: "m", n: 12 },
];
const defaultFrom = (unit: Unit, today: string) => (unit === "w" ? addDays(startOfWeek(today), -7) : addMonths(startOfMonth(today), -1));
const MAX_CHIPS = 3;

export function RoadmapView() {
  const { me, clients, projects, tasks, profiles, today, byId } = useData();
  const staff = isStaff(me);
  const [spanKey, setSpanKey] = useState("semestre");
  const span = SPANS.find((s) => s.key === spanKey)!;
  const [from, setFrom] = useState(() => defaultFrom("m", today));
  const [groupBy, setGroupBy] = useState<"cliente" | "colaborador">("cliente");
  const [only, setOnly] = useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = useState(false);
  const [editClient, setEditClient] = useState<Partial<Client> | null>(null);
  const [editProject, setEditProjectState] = useState<Partial<Project> | null>(null);
  const [openTask, setOpenTaskState] = useState<TaskDraft | null>(null);
  // Un solo panel lateral a la vez: abrir un proyecto cierra la tarea y viceversa
  const setEditProject = (p: Partial<Project> | null) => {
    setOpenTaskState(null);
    setEditProjectState(p);
  };
  // Proyecto desde el que se abrió la tarea, para poder volver con la flecha
  const [returnTo, setReturnTo] = useState<Partial<Project> | null>(null);
  const setOpenTask = (t: TaskDraft | null, from: Partial<Project> | null = null) => {
    setEditProjectState(null);
    setReturnTo(from);
    setOpenTaskState(t);
  };
  const backProject = returnTo ? (projects.find((p) => p.id === returnTo.id) ?? returnTo) : null;

  const weekly = span.unit === "w";
  const to = weekly ? addDays(from, span.n * 7) : addMonths(from, span.n);
  const total = diffDays(to, from);
  const pct = (d: string) => Math.max(0, Math.min(100, (diffDays(d, from) / total) * 100));
  // Columnas de la línea de tiempo: semanas (lunes) o meses
  const cols = Array.from({ length: span.n }, (_, i) => (weekly ? addDays(from, i * 7) : addMonths(from, i)));
  const colEnd = (c: string) => (weekly ? addDays(c, 7) : addMonths(c, 1));
  const curCol = weekly ? startOfWeek(today) : startOfMonth(today);
  const move = (n: number) => setFrom(weekly ? addDays(from, 7 * n) : addMonths(from, n));
  const pickSpan = (key: string) => {
    const next = SPANS.find((s) => s.key === key)!;
    if (next.unit !== span.unit) setFrom(defaultFrom(next.unit, today));
    setSpanKey(key);
  };

  const visibleClients = clients.filter((c) => (showInactive || c.active) && (!only.size || only.has(c.id)));
  const NO_OWNER = "sin-responsable";
  const people = profiles.filter((p) => p.active || projects.some((x) => x.owner_id === p.id));
  const visiblePeople = [
    ...people.filter((p) => !only.size || only.has(p.id)),
    ...(projects.some((x) => !x.owner_id) && (!only.size || only.has(NO_OWNER)) ? [null] : []),
  ];

  const stats = useMemo(() => {
    const m = new Map<string, { open: number; late: number; done: number; total: number; byStatus: Record<string, number> }>();
    for (const t of tasks) {
      if (!t.client_id) continue;
      const s = m.get(t.client_id) ?? { open: 0, late: 0, done: 0, total: 0, byStatus: {} };
      s.total++;
      s.byStatus[t.status] = (s.byStatus[t.status] ?? 0) + 1;
      if (t.status === "hecha") s.done++;
      else {
        s.open++;
        if (t.due_date && t.due_date < today) s.late++;
      }
      m.set(t.client_id, s);
    }
    return m;
  }, [tasks, today]);

  // Filas de la línea de tiempo según "Ver por"
  type Row = { key: string; label: React.ReactNode; sub: React.ReactNode; projects: Project[]; tasks: Task[] };
  const inRange = (p: Project) => p.end_date >= from && p.start_date < to;
  const rows: Row[] =
    groupBy === "cliente"
      ? visibleClients.map((c) => {
          const st = stats.get(c.id);
          return {
            key: c.id,
            label: (
              <b>
                <i style={{ background: c.color }} />
                {staff ? (
                  <button className="btn ghost sm" style={{ padding: 0, fontWeight: 800, fontSize: 14 }} onClick={() => setEditClient(c)} title="Editar cliente">
                    {c.name}
                  </button>
                ) : (
                  c.name
                )}
              </b>
            ),
            sub: (
              <>
                {st?.open ?? 0} tareas abiertas
                {st?.late ? <span className="late"> · {st.late} vencidas</span> : null}
              </>
            ),
            projects: projects.filter((p) => p.client_id === c.id && inRange(p)),
            tasks: tasks.filter((t) => t.client_id === c.id),
          };
        })
      : visiblePeople.map((p) => {
          const mine = p ? tasks.filter((t) => t.assignee_id === p.id) : [];
          const open = mine.filter((t) => t.status !== "hecha");
          const late = open.filter((t) => t.due_date && t.due_date < today).length;
          return {
            key: p?.id ?? NO_OWNER,
            label: p ? (
              <b>
                <Avatar p={p} sm />
                {p.full_name}
              </b>
            ) : (
              <b className="muted">Sin responsable</b>
            ),
            sub: p ? (
              <>
                {open.length} tareas abiertas
                {late ? <span className="late"> · {late} vencidas</span> : null}
              </>
            ) : (
              "Proyectos sin asignar"
            ),
            projects: projects.filter((x) => (p ? x.owner_id === p.id : !x.owner_id) && inRange(x)),
            tasks: mine,
          };
        });


  const toggleOnly = (id: string) =>
    setOnly((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Roadmap por {groupBy === "cliente" ? "cliente" : "colaborador"}</div>
          <h1>
            Línea de tiempo de <em>proyectos</em>
          </h1>
        </div>
        {staff && (
          <div className="actions">
            <button className="btn" onClick={() => setEditClient({ color: CLIENT_COLORS[clients.length % CLIENT_COLORS.length], active: true })}>
              + Cliente
            </button>
            <button className="btn primary" onClick={() => setEditProject({ start_date: today, end_date: addMonths(today, 1), status: "planificado", progress: 0 })} disabled={!clients.length}>
              + Proyecto
            </button>
          </div>
        )}
      </div>

      <div className="filters">
        <div className="field">
          <span>Ver por</span>
          <div className="seg">
            <button className={groupBy === "cliente" ? "on" : ""} onClick={() => (setGroupBy("cliente"), setOnly(new Set()))}>
              Cliente
            </button>
            <button className={groupBy === "colaborador" ? "on" : ""} onClick={() => (setGroupBy("colaborador"), setOnly(new Set()))}>
              Colaborador
            </button>
          </div>
        </div>
        <div className="field">
          <span>Período</span>
          <div className="seg">
            {SPANS.map((s) => (
              <button key={s.key} className={spanKey === s.key ? "on" : ""} onClick={() => pickSpan(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Mover</span>
          <div className="seg">
            <button onClick={() => move(-1)} aria-label={weekly ? "Semana anterior" : "Mes anterior"}>
              ←
            </button>
            <button onClick={() => setFrom(defaultFrom(span.unit, today))}>Hoy</button>
            <button onClick={() => move(1)} aria-label={weekly ? "Semana siguiente" : "Mes siguiente"}>
              →
            </button>
          </div>
        </div>
        <div className="field" style={{ flex: "1 1 300px" }}>
          <span>{groupBy === "cliente" ? "Clientes" : "Colaboradores"}</span>
          <div className="chips">
            {groupBy === "cliente"
              ? clients
                  .filter((c) => showInactive || c.active)
                  .map((c) => (
                    <button key={c.id} className={`chip ${only.has(c.id) ? "on" : ""}`} onClick={() => toggleOnly(c.id)}>
                      <i style={{ background: c.color }} />
                      {c.name}
                    </button>
                  ))
              : people.map((p) => (
                  <button key={p.id} className={`chip ${only.has(p.id) ? "on" : ""}`} onClick={() => toggleOnly(p.id)}>
                    <Avatar p={p} sm />
                    {p.full_name}
                  </button>
                ))}
            {only.size > 0 && (
              <button className="btn ghost sm" onClick={() => setOnly(new Set())}>
                Ver todos
              </button>
            )}
          </div>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inactivos
        </label>
      </div>

      <div className="gantt">
        <div className="gantt-in" style={weekly ? { minWidth: 160 * span.n + 220 } : undefined}>
          <div className="g-row g-head">
            <div className="g-label">
              <span className="lbl">{groupBy === "cliente" ? "Cliente" : "Colaborador"}</span>
            </div>
            <div className="g-months">
              {cols.map((m) => (
                <div key={m} className={`g-month ${m === curCol ? "cur" : ""}`} style={{ left: `${pct(m)}%`, width: `${pct(colEnd(m)) - pct(m)}%` }}>
                  {weekly ? (
                    <>
                      {m === curCol ? "Esta semana" : "Semana"} <span className="mono">{fmtShort(m)}</span>
                    </>
                  ) : (
                    fmtMonth(m, span.n <= 6)
                  )}
                </div>
              ))}
              {today >= from && today < to && (
                <div className="g-today" style={{ left: `${pct(today)}%` }}>
                  <span>hoy</span>
                </div>
              )}
            </div>
          </div>
          {rows.map((row) => (
            <div key={row.key} className="g-row">
              <div className="g-label">
                {row.label}
                <small>{row.sub}</small>
              </div>
              <div className="g-lane">
                {cols.map((m) => (
                  <div key={m} className={`gl ${weekly && m === curCol ? "cur" : ""}`} style={{ left: `${pct(m)}%`, width: weekly ? `${pct(colEnd(m)) - pct(m)}%` : undefined }} />
                ))}
                {today >= from && today < to && <div className="g-today" style={{ left: `${pct(today)}%` }} />}
                {row.projects.map((p) => {
                  const c = byId.client.get(p.client_id);
                  const color = c?.color ?? "#304cd3";
                  const l = pct(p.start_date);
                  const r = pct(p.end_date);
                  const owner = p.owner_id ? byId.profile.get(p.owner_id) : undefined;
                  return (
                    <button
                      key={p.id}
                      className={`bar ${p.status} ${p.start_date < from ? "cut-l" : ""} ${p.end_date >= to ? "cut-r" : ""} ${editProject?.id === p.id ? "sel" : ""}`}
                      style={{ marginLeft: `${l}%`, width: `max(${Math.max(r - l, 0.6)}%, 28px)`, background: color, color: textOn(color) }}
                      onClick={() => setEditProject(p)}
                      data-hover-project={p.id}
                      aria-label={`${p.name}, ${fmtShort(p.start_date)} a ${fmtShort(p.end_date)}, ${PROJECT_STATUS_LABEL[p.status]}, ${p.progress}%${owner ? `, ${owner.full_name}` : ""}`}
                    >
                      <span className="fill" style={{ width: `${p.progress}%` }} />
                      <span className="lbl-in">
                        {groupBy === "colaborador" && c ? `${c.name} · ` : ""}
                        {p.name} · {p.progress}%
                      </span>
                    </button>
                  );
                })}
                {weekly && (
                  // Vista por semana: las tareas de cada semana (por vencimiento) debajo de los proyectos
                  <div className="g-wk" style={{ gridTemplateColumns: `repeat(${span.n}, minmax(0, 1fr))` }}>
                    {cols.map((w) => {
                      const end = colEnd(w);
                      const list = row.tasks
                        .filter((t) => {
                          const d = t.due_date ?? t.start_date;
                          return d && d >= w && d < end;
                        })
                        .sort((a, b) => Number(a.status === "hecha") - Number(b.status === "hecha"));
                      return (
                        <div key={w} className="g-wkcell">
                          {list.slice(0, MAX_CHIPS).map((t) => {
                            const c = t.client_id ? byId.client.get(t.client_id) : undefined;
                            const late = t.status !== "hecha" && t.due_date && t.due_date < today;
                            return (
                              <button
                                key={t.id}
                                className={`cal-chip ${t.status === "hecha" ? "done" : ""} ${late ? "late" : ""}`}
                                style={{ borderLeftColor: c?.color ?? "var(--border)" }}
                                onClick={() => setOpenTask(t)}
                                data-hover-task={t.id}
                              >
                                <span className="t">{t.title}</span>
                                {groupBy === "cliente" && <Avatar p={byId.profile.get(t.assignee_id)} sm />}
                              </button>
                            );
                          })}
                          {list.length > MAX_CHIPS && <span className="g-more">+{list.length - MAX_CHIPS} más</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {!row.projects.length && !weekly && <div className="g-empty">Sin proyectos en este período</div>}
              </div>
            </div>
          ))}
          {!rows.length && (
            <div className="empty">
              {groupBy === "cliente" ? `Todavía no hay clientes. ${staff ? "Sumá el primero con “+ Cliente”." : ""}` : "No hay colaboradores con estos filtros."}
            </div>
          )}
        </div>
      </div>
      <div className="legend">
        <span>La barra muestra el avance (zona más clara).</span>
        <span>Rayada = en pausa · Transparente = completado</span>
        {weekly && <span>Debajo de cada fila: las tareas de esa semana (por vencimiento).</span>}
      </div>

      <div className="cards" hidden={groupBy !== "cliente"}>
        {visibleClients.map((c) => {
          const st = stats.get(c.id);
          const active = projects.filter((p) => p.client_id === c.id && p.status !== "completado");
          return (
            <div key={c.id} className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <i style={{ width: 10, height: 10, borderRadius: 3, background: c.color, display: "inline-block" }} />
                  {staff ? (
                    <button className="link" onClick={() => setEditClient(c)} title="Editar cliente">
                      {c.name}
                    </button>
                  ) : (
                    c.name
                  )}
                </h2>
                <span className="big" style={{ fontSize: 22 }}>
                  {st?.total ? Math.round((st.done / st.total) * 100) : 0}%
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {st?.done ?? 0} de {st?.total ?? 0} tareas hechas · {active.length} proyectos activos
              </div>
              <div className="stack">
                {STATUS.filter((s) => st?.byStatus[s.key]).map((s) => (
                  <span key={s.key} className={`d-${s.key}`} style={{ flex: st!.byStatus[s.key] }} title={`${s.label}: ${st!.byStatus[s.key]}`} />
                ))}
              </div>
              {c.description && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{c.description}</p>}
              {active.length > 0 && (
                <div className="mini-list" style={{ marginTop: 12 }}>
                  {active.map((p) => (
                    <button key={p.id} onClick={() => setEditProject(p)} data-hover-project={p.id} className={editProject?.id === p.id ? "sel" : ""}>
                      <span className="t">{p.name}</span>
                      <span className="mono muted">{p.progress}%</span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link href={`/tareas?cliente=${c.id}`} className="btn sm">
                  Ver tareas →
                </Link>
                <button className="btn sm" onClick={() => setOpenTask({ client_id: c.id })}>
                  + Tarea
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editClient && <ClientDialog client={editClient} onClose={() => setEditClient(null)} />}
      {editProject && (
        <ProjectDialog key={editProject.id ?? "nuevo"} project={editProject} onClose={() => setEditProject(null)} onOpenTask={(t) => setOpenTask(t, editProject)} />
      )}
      {openTask && (
        <TaskDrawer
          key={openTask.id ?? "nueva"}
          task={openTask}
          onClose={() => setOpenTask(null)}
          back={backProject ? { label: backProject.name ?? "Proyecto", onClick: () => setEditProject(backProject) } : undefined}
        />
      )}
    </>
  );
}

function ClientDialog({ client, onClose }: { client: Partial<Client>; onClose: () => void }) {
  const { me, save, remove, toast } = useData();
  const [f, setF] = useState(client);
  const isNew = !client.id;

  async function submit() {
    if (!f.name?.trim()) return toast("Poné el nombre del cliente", true);
    const { error } = await save<Client>("clients", {
      id: f.id,
      name: f.name.trim(),
      color: f.color,
      description: f.description ?? "",
      active: f.active ?? true,
      ...(isNew ? { created_by: me.id } : {}),
    });
    if (error) return toast(error, true);
    toast(isNew ? "Cliente agregado" : "Cliente actualizado");
    onClose();
  }
  async function del() {
    if (!client.id || !confirm(`¿Borrar ${client.name}? Se borran también sus proyectos del roadmap (las tareas quedan sin cliente).`)) return;
    const err = await remove("clients", client.id);
    if (err) return toast(err, true);
    onClose();
  }

  return (
    <Modal
      title={isNew ? "Nuevo cliente" : "Editar cliente"}
      onClose={onClose}
      footer={
        <>
          <div>{!isNew && canDelete(me) && <button className="btn danger" onClick={del}>Borrar</button>}</div>
          <div className="actions">
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn primary" onClick={submit}>{isNew ? "Agregar" : "Guardar"}</button>
          </div>
        </>
      }
    >
      <label className="field">
        <span>Nombre</span>
        <input type="text" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="Ej: Confort Iván" />
      </label>
      <div className="field">
        <span>Color</span>
        <div className="swatches">
          {CLIENT_COLORS.map((c) => (
            <button key={c} type="button" className={`swatch ${f.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setF({ ...f, color: c })} aria-label={c} />
          ))}
        </div>
      </div>
      <label className="field">
        <span>Descripción</span>
        <textarea rows={3} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Qué hacemos con este cliente" />
      </label>
      {!isNew && (
        <label className="toggle">
          <input type="checkbox" checked={f.active ?? true} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Cliente activo
        </label>
      )}
    </Modal>
  );
}

function ProjectDialog({
  project,
  onClose,
  onOpenTask,
}: {
  project: Partial<Project>;
  onClose: () => void;
  onOpenTask: (t: TaskDraft) => void;
}) {
  const { me, clients, profiles, tasks, save, remove, toast } = useData();
  const staff = isStaff(me);
  const [f, setF] = useState<Partial<Project>>({ client_id: clients.find((c) => c.active)?.id, ...project });
  const isNew = !project.id;
  const linked = tasks.filter((t) => t.project_id && t.project_id === project.id);

  async function submit() {
    if (!f.name?.trim() || !f.client_id || !f.start_date || !f.end_date) return toast("Completá cliente, nombre y fechas", true);
    const { error } = await save<Project>("projects", {
      id: f.id,
      client_id: f.client_id,
      name: f.name.trim(),
      description: f.description ?? "",
      status: f.status,
      start_date: f.start_date,
      end_date: f.end_date,
      progress: Math.max(0, Math.min(100, Number(f.progress) || 0)),
      owner_id: f.owner_id || null,
      ...(isNew ? { created_by: me.id } : {}),
    });
    if (error) return toast(error, true);
    toast(isNew ? "Proyecto agregado al roadmap" : "Proyecto actualizado");
    onClose();
  }
  async function quickSave(t: Task, patch: Partial<Task>) {
    const { error } = await save<Task>("tasks", { id: t.id, ...patch });
    if (error) toast(error, true);
  }
  const toggleDone = (t: Task) => quickSave(t, { status: t.status === "hecha" ? "pendiente" : "hecha" });
  async function del() {
    if (!project.id || !confirm(`¿Borrar el proyecto "${project.name}"?`)) return;
    const err = await remove("projects", project.id);
    if (err) return toast(err, true);
    onClose();
  }

  return (
    <SidePanel
      title={isNew ? "Nuevo proyecto" : staff ? "Editar proyecto" : project.name}
      onClose={onClose}
      footer={
        <>
          <div>{!isNew && canDelete(me) && <button className="btn danger" onClick={del}>Borrar</button>}</div>
          <div className="actions">
            <button className="btn" onClick={onClose}>{staff ? "Cancelar" : "Cerrar"}</button>
            {staff && <button className="btn primary" onClick={submit}>{isNew ? "Agregar" : "Guardar"}</button>}
          </div>
        </>
      }
    >
      {!staff && <div className="notice">Solo líderes y admins editan el roadmap.</div>}
      <div className="grid2">
        <label className="field">
          <span>Cliente</span>
          <select value={f.client_id ?? ""} onChange={(e) => setF({ ...f, client_id: e.target.value })} disabled={!staff}>
            {clients.filter((c) => c.active || c.id === f.client_id).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Estado</span>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Project["status"] })} disabled={!staff}>
            {PROJECT_STATUS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Proyecto</span>
        <input type="text" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!staff} placeholder="Ej: Implementación Odoo facturación" autoFocus={isNew} />
      </label>
      <label className="field">
        <span>Descripción</span>
        <textarea rows={3} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} disabled={!staff} />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Inicio</span>
          <input type="date" value={f.start_date ?? ""} onChange={(e) => setF({ ...f, start_date: e.target.value })} disabled={!staff} />
        </label>
        <label className="field">
          <span>Fin</span>
          <input type="date" value={f.end_date ?? ""} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} disabled={!staff} />
        </label>
        <label className="field">
          <span>Responsable</span>
          <select value={f.owner_id ?? ""} onChange={(e) => setF({ ...f, owner_id: e.target.value || null })} disabled={!staff}>
            <option value="">Sin asignar</option>
            {profiles.filter((p) => p.active).map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Avance: {f.progress ?? 0}%</span>
          <input type="range" min={0} max={100} step={5} value={f.progress ?? 0} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} disabled={!staff} />
        </label>
      </div>
      {!isNew && (
        <div className="field">
          <span>
            Tareas del proyecto ({linked.filter((t) => t.status === "hecha").length}/{linked.length} hechas)
          </span>
          {linked.length > 0 && (
            <div className="mini-list">
              {[...linked]
                .sort((a, b) => Number(a.status === "hecha") - Number(b.status === "hecha"))
                .map((t) => {
                  const done = t.status === "hecha";
                  const editable = canEditTask(me, t, profiles);
                  return (
                    <div key={t.id} className={`mini-row ${done ? "done" : ""}`} data-hover-task={t.id}>
                      <button
                        className={`check ${done ? "on" : ""}`}
                        disabled={!editable}
                        title={editable ? (done ? "Reabrir" : "Marcar como hecha") : "Solo la persona asignada o su líder"}
                        onClick={() => toggleDone(t)}
                      >
                        {done ? "✓" : ""}
                      </button>
                      <button className="link t" onClick={() => onOpenTask(t)} title="Abrir la tarea">
                        {t.title}
                      </button>
                      <div className="mini-ctrls">
                        {editable ? (
                          <>
                            <select
                              value={t.status}
                              onChange={(e) => quickSave(t, { status: e.target.value as Task["status"] })}
                              className={`pill s-${t.status}`}
                              aria-label="Estado"
                            >
                              {STATUS.map((s) => (
                                <option key={s.key} value={s.key}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                            <select value={t.assignee_id} onChange={(e) => quickSave(t, { assignee_id: e.target.value })} aria-label="Responsable">
                              {(() => {
                                const list = assignableProfiles(me, profiles);
                                const cur = profiles.find((p) => p.id === t.assignee_id);
                                return (cur && !list.includes(cur) ? [cur, ...list] : list).map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.full_name}
                                    {p.id === me.id ? " (yo)" : ""}
                                  </option>
                                ));
                              })()}
                            </select>
                          </>
                        ) : (
                          <>
                            <span className={`pill s-${t.status}`}>{STATUS.find((s) => s.key === t.status)?.label}</span>
                            <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                              <Avatar p={profiles.find((p) => p.id === t.assignee_id)} sm />
                              {profiles.find((p) => p.id === t.assignee_id)?.full_name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
          <div>
            <button className="btn sm" onClick={() => onOpenTask({ client_id: project.client_id, project_id: project.id })}>
              + Tarea en este proyecto
            </button>
          </div>
        </div>
      )}
    </SidePanel>
  );
}
