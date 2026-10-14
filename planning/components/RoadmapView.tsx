"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "./DataProvider";
import { Avatar, CLIENT_COLORS, Modal, SidePanel } from "./ui";
import { TaskDrawer, type TaskDraft } from "./TaskDrawer";
import { canDelete, isStaff } from "@/lib/permissions";
import { addMonths, diffDays, fmtMonth, fmtShort, startOfMonth } from "@/lib/dates";
import { PROJECT_STATUS, PROJECT_STATUS_LABEL, STATUS, type Client, type Project } from "@/lib/types";

/** Texto blanco u oscuro según qué se lee mejor sobre el color del cliente */
function textOn(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#111827" : "#ffffff";
}

const SPANS = [
  { n: 3, label: "Trimestre" },
  { n: 6, label: "Semestre" },
  { n: 12, label: "Año" },
];

export function RoadmapView() {
  const { me, clients, projects, tasks, today, byId } = useData();
  const staff = isStaff(me);
  const [span, setSpan] = useState(6);
  const [from, setFrom] = useState(() => addMonths(startOfMonth(today), -1));
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
  const setOpenTask = (t: TaskDraft | null) => {
    setEditProjectState(null);
    setOpenTaskState(t);
  };

  const to = addMonths(from, span);
  const total = diffDays(to, from);
  const pct = (d: string) => Math.max(0, Math.min(100, (diffDays(d, from) / total) * 100));
  const months = Array.from({ length: span }, (_, i) => addMonths(from, i));

  const visibleClients = clients.filter((c) => (showInactive || c.active) && (!only.size || only.has(c.id)));

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
          <div className="eyebrow">Roadmap por cliente</div>
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
          <span>Período</span>
          <div className="seg">
            {SPANS.map((s) => (
              <button key={s.n} className={span === s.n ? "on" : ""} onClick={() => setSpan(s.n)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Mover</span>
          <div className="seg">
            <button onClick={() => setFrom(addMonths(from, -1))} aria-label="Mes anterior">
              ←
            </button>
            <button onClick={() => setFrom(addMonths(startOfMonth(today), -1))}>Hoy</button>
            <button onClick={() => setFrom(addMonths(from, 1))} aria-label="Mes siguiente">
              →
            </button>
          </div>
        </div>
        <div className="field" style={{ flex: "1 1 300px" }}>
          <span>Clientes</span>
          <div className="chips">
            {clients
              .filter((c) => showInactive || c.active)
              .map((c) => (
                <button key={c.id} className={`chip ${only.has(c.id) ? "on" : ""}`} onClick={() => toggleOnly(c.id)}>
                  <i style={{ background: c.color }} />
                  {c.name}
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
        <div className="gantt-in">
          <div className="g-row g-head">
            <div className="g-label">
              <span className="lbl">Cliente</span>
            </div>
            <div className="g-months">
              {months.map((m) => (
                <div key={m} className={`g-month ${m === startOfMonth(today) ? "cur" : ""}`} style={{ left: `${pct(m)}%`, width: `${pct(addMonths(m, 1)) - pct(m)}%` }}>
                  {fmtMonth(m, span <= 6)}
                </div>
              ))}
              {today >= from && today < to && (
                <div className="g-today" style={{ left: `${pct(today)}%` }}>
                  <span>hoy</span>
                </div>
              )}
            </div>
          </div>
          {visibleClients.map((c) => {
            const ps = projects.filter((p) => p.client_id === c.id && p.end_date >= from && p.start_date < to);
            const st = stats.get(c.id);
            return (
              <div key={c.id} className="g-row">
                <div className="g-label">
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
                  <small>
                    {st?.open ?? 0} tareas abiertas
                    {st?.late ? <span className="late"> · {st.late} vencidas</span> : null}
                  </small>
                </div>
                <div className="g-lane">
                  {months.map((m) => (
                    <div key={m} className="gl" style={{ left: `${pct(m)}%` }} />
                  ))}
                  {today >= from && today < to && <div className="g-today" style={{ left: `${pct(today)}%` }} />}
                  {ps.length ? (
                    ps.map((p) => {
                      const l = pct(p.start_date);
                      const r = pct(p.end_date);
                      const owner = p.owner_id ? byId.profile.get(p.owner_id) : undefined;
                      return (
                        <button
                          key={p.id}
                          className={`bar ${p.status} ${p.start_date < from ? "cut-l" : ""} ${p.end_date >= to ? "cut-r" : ""} ${editProject?.id === p.id ? "sel" : ""}`}
                          style={{ marginLeft: `${l}%`, width: `max(${Math.max(r - l, 0.6)}%, 28px)`, background: c.color, color: textOn(c.color) }}
                          onClick={() => setEditProject(p)}
                          data-hover-project={p.id}
                          aria-label={`${p.name}, ${fmtShort(p.start_date)} a ${fmtShort(p.end_date)}, ${PROJECT_STATUS_LABEL[p.status]}, ${p.progress}%${owner ? `, ${owner.full_name}` : ""}`}
                        >
                          <span className="fill" style={{ width: `${p.progress}%` }} />
                          <span className="lbl-in">
                            {p.name} · {p.progress}%
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="g-empty">Sin proyectos en este período</div>
                  )}
                </div>
              </div>
            );
          })}
          {!visibleClients.length && <div className="empty">Todavía no hay clientes. {staff ? "Sumá el primero con “+ Cliente”." : ""}</div>}
        </div>
      </div>
      <div className="legend">
        <span>La barra muestra el avance (zona más clara).</span>
        <span>Rayada = en pausa · Transparente = completado</span>
      </div>

      <div className="cards">
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
        <ProjectDialog key={editProject.id ?? "nuevo"} project={editProject} onClose={() => setEditProject(null)} onOpenTask={setOpenTask} />
      )}
      {openTask && <TaskDrawer key={openTask.id ?? "nueva"} task={openTask} onClose={() => setOpenTask(null)} />}
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
              {linked.map((t) => (
                <button key={t.id} onClick={() => onOpenTask(t)} data-hover-task={t.id}>
                  <span className={`pill s-${t.status}`}>{STATUS.find((s) => s.key === t.status)?.label}</span>
                  <span className="t">{t.title}</span>
                  <Avatar p={profiles.find((p) => p.id === t.assignee_id)} sm />
                </button>
              ))}
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
