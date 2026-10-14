"use client";
import { useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { SidePanel } from "./ui";
import { useSpeech } from "./useSpeech";
import { assignableProfiles, canDelete, canManageUser } from "@/lib/permissions";
import { PRIORITIES, STATUS, type Task } from "@/lib/types";
import { fmtShort } from "@/lib/dates";

export type TaskDraft = Partial<Task>;

export function TaskDrawer({ task, onClose }: { task: TaskDraft; onClose: () => void }) {
  const { me, profiles, clients, projects, save, remove, toast, byId } = useData();
  const isNew = !task.id;
  const [f, setF] = useState<TaskDraft>({
    title: "",
    description: "",
    status: "pendiente",
    priority: "media",
    assignee_id: me.id,
    client_id: null,
    project_id: null,
    start_date: null,
    due_date: null,
    ...task,
  });
  const [busy, setBusy] = useState(false);
  const editable = isNew || canManageUser(me, task.assignee_id!, profiles);
  const assignable = useMemo(() => {
    const list = assignableProfiles(me, profiles);
    // si la tarea es de alguien fuera del alcance, igual mostramos su nombre
    const current = f.assignee_id ? byId.profile.get(f.assignee_id) : undefined;
    return current && !list.includes(current) ? [current, ...list] : list;
  }, [me, profiles, f.assignee_id, byId]);
  const clientProjects = projects.filter((p) => p.client_id === f.client_id);

  const speech = useSpeech((text) => setF((x) => ({ ...x, description: x.description ? `${x.description} ${text}` : text })));
  const set = <K extends keyof Task>(k: K, v: Task[K] | null) => setF((x) => ({ ...x, [k]: v }));

  async function submit() {
    if (!f.title?.trim()) return toast("Poné un título", true);
    setBusy(true);
    const row: Partial<Task> = {
      id: f.id,
      title: f.title.trim(),
      description: f.description ?? "",
      status: f.status,
      priority: f.priority,
      assignee_id: f.assignee_id,
      client_id: f.client_id || null,
      project_id: f.project_id || null,
      start_date: f.start_date || null,
      due_date: f.due_date || null,
    };
    if (isNew) row.created_by = me.id;
    const { error } = await save<Task>("tasks", row);
    setBusy(false);
    if (error) return toast(error, true);
    toast(isNew ? "Tarea creada" : "Cambios guardados");
    onClose();
  }

  async function del() {
    if (!task.id || !confirm(`¿Borrar "${task.title}"? No se puede deshacer.`)) return;
    const err = await remove("tasks", task.id);
    if (err) return toast(err, true);
    toast("Tarea borrada");
    onClose();
  }

  const creator = task.created_by ? byId.profile.get(task.created_by) : undefined;

  return (
    <SidePanel
      title={isNew ? "Nueva tarea" : editable ? "Editar tarea" : "Detalle de la tarea"}
      onClose={onClose}
      footer={
        <>
          <div>
            {!isNew && canDelete(me) && (
              <button className="btn danger" onClick={del}>
                Borrar
              </button>
            )}
          </div>
          <div className="actions">
            <button className="btn" onClick={onClose}>
              {editable ? "Cancelar" : "Cerrar"}
            </button>
            {editable && (
              <button className="btn primary" onClick={submit} disabled={busy}>
                {busy ? "Guardando…" : isNew ? "Crear tarea" : "Guardar"}
              </button>
            )}
          </div>
        </>
      }
    >
      {!editable && <div className="notice">Es una tarea de otra persona: podés verla, pero solo quien la tiene asignada (o su líder) la puede cambiar.</div>}
      <input
        type="text"
        className="title-input"
        placeholder="¿Qué hay que hacer?"
        value={f.title ?? ""}
        onChange={(e) => set("title", e.target.value)}
        disabled={!editable}
        autoFocus={isNew}
      />
      <label className="field with-mic">
        <span>Descripción</span>
        <textarea
          value={f.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
          disabled={!editable}
          placeholder="Contexto, links, próximos pasos…"
          rows={5}
        />
        {editable && (
          <button type="button" className={`btn sm ${speech.listening ? "rec" : ""}`} onClick={speech.toggle} title="Dictar descripción">
            {speech.listening ? "■ Parar" : "🎙 Dictar"}
          </button>
        )}
      </label>
      {speech.interim && <div className="meta-line">… {speech.interim}</div>}
      {speech.error && <div className="notice err">{speech.error}</div>}

      <div className="grid2">
        <label className="field">
          <span>Estado</span>
          <select value={f.status} onChange={(e) => set("status", e.target.value as Task["status"])} disabled={!editable}>
            {STATUS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Prioridad</span>
          <select value={f.priority} onChange={(e) => set("priority", e.target.value as Task["priority"])} disabled={!editable}>
            {PRIORITIES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Responsable</span>
          <select value={f.assignee_id} onChange={(e) => set("assignee_id", e.target.value)} disabled={!editable || assignable.length < 2}>
            {assignable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
                {p.id === me.id ? " (yo)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Cliente</span>
          <select
            value={f.client_id ?? ""}
            onChange={(e) => setF((x) => ({ ...x, client_id: e.target.value || null, project_id: null }))}
            disabled={!editable}
          >
            <option value="">Interno / sin cliente</option>
            {clients
              .filter((c) => c.active || c.id === f.client_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Inicio</span>
          <input type="date" value={f.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} disabled={!editable} />
        </label>
        <label className="field">
          <span>Vence</span>
          <input type="date" value={f.due_date ?? ""} min={f.start_date ?? undefined} onChange={(e) => set("due_date", e.target.value || null)} disabled={!editable} />
        </label>
      </div>
      {clientProjects.length > 0 && (
        <label className="field">
          <span>Proyecto del roadmap</span>
          <select value={f.project_id ?? ""} onChange={(e) => set("project_id", e.target.value || null)} disabled={!editable}>
            <option value="">Sin proyecto</option>
            {clientProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!isNew && (
        <div className="meta-line">
          Creada por {creator?.full_name ?? "—"} el {fmtShort(task.created_at)} · última actualización {fmtShort(task.updated_at)}
          {task.completed_at ? ` · cerrada el ${fmtShort(task.completed_at)}` : ""}
        </div>
      )}
    </SidePanel>
  );
}
