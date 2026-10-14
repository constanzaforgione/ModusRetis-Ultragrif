"use client";
import { useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { SidePanel } from "./ui";
import { useSpeech } from "./useSpeech";
import { assignableProfiles, canDelete, canEditTask } from "@/lib/permissions";
import { PRIORITIES, RECURRENCE, STATUS, type Recurrence, type RecurringTask, type Task } from "@/lib/types";
import { diffDays, fmtShort, hhmm, nextOccurrence, todayISO } from "@/lib/dates";

export type TaskDraft = Partial<Task>;

export function TaskDrawer({
  task,
  onClose,
  back,
}: {
  task: TaskDraft;
  onClose: () => void;
  /** Si se abrió desde un proyecto: la flecha, Cancelar y Guardar vuelven al proyecto */
  back?: { label: string; onClick: () => void };
}) {
  const done = back?.onClick ?? onClose;
  const { me, profiles, clients, projects, recurring, save, remove, toast, byId } = useData();
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
    start_time: null,
    end_time: null,
    ...task,
  });
  const series = task.recurring_id ? recurring.find((r) => r.id === task.recurring_id) : undefined;
  const [repeat, setRepeat] = useState<Recurrence | "">("");
  const [busy, setBusy] = useState(false);
  const editable = isNew || canEditTask(me, task as Task, profiles);
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
      start_time: f.start_time || null,
      end_time: f.end_time || null,
    };
    if (f.start_time && f.end_time && f.end_time <= f.start_time) {
      setBusy(false);
      return toast("La hora de fin tiene que ser después de la de inicio", true);
    }
    if (isNew) row.created_by = me.id;

    // Repetición: se guarda un "molde" y esta tarea queda como la primera ocurrencia
    if (repeat) {
      const first = row.start_date ?? row.due_date ?? todayISO();
      if (!row.start_date) row.start_date = first;
      const { error: rErr, row: tpl } = await save<RecurringTask>("recurring_tasks", {
        title: row.title,
        description: row.description,
        client_id: row.client_id,
        project_id: row.project_id,
        assignee_id: row.assignee_id,
        created_by: me.id,
        priority: row.priority,
        frequency: repeat,
        next_date: nextOccurrence(first, repeat),
        due_offset: row.due_date ? Math.max(0, diffDays(row.due_date, first)) : 0,
        start_time: row.start_time,
        end_time: row.end_time,
      });
      if (rErr || !tpl) {
        setBusy(false);
        return toast(rErr ?? "No se pudo guardar la repetición", true);
      }
      row.recurring_id = tpl.id;
    }

    const { error } = await save<Task>("tasks", row);
    setBusy(false);
    if (error) return toast(error, true);
    toast(repeat ? `Tarea guardada · se repite ${RECURRENCE.find((r) => r.key === repeat)!.every}` : isNew ? "Tarea creada" : "Cambios guardados");
    done();
  }

  async function stopRepeating() {
    if (!series || !confirm("¿Dejar de repetir esta tarea? Las que ya se crearon quedan como están.")) return;
    const { error } = await save<RecurringTask>("recurring_tasks", { id: series.id, active: false });
    toast(error ?? "Listo, no se va a repetir más", !!error);
  }

  async function del() {
    if (!task.id || !confirm(`¿Borrar "${task.title}"? No se puede deshacer.`)) return;
    const err = await remove("tasks", task.id);
    if (err) return toast(err, true);
    toast("Tarea borrada");
    done();
  }

  const creator = task.created_by ? byId.profile.get(task.created_by) : undefined;

  return (
    <SidePanel
      title={isNew ? "Nueva tarea" : editable ? "Editar tarea" : "Detalle de la tarea"}
      onClose={onClose}
      back={back}
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
            <button className="btn" onClick={done}>
              {back ? "Volver" : editable ? "Cancelar" : "Cerrar"}
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
          <select value={f.assignee_id} onChange={(e) => set("assignee_id", e.target.value)} disabled={!editable || assignable.length < 2} title={assignable.length < 2 ? "Solo admins y líderes asignan tareas a otras personas" : undefined}>
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
        <label className="field">
          <span>Horario desde</span>
          <input type="time" value={hhmm(f.start_time)} onChange={(e) => set("start_time", e.target.value || null)} disabled={!editable} step={900} />
        </label>
        <label className="field">
          <span>Hasta</span>
          <input type="time" value={hhmm(f.end_time)} min={hhmm(f.start_time) || undefined} onChange={(e) => set("end_time", e.target.value || null)} disabled={!editable} step={900} />
        </label>
      </div>
      <div className="meta-line" style={{ marginTop: -6 }}>
        El horario es opcional: sirve para ubicar la tarea en el calendario el día que vence{f.due_date ? "" : " (o el de inicio)"}.
      </div>

      {series ? (
        <div className="notice" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>
            🔁 Se repite <b>{RECURRENCE.find((r) => r.key === series.frequency)?.every}</b> · próxima: {fmtShort(series.next_date)}
          </span>
          {editable && (
            <button className="btn sm" onClick={stopRepeating}>
              Dejar de repetir
            </button>
          )}
        </div>
      ) : (
        editable && (
          <label className="field">
            <span>Repetir</span>
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as Recurrence | "")}>
              <option value="">No se repite</option>
              {RECURRENCE.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            {repeat && (
              <span className="meta-line" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
                Se va a crear sola {RECURRENCE.find((r) => r.key === repeat)!.every}, con los mismos datos, a partir del{" "}
                {fmtShort(nextOccurrence(f.start_date || f.due_date || todayISO(), repeat))}.
              </span>
            )}
          </label>
        )
      )}
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
