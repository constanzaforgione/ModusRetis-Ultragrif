"use client";
// Dictar → el asistente arma borradores → la persona revisa → se guardan.
import { useState } from "react";
import { useData } from "./DataProvider";
import { Modal } from "./ui";
import { speechSupported, useSpeech } from "./useSpeech";
import { assignableProfiles } from "@/lib/permissions";
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, type Priority, type Task, type TaskStatus } from "@/lib/types";
import { fmtShort } from "@/lib/dates";

interface Draft {
  on: boolean;
  title: string;
  description: string;
  priority: Priority;
  assignee_id: string;
  client_id: string | null;
  start_date: string | null;
  due_date: string | null;
}
interface Update {
  on: boolean;
  task_id: string;
  status: TaskStatus | null;
  priority: Priority | null;
  start_date: string | null;
  due_date: string | null;
  summary: string;
}

export function VoiceDialog({ onClose }: { onClose: () => void }) {
  const { me, profiles, clients, tasks, save, toast } = useData();
  const [text, setText] = useState("");
  const [stage, setStage] = useState<"dictar" | "pensando" | "revisar">("dictar");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [aiOff, setAiOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speech = useSpeech((t) => setText((x) => (x ? `${x} ${t}` : t)));
  const people = assignableProfiles(me, profiles);
  const supported = speechSupported();

  async function organize() {
    speech.stop();
    if (!text.trim()) return;
    setStage("pensando");
    setError(null);
    try {
      const res = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error");
      setAiOff(!body.ai);
      setDrafts(
        body.plan.tasks.map((t: Omit<Draft, "on" | "assignee_id"> & { assignee_id: string | null }) => ({
          ...t,
          on: true,
          assignee_id: t.assignee_id ?? me.id,
        })),
      );
      setUpdates(body.plan.updates.map((u: Omit<Update, "on">) => ({ ...u, on: true })));
      setStage("revisar");
    } catch (e) {
      setError((e as Error).message);
      setStage("dictar");
    }
  }

  async function commit() {
    setBusy(true);
    let ok = 0;
    const errors: string[] = [];
    for (const d of drafts.filter((d) => d.on && d.title.trim())) {
      const { error } = await save<Task>("tasks", {
        title: d.title.trim(),
        description: d.description,
        priority: d.priority,
        assignee_id: d.assignee_id,
        client_id: d.client_id,
        start_date: d.start_date,
        due_date: d.due_date,
        created_by: me.id,
      });
      if (error) errors.push(`${d.title}: ${error}`);
      else ok++;
    }
    for (const u of updates.filter((u) => u.on)) {
      const patch: Partial<Task> = { id: u.task_id };
      if (u.status) patch.status = u.status;
      if (u.priority) patch.priority = u.priority;
      if (u.start_date) patch.start_date = u.start_date;
      if (u.due_date) patch.due_date = u.due_date;
      const { error } = await save<Task>("tasks", patch);
      if (error) errors.push(error);
      else ok++;
    }
    setBusy(false);
    if (errors.length) {
      setError(errors.join(" · "));
      if (ok) toast(`${ok} cambios guardados, ${errors.length} con error`, true);
      return;
    }
    toast(ok === 1 ? "Listo, 1 cambio guardado" : `Listo, ${ok} cambios guardados`);
    onClose();
  }

  const setD = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const count = drafts.filter((d) => d.on).length + updates.filter((u) => u.on).length;

  return (
    <Modal
      title="Dictar tareas"
      onClose={onClose}
      footer={
        stage === "revisar" ? (
          <>
            <button className="btn" onClick={() => setStage("dictar")}>
              ← Volver al dictado
            </button>
            <button className="btn primary" onClick={commit} disabled={busy || !count}>
              {busy ? "Guardando…" : `Guardar ${count} ${count === 1 ? "cambio" : "cambios"}`}
            </button>
          </>
        ) : (
          <>
            <button className={`btn ${speech.listening ? "rec" : "cyan"}`} onClick={speech.toggle} disabled={!supported || stage === "pensando"}>
              {speech.listening ? "■ Parar" : "🎙 Hablar"}
            </button>
            <button className="btn primary" onClick={organize} disabled={!text.trim() || stage === "pensando"}>
              {stage === "pensando" ? "Organizando…" : "Organizar en tareas →"}
            </button>
          </>
        )
      }
    >
      {stage !== "revisar" ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Contá lo que tenés que hacer, como se lo dirías a alguien del equipo. Por ejemplo:{" "}
            <i>
              “Para el viernes tengo que mandarle a Ultragrif el kit de publicaciones, es urgente. Y la semana que viene revisar el plan de Ads de
              Placebo. La tarea del catálogo de Meli pasala a en curso.”
            </i>
          </p>
          {!supported && <div className="notice">Tu navegador no tiene dictado por voz (probá Chrome o Edge). Igual podés escribir o pegar el texto acá.</div>}
          <textarea
            className="transcript"
            value={text + (speech.interim ? ` ${speech.interim}` : "")}
            onChange={(e) => setText(e.target.value)}
            placeholder={supported ? "Tocá “Hablar” y empezá a dictar…" : "Escribí acá…"}
            readOnly={speech.listening}
          />
        </>
      ) : (
        <>
          {aiOff && <div className="notice">El asistente de IA no está configurado: se cargó todo como una sola tarea. Podés editarla antes de guardar.</div>}
          {drafts.length > 0 && <div className="lbl">Tareas nuevas</div>}
          {drafts.map((d, i) => (
            <div key={i} className={`draft ${d.on ? "" : "off"}`}>
              <div className="draft-h">
                <input type="checkbox" checked={d.on} onChange={(e) => setD(i, { on: e.target.checked })} aria-label="Incluir" />
                <input type="text" value={d.title} onChange={(e) => setD(i, { title: e.target.value })} />
              </div>
              {d.description && <textarea rows={2} value={d.description} onChange={(e) => setD(i, { description: e.target.value })} style={{ minHeight: 0 }} />}
              <div className="grid4">
                <select value={d.assignee_id} onChange={(e) => setD(i, { assignee_id: e.target.value })} aria-label="Responsable">
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                      {p.id === me.id ? " (yo)" : ""}
                    </option>
                  ))}
                </select>
                <select value={d.client_id ?? ""} onChange={(e) => setD(i, { client_id: e.target.value || null })} aria-label="Cliente">
                  <option value="">Interno</option>
                  {clients
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <select value={d.priority} onChange={(e) => setD(i, { priority: e.target.value as Priority })} aria-label="Prioridad">
                  {PRIORITIES.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input type="date" value={d.due_date ?? ""} onChange={(e) => setD(i, { due_date: e.target.value || null })} aria-label="Vence" />
              </div>
            </div>
          ))}
          {updates.length > 0 && <div className="lbl">Cambios en tareas existentes</div>}
          {updates.map((u, i) => {
            const t = tasks.find((x) => x.id === u.task_id);
            return (
              <label key={u.task_id} className={`draft ${u.on ? "" : "off"}`} style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <input type="checkbox" checked={u.on} onChange={(e) => setUpdates((us) => us.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                <div>
                  <b>{t?.title ?? "Tarea"}</b>
                  <div className="meta-line">
                    {[
                      u.status && `estado → ${STATUS_LABEL[u.status]}`,
                      u.priority && `prioridad → ${PRIORITY_LABEL[u.priority]}`,
                      u.start_date && `inicio → ${fmtShort(u.start_date)}`,
                      u.due_date && `vence → ${fmtShort(u.due_date)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || u.summary}
                  </div>
                </div>
              </label>
            );
          })}
          {!drafts.length && !updates.length && <div className="empty">No encontramos tareas en el dictado. Volvé y probá con más detalle.</div>}
        </>
      )}
      {(error || speech.error) && <div className="notice err">{error || speech.error}</div>}
    </Modal>
  );
}
