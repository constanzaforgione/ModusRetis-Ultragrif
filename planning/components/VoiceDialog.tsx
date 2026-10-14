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
  const [stage, setStage] = useState<"dictar" | "pensando" | "revisar" | "confirmar">("dictar");
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
    for (const d of chosenDrafts) {
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
      else {
        ok++;
        // Lo que ya se guardó sale de la lista, así un reintento no lo duplica
        setDrafts((ds) => ds.map((x) => (x === d ? { ...x, on: false } : x)));
      }
    }
    for (const u of chosenUpdates) {
      const patch: Partial<Task> = { id: u.task_id };
      if (u.status) patch.status = u.status;
      if (u.priority) patch.priority = u.priority;
      if (u.start_date) patch.start_date = u.start_date;
      if (u.due_date) patch.due_date = u.due_date;
      const { error } = await save<Task>("tasks", patch);
      if (error) errors.push(error);
      else {
        ok++;
        setUpdates((us) => us.map((x) => (x.task_id === u.task_id ? { ...x, on: false } : x)));
      }
    }
    setBusy(false);
    if (errors.length) {
      setError(`${ok ? `Se aplicaron ${ok}. ` : ""}No se pudo: ${errors.join(" · ")}`);
      if (ok) toast(`${ok} ${ok === 1 ? "cambio aplicado" : "cambios aplicados"}, ${errors.length} con error`, true);
      return;
    }
    toast(ok === 1 ? "Listo, 1 cambio guardado" : `Listo, ${ok} cambios guardados`);
    onClose();
  }

  const setD = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  // Qué cambia de verdad en cada tarea existente (antes → después); lo que ya tenía ese valor no cuenta
  const diffOf = (u: Update) => {
    const t = tasks.find((x) => x.id === u.task_id);
    if (!t) return [];
    const out: { label: string; from: string; to: string }[] = [];
    if (u.status && u.status !== t.status) out.push({ label: "Estado", from: STATUS_LABEL[t.status], to: STATUS_LABEL[u.status] });
    if (u.priority && u.priority !== t.priority) out.push({ label: "Prioridad", from: PRIORITY_LABEL[t.priority], to: PRIORITY_LABEL[u.priority] });
    if (u.start_date && u.start_date !== t.start_date) out.push({ label: "Inicio", from: fmtShort(t.start_date), to: fmtShort(u.start_date) });
    if (u.due_date && u.due_date !== t.due_date) out.push({ label: "Vence", from: fmtShort(t.due_date), to: fmtShort(u.due_date) });
    return out;
  };
  const realUpdates = updates.filter((u) => diffOf(u).length > 0);
  const chosenDrafts = drafts.filter((d) => d.on && d.title.trim());
  const chosenUpdates = realUpdates.filter((u) => u.on);
  const count = chosenDrafts.length + chosenUpdates.length;
  const nameOf = (id: string | null | undefined) => (id ? profiles.find((p) => p.id === id)?.full_name ?? "—" : "—");
  const clientOf = (id: string | null) => (id ? clients.find((c) => c.id === id)?.name ?? "—" : "Interno");

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
            <button className="btn primary" onClick={() => setStage("confirmar")} disabled={!count}>
              Revisar {count} {count === 1 ? "cambio" : "cambios"} →
            </button>
          </>
        ) : stage === "confirmar" ? (
          <>
            <button className="btn" onClick={() => setStage("revisar")} disabled={busy}>
              ← Corregir
            </button>
            <button className="btn primary" onClick={commit} disabled={busy || !count}>
              {busy ? "Aplicando…" : `Sí, aplicar ${count} ${count === 1 ? "cambio" : "cambios"}`}
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
      {stage === "confirmar" ? (
        <>
          <div className="notice">
            <b>Todavía no se guardó nada.</b> Esto es exactamente lo que se va a aplicar. Si algo no está bien, tocá “Corregir”.
          </div>
          {chosenDrafts.length > 0 && (
            <div className="field">
              <span>
                Se {chosenDrafts.length === 1 ? "va a crear 1 tarea" : `van a crear ${chosenDrafts.length} tareas`}
              </span>
              <ul className="confirm-list">
                {chosenDrafts.map((d, i) => (
                  <li key={i}>
                    <span className="pill s-pendiente">Nueva</span>
                    <div>
                      <b>{d.title.trim()}</b>
                      <div className="meta-line">
                        {nameOf(d.assignee_id)}
                        {d.assignee_id !== me.id ? " (no sos vos)" : ""} · {clientOf(d.client_id)} · {PRIORITY_LABEL[d.priority]} ·{" "}
                        {d.due_date ? `vence ${fmtShort(d.due_date)}` : "sin fecha"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {chosenUpdates.length > 0 && (
            <div className="field">
              <span>
                Se {chosenUpdates.length === 1 ? "va a modificar 1 tarea" : `van a modificar ${chosenUpdates.length} tareas`}
              </span>
              <ul className="confirm-list">
                {chosenUpdates.map((u) => {
                  const t = tasks.find((x) => x.id === u.task_id);
                  return (
                    <li key={u.task_id}>
                      <span className="pill s-en_curso">Cambio</span>
                      <div>
                        <b>{t?.title}</b>
                        {t && t.assignee_id !== me.id && <div className="meta-line">Tarea de {nameOf(t.assignee_id)}</div>}
                        {diffOf(u).map((c) => (
                          <div key={c.label} className="diff">
                            {c.label}: <s>{c.from}</s> → <b>{c.to}</b>
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="meta-line">Nada más se modifica: no se borra ninguna tarea ni se tocan otras.</div>
        </>
      ) : stage !== "revisar" ? (
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
          {aiOff ? (
            <div className="notice">El asistente de IA no está configurado: se cargó todo como una sola tarea. Completá los datos y seguí.</div>
          ) : (
            <div className="notice">Esto es lo que entendimos. Destildá lo que no querés y corregí lo que haga falta; en el paso siguiente confirmás.</div>
          )}
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
          {realUpdates.length > 0 && <div className="lbl">Cambios en tareas existentes</div>}
          {realUpdates.map((u) => {
            const t = tasks.find((x) => x.id === u.task_id);
            return (
              <label key={u.task_id} className={`draft ${u.on ? "" : "off"}`} style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={u.on}
                  onChange={(e) => setUpdates((us) => us.map((x) => (x.task_id === u.task_id ? { ...x, on: e.target.checked } : x)))}
                />
                <div>
                  <b>{t?.title ?? "Tarea"}</b>
                  {diffOf(u).map((c) => (
                    <div key={c.label} className="diff">
                      {c.label}: <s>{c.from}</s> → <b>{c.to}</b>
                    </div>
                  ))}
                </div>
              </label>
            );
          })}
          {!drafts.length && !realUpdates.length && <div className="empty">No encontramos tareas en el dictado. Volvé y probá con más detalle.</div>}
        </>
      )}
      {(error || speech.error) && <div className="notice err">{error || speech.error}</div>}
    </Modal>
  );
}
