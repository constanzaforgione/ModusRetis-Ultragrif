"use client";
// Dictar → se interpreta (IA si está configurada, si no el intérprete local) → la persona revisa → se guarda.
// Puede crear tareas y proyectos y cambiar los que ya existen. Se abre desde cualquier pantalla (botón 🎙 arriba)
// y toma como destino lo que esté abierto: el proyecto del panel lateral o el cliente filtrado.
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { Modal, namesOf, PeoplePicker } from "./ui";
import { speechSupported, useSpeech } from "./useSpeech";
import { assignableProfiles, isStaff } from "@/lib/permissions";
import { fmtShort } from "@/lib/dates";
import { taskPeople } from "@/lib/people";
import { PRIORITIES, PRIORITY_LABEL, PROJECT_STATUS_LABEL, STATUS_LABEL, type Project, type Task } from "@/lib/types";
import { interpretLocal } from "@/lib/voice/interpret";
import { buildVoiceContext, sanitizePlan, type VoiceAction, type VoiceContext, type VoicePlan } from "@/lib/voice/plan";

type Scope = VoiceContext["scope"];

// ---------------------------------------------------------------- abrir el dictado desde cualquier lado
const VoiceCtx = createContext<{ open: (scope?: Scope) => void; setScope: (s: Scope | null) => void; scope: Scope | null }>({
  open: () => {},
  setScope: () => {},
  scope: null,
});
export const useVoice = () => useContext(VoiceCtx);

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [openWith, setOpenWith] = useState<Scope | null>(null);
  const open = useCallback((s?: Scope) => setOpenWith(s ?? {}), []);
  const value = useMemo(() => ({ open, setScope, scope }), [open, scope]);
  return (
    <VoiceCtx.Provider value={value}>
      {children}
      {openWith && <VoiceDialog scope={Object.keys(openWith).length ? openWith : (scope ?? {})} onClose={() => setOpenWith(null)} />}
    </VoiceCtx.Provider>
  );
}

// ---------------------------------------------------------------- el diálogo
type Item = VoiceAction & { on: boolean };

export function VoiceDialog({ onClose, scope = {} }: { onClose: () => void; scope?: Scope }) {
  const { me, profiles, clients, projects, tasks, today, save, toast, byId } = useData();
  const [text, setText] = useState("");
  const [stage, setStage] = useState<"dictar" | "pensando" | "revisar" | "confirmar">("dictar");
  const [items, setItems] = useState<Item[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [mode, setMode] = useState<"ai" | "local" | "fallback">("ai");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speech = useSpeech((t) => setText((x) => (x ? `${x} ${t}` : t)));
  const people = assignableProfiles(me, profiles);
  const staff = isStaff(me);
  const supported = speechSupported();
  const scopeProject = scope.project_id ? byId.project.get(scope.project_id) : undefined;
  const scopeClient = scope.client_id ? byId.client.get(scope.client_id) : undefined;

  const ctx = () => buildVoiceContext({ me, profiles, clients, projects, tasks, today, scope });

  function load(plan: VoicePlan) {
    setItems(plan.actions.map((a) => ({ ...a, on: !(a.kind.endsWith("project") && !staff) })));
    setUnmatched(plan.unmatched);
    setStage("revisar");
  }

  async function organize() {
    speech.stop();
    if (!text.trim()) return;
    setStage("pensando");
    setError(null);
    const local = (m: "local" | "fallback") => {
      const c = ctx();
      setMode(m);
      load(sanitizePlan(interpretLocal(text, c), c));
    };
    try {
      const res = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text, scope }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ai === false) return local("local");
      if (!res.ok) {
        if (body.fallback) return local("fallback");
        throw new Error(body.error ?? "Error");
      }
      setMode("ai");
      load(body.plan);
    } catch (e) {
      // Sin conexión con el servidor: igual se puede interpretar acá
      if ((e as Error).message === "Failed to fetch") return local("fallback");
      setError((e as Error).message);
      setStage("dictar");
    }
  }

  const setItem = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? ({ ...x, ...patch } as Item) : x)));
  const setTask = (i: number, patch: Partial<Extract<VoiceAction, { kind: "create_task" }>["task"]>) =>
    setItems((xs) => xs.map((x, j) => (j === i && x.kind === "create_task" ? { ...x, task: { ...x.task, ...patch } } : x)));
  const setProject = (i: number, patch: Partial<Extract<VoiceAction, { kind: "create_project" }>["project"]>) =>
    setItems((xs) => xs.map((x, j) => (j === i && x.kind === "create_project" ? { ...x, project: { ...x.project, ...patch } } : x)));

  const nameOf = (id: string | null | undefined) => (id ? (byId.profile.get(id)?.full_name ?? "—") : "—");
  const clientOf = (id: string | null) => (id ? (byId.client.get(id)?.name ?? "—") : "Interno");
  const newProjects = items.filter((x): x is Item & { kind: "create_project" } => x.kind === "create_project");
  const projectLabel = (id: string | null, ref: string | null) =>
    ref ? `${newProjects.find((p) => p.ref === ref)?.project.name ?? "Proyecto nuevo"} (nuevo)` : id ? (byId.project.get(id)?.name ?? "—") : "Sin proyecto";

  // Qué cambia de verdad en lo que ya existe (antes → después)
  const diffOf = (a: Item): { label: string; from: string; to: string }[] => {
    const out: { label: string; from: string; to: string }[] = [];
    if (a.kind === "update_task") {
      const t = tasks.find((x) => x.id === a.task_id);
      if (!t) return out;
      const c = a.changes;
      if (c.title && c.title !== t.title) out.push({ label: "Título", from: t.title, to: c.title });
      if (c.status && c.status !== t.status) out.push({ label: "Estado", from: STATUS_LABEL[t.status], to: STATUS_LABEL[c.status] });
      if (c.priority && c.priority !== t.priority) out.push({ label: "Prioridad", from: PRIORITY_LABEL[t.priority], to: PRIORITY_LABEL[c.priority] });
      if (c.start_date && c.start_date !== t.start_date) out.push({ label: "Inicio", from: fmtShort(t.start_date), to: fmtShort(c.start_date) });
      if (c.due_date && c.due_date !== t.due_date) out.push({ label: "Vence", from: fmtShort(t.due_date), to: fmtShort(c.due_date) });
      if (c.start_time && c.start_time !== t.start_time) out.push({ label: "Hora", from: t.start_time?.slice(0, 5) ?? "—", to: c.start_time.slice(0, 5) });
      if (c.assignee_ids && c.assignee_ids.join() !== taskPeople(t).join())
        out.push({ label: "Responsables", from: namesOf(taskPeople(t).map((id) => byId.profile.get(id))), to: namesOf(c.assignee_ids.map((id) => byId.profile.get(id))) });
      if (c.project_id && c.project_id !== t.project_id) out.push({ label: "Proyecto", from: projectLabel(t.project_id, null), to: projectLabel(c.project_id, null) });
      if (c.note) out.push({ label: "Nota", from: "", to: c.note });
    } else if (a.kind === "update_project") {
      const p = byId.project.get(a.project_id);
      if (!p) return out;
      const c = a.changes;
      if (c.name && c.name !== p.name) out.push({ label: "Nombre", from: p.name, to: c.name });
      if (c.status && c.status !== p.status) out.push({ label: "Estado", from: PROJECT_STATUS_LABEL[p.status], to: PROJECT_STATUS_LABEL[c.status] });
      if (c.start_date && c.start_date !== p.start_date) out.push({ label: "Inicio", from: fmtShort(p.start_date), to: fmtShort(c.start_date) });
      if (c.end_date && c.end_date !== p.end_date) out.push({ label: "Fin", from: fmtShort(p.end_date), to: fmtShort(c.end_date) });
    }
    return out;
  };
  const real = items.map((a, i) => ({ a, i })).filter(({ a }) => (a.kind.startsWith("update") ? diffOf(a).length > 0 : true));
  const chosen = real.filter(({ a }) => a.on && (a.kind !== "create_task" || a.task.title.trim()) && (a.kind !== "create_project" || a.project.name.trim()));
  const missingClient = chosen.some(({ a }) => a.kind === "create_project" && !a.project.client_id);
  const count = chosen.length;

  async function commit() {
    setBusy(true);
    let ok = 0;
    const errors: string[] = [];
    const done = (i: number) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, on: false } : x)));
    const refs = new Map<string, string>();
    // Primero los proyectos nuevos, así sus tareas ya tienen dónde ir
    for (const { a, i } of chosen) {
      if (a.kind !== "create_project") continue;
      const p = a.project;
      const { error, row } = await save<Project>("projects", {
        client_id: p.client_id!,
        name: p.name.trim(),
        description: p.description,
        status: p.start_date > today ? "planificado" : "en_curso",
        start_date: p.start_date,
        end_date: p.end_date,
        progress: 0,
        owner_id: p.owner_ids[0] ?? null,
        owner_ids: p.owner_ids,
        created_by: me.id,
      } as Partial<Project>);
      if (error || !row) errors.push(`${p.name}: ${error}`);
      else {
        refs.set(a.ref, row.id);
        ok++;
        done(i);
      }
    }
    for (const { a, i } of chosen) {
      if (a.kind === "create_task") {
        const t = a.task;
        const project_id = t.project_ref ? refs.get(t.project_ref) : t.project_id;
        if (t.project_ref && !project_id) {
          errors.push(`${t.title}: no se creó su proyecto`);
          continue;
        }
        const ids = t.assignee_ids.length ? t.assignee_ids : [me.id];
        const { error } = await save<Task>("tasks", {
          title: t.title.trim(),
          description: t.description,
          priority: t.priority,
          assignee_id: ids[0],
          assignee_ids: ids,
          client_id: t.client_id,
          project_id: project_id ?? null,
          start_date: t.start_date,
          due_date: t.due_date,
          start_time: t.start_time,
          created_by: me.id,
        });
        if (error) errors.push(`${t.title}: ${error}`);
        else (ok++, done(i));
      } else if (a.kind === "update_task") {
        const t = tasks.find((x) => x.id === a.task_id);
        if (!t) continue;
        const c = a.changes;
        const patch: Partial<Task> = { id: t.id };
        if (c.title) patch.title = c.title;
        if (c.status) patch.status = c.status;
        if (c.priority) patch.priority = c.priority;
        if (c.start_date) patch.start_date = c.start_date;
        if (c.due_date) patch.due_date = c.due_date;
        if (c.start_time) patch.start_time = c.start_time;
        if (c.assignee_ids?.length) Object.assign(patch, { assignee_id: c.assignee_ids[0], assignee_ids: c.assignee_ids });
        if (c.project_id) Object.assign(patch, { project_id: c.project_id, client_id: byId.project.get(c.project_id)?.client_id ?? t.client_id });
        if (c.note) patch.description = t.description ? `${t.description}\n\n${c.note}` : c.note;
        const { error } = await save<Task>("tasks", patch);
        if (error) errors.push(`${t.title}: ${error}`);
        else (ok++, done(i));
      } else if (a.kind === "update_project") {
        const p = byId.project.get(a.project_id);
        const { error } = await save<Project>("projects", { id: a.project_id, ...a.changes });
        if (error) errors.push(`${p?.name ?? "Proyecto"}: ${error}`);
        else (ok++, done(i));
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

  const where = scopeProject ? `en ${scopeProject.name}` : scopeClient ? `para ${scopeClient.name}` : "";
  const projectOptions = (clientId: string | null, current: string | null) =>
    projects.filter((p) => (p.status !== "completado" && (!clientId || p.client_id === clientId)) || p.id === current);

  const summary = (a: Item) => {
    if (a.kind === "create_task")
      return (
        <>
          <b>{a.task.title.trim()}</b>
          <div className="meta-line">
            {namesOf(a.task.assignee_ids.map((id) => byId.profile.get(id)))} · {clientOf(a.task.client_id)} · {projectLabel(a.task.project_id, a.task.project_ref)} ·{" "}
            {PRIORITY_LABEL[a.task.priority]} · {a.task.due_date ? `vence ${fmtShort(a.task.due_date)}` : "sin fecha"}
          </div>
        </>
      );
    if (a.kind === "create_project")
      return (
        <>
          <b>{a.project.name.trim()}</b>
          <div className="meta-line">
            {clientOf(a.project.client_id)} · {fmtShort(a.project.start_date)} a {fmtShort(a.project.end_date)}
          </div>
        </>
      );
    const title = a.kind === "update_task" ? tasks.find((x) => x.id === a.task_id)?.title : byId.project.get(a.project_id)?.name;
    return (
      <>
        <b>{title}</b>
        {diffOf(a).map((c) => (
          <div key={c.label} className="diff">
            {c.label}: {c.from && <s>{c.from}</s>} {c.from && "→"} <b>{c.to}</b>
          </div>
        ))}
      </>
    );
  };
  const PILL: Record<VoiceAction["kind"], [string, string]> = {
    create_task: ["s-pendiente", "Tarea nueva"],
    create_project: ["s-en_revision", "Proyecto nuevo"],
    update_task: ["s-en_curso", "Cambio"],
    update_project: ["s-en_curso", "Cambio en proyecto"],
  };

  return (
    <Modal
      title={`Dictar${where ? ` ${where}` : ""}`}
      onClose={onClose}
      footer={
        stage === "revisar" ? (
          <>
            <button className="btn" onClick={() => setStage("dictar")}>
              ← Volver al dictado
            </button>
            <button className="btn primary" onClick={() => setStage("confirmar")} disabled={!count || missingClient}>
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
              {stage === "pensando" ? "Interpretando…" : "Interpretar →"}
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
          <ul className="confirm-list">
            {chosen.map(({ a, i }) => (
              <li key={i}>
                <span className={`pill ${PILL[a.kind][0]}`}>{PILL[a.kind][1]}</span>
                <div>{summary(a)}</div>
              </li>
            ))}
          </ul>
          <div className="meta-line">Nada más se modifica: no se borra nada ni se tocan otras tareas.</div>
        </>
      ) : stage !== "revisar" ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Decilo como se lo dirías a alguien del equipo: tareas nuevas, cambios, proyectos. Por ejemplo:{" "}
            <i>
              {scopeProject
                ? `“Agregá tres tareas: relevar el sitio, armar el wireframe para el viernes y presentarlo al cliente, que lo haga Yani. Y extendé el proyecto dos semanas.”`
                : `“En el proyecto Dashboards Meli agregá revisar las métricas para el viernes, es urgente. La del kit de publicaciones marcala como hecha. Creá un proyecto Rediseño web para Ultragrif de noviembre a enero.”`}
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
          <div className="notice">
            {mode === "ai"
              ? "Esto es lo que entendimos. Destildá lo que no querés y corregí lo que haga falta; en el paso siguiente confirmás."
              : mode === "fallback"
                ? "El asistente de IA no respondió, así que lo interpretamos acá con reglas simples. Revisá bien cada cosa."
                : "Lo interpretamos con el intérprete básico (sin IA). Revisá cada cosa y corregí lo que haga falta antes de confirmar."}
          </div>
          {real.map(({ a, i }) => {
            if (a.kind === "create_task") {
              const t = a.task;
              const projValue = t.project_ref ? `ref:${t.project_ref}` : (t.project_id ?? "");
              return (
                <div key={i} className={`draft ${a.on ? "" : "off"}`}>
                  <div className="draft-h">
                    <input type="checkbox" checked={a.on} onChange={(e) => setItem(i, { on: e.target.checked })} aria-label="Incluir" />
                    <span className={`pill ${PILL[a.kind][0]}`}>Tarea</span>
                    <input type="text" value={t.title} onChange={(e) => setTask(i, { title: e.target.value })} />
                  </div>
                  {t.description && <textarea rows={2} value={t.description} onChange={(e) => setTask(i, { description: e.target.value })} style={{ minHeight: 0 }} />}
                  <PeoplePicker value={t.assignee_ids} onChange={(ids) => setTask(i, { assignee_ids: ids })} options={people} all={byId.profile} />
                  <div className="grid4">
                    <select value={t.client_id ?? ""} onChange={(e) => setTask(i, { client_id: e.target.value || null, project_id: null, project_ref: null })} aria-label="Cliente">
                      <option value="">Interno</option>
                      {clients
                        .filter((c) => c.active || c.id === t.client_id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                    <select
                      value={projValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v.startsWith("ref:")) {
                          const np = newProjects.find((p) => p.ref === v.slice(4));
                          setTask(i, { project_ref: v.slice(4), project_id: null, client_id: np?.project.client_id ?? t.client_id });
                        } else setTask(i, { project_id: v || null, project_ref: null, client_id: v ? (byId.project.get(v)?.client_id ?? t.client_id) : t.client_id });
                      }}
                      aria-label="Proyecto"
                    >
                      <option value="">Sin proyecto</option>
                      {newProjects.map((p) => (
                        <option key={p.ref} value={`ref:${p.ref}`}>
                          ✦ {p.project.name} (nuevo)
                        </option>
                      ))}
                      {projectOptions(t.client_id, t.project_id).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select value={t.priority} onChange={(e) => setTask(i, { priority: e.target.value as Task["priority"] })} aria-label="Prioridad">
                      {PRIORITIES.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <input type="date" value={t.due_date ?? ""} onChange={(e) => setTask(i, { due_date: e.target.value || null })} aria-label="Vence" />
                  </div>
                  {a.warning && <div className="meta-line warn">⚠ {a.warning}</div>}
                </div>
              );
            }
            if (a.kind === "create_project") {
              const p = a.project;
              return (
                <div key={i} className={`draft ${a.on ? "" : "off"}`}>
                  <div className="draft-h">
                    <input type="checkbox" checked={a.on} disabled={!staff} onChange={(e) => setItem(i, { on: e.target.checked })} aria-label="Incluir" />
                    <span className={`pill ${PILL[a.kind][0]}`}>Proyecto</span>
                    <input type="text" value={p.name} onChange={(e) => setProject(i, { name: e.target.value })} disabled={!staff} />
                  </div>
                  <div className="grid4">
                    <select value={p.client_id ?? ""} onChange={(e) => setProject(i, { client_id: e.target.value || null })} aria-label="Cliente" disabled={!staff}>
                      <option value="">Elegí el cliente…</option>
                      {clients
                        .filter((c) => c.active)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                    <input type="date" value={p.start_date} onChange={(e) => e.target.value && setProject(i, { start_date: e.target.value })} aria-label="Inicio" disabled={!staff} />
                    <input type="date" value={p.end_date} min={p.start_date} onChange={(e) => e.target.value && setProject(i, { end_date: e.target.value })} aria-label="Fin" disabled={!staff} />
                  </div>
                  {(a.warning || (a.on && !p.client_id)) && <div className="meta-line warn">⚠ {a.warning ?? "Elegí el cliente del proyecto."}</div>}
                </div>
              );
            }
            return (
              <label key={i} className={`draft ${a.on ? "" : "off"}`} style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <input type="checkbox" checked={a.on} disabled={a.kind === "update_project" && !staff} onChange={(e) => setItem(i, { on: e.target.checked })} />
                <div style={{ minWidth: 0 }}>
                  <span className={`pill ${PILL[a.kind][0]}`}>{PILL[a.kind][1]}</span> {summary(a)}
                  {a.warning && <div className="meta-line warn">⚠ {a.warning}</div>}
                </div>
              </label>
            );
          })}
          {unmatched.length > 0 && (
            <div className="meta-line">
              No entendimos: {unmatched.map((u) => `“${u}”`).join(" · ")}. Volvé al dictado y decilo de otra forma, o cargalo a mano.
            </div>
          )}
          {!real.length && <div className="empty">No encontramos nada para hacer en el dictado. Volvé y probá con más detalle.</div>}
        </>
      )}
      {(error || speech.error) && <div className="notice err">{error || speech.error}</div>}
    </Modal>
  );
}
