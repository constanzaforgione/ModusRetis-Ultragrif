"use client";
// Pop-up con los puntos de acción de las reuniones "MR" de Granola: se elige cuáles importar como tareas,
// con sus fechas, prioridad, cliente, proyecto (o uno nuevo) y responsables. Lo que no se tilda no se importa.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { Modal, PeoplePicker } from "./ui";
import { assignableProfiles, isStaff } from "@/lib/permissions";
import { addMonths, fmtShort } from "@/lib/dates";
import { PRIORITIES, type Project, type Task } from "@/lib/types";
import type { MeetingItem } from "@/lib/granola";

export interface PendingMeeting {
  meeting_id: string;
  title: string;
  meeting_date: string | null;
  url: string;
  items: MeetingItem[];
}

type Row = MeetingItem & { on: boolean; newName: string; useNew: boolean };
const NEW = "__nuevo__";

export function MeetingImportDialog({ meetings, ai, onClose }: { meetings: PendingMeeting[]; ai: boolean; onClose: () => void }) {
  const { me, profiles, clients, projects, today, save, toast, byId } = useData();
  const staff = isStaff(me);
  const people = assignableProfiles(me, profiles);
  const [rows, setRows] = useState<Row[]>(() =>
    meetings.flatMap((m) =>
      m.items.map((it) => ({ ...it, on: true, newName: it.new_project ?? "", useNew: !!it.new_project && !it.project_id && staff })),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const chosen = rows.filter((r) => r.on && r.title.trim());
  const missingClient = chosen.some((r) => r.useNew && (!r.client_id || !r.newName.trim()));
  const activeProjects = useMemo(() => projects.filter((p) => p.status !== "completado"), [projects]);

  async function importAll() {
    setBusy(true);
    setError(null);
    const errors: string[] = [];
    const created = new Map<string, string>(); // "cliente|nombre" → id del proyecto nuevo
    const imported = new Map<string, number>();
    for (const r of chosen) {
      let projectId = r.useNew ? null : r.project_id;
      if (r.useNew) {
        const k = `${r.client_id}|${r.newName.trim().toLowerCase()}`;
        projectId = created.get(k) ?? null;
        if (!projectId) {
          const start = r.start_date ?? today;
          const end = r.due_date && r.due_date > start ? r.due_date : addMonths(start, 1);
          const { error, row } = await save<Project>("projects", {
            client_id: r.client_id!,
            name: r.newName.trim(),
            description: "",
            status: start > today ? "planificado" : "en_curso",
            start_date: start,
            end_date: end,
            progress: 0,
            owner_id: r.assignee_ids[0] ?? me.id,
            owner_ids: r.assignee_ids.length ? r.assignee_ids : [me.id],
            created_by: me.id,
          } as Partial<Project>);
          if (error || !row) {
            errors.push(`${r.newName}: ${error}`);
            continue;
          }
          projectId = row.id;
          created.set(k, row.id);
        }
      }
      const ids = r.assignee_ids.length ? r.assignee_ids : [me.id];
      const { error } = await save<Task>("tasks", {
        title: r.title.trim(),
        description: r.description,
        priority: r.priority,
        assignee_id: ids[0],
        assignee_ids: ids,
        client_id: r.client_id,
        project_id: projectId,
        start_date: r.start_date,
        due_date: r.due_date,
        created_by: me.id,
      });
      if (error) errors.push(`${r.title}: ${error}`);
      else {
        imported.set(r.meeting_id, (imported.get(r.meeting_id) ?? 0) + 1);
        set(r.key, { on: false });
      }
    }
    if (errors.length) {
      setBusy(false);
      setError(`No se pudo: ${errors.join(" · ")}`);
      return;
    }
    // Las reuniones de este pop-up quedan revisadas (lo destildado no se vuelve a ofrecer)
    await fetch("/api/reuniones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewed: meetings.map((m) => ({ meeting_id: m.meeting_id, imported: imported.get(m.meeting_id) ?? 0 })) }),
    }).catch(() => {});
    setBusy(false);
    const n = [...imported.values()].reduce((a, b) => a + b, 0);
    toast(n ? `Listo: ${n} ${n === 1 ? "tarea importada" : "tareas importadas"} de Granola` : "Reuniones marcadas como revisadas");
    onClose();
  }

  return (
    <Modal
      title={`Tareas de tus reuniones (${meetings.length})`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy} title="Se vuelven a mostrar la próxima vez">
            Más tarde
          </button>
          <button className="btn primary" onClick={importAll} disabled={busy || missingClient}>
            {busy ? "Importando…" : chosen.length ? `Importar ${chosen.length} ${chosen.length === 1 ? "tarea" : "tareas"}` : "No importar ninguna"}
          </button>
        </>
      }
    >
      <div className="notice">
        {ai ? "Encontramos estos puntos de acción en tus reuniones MR de Granola." : "Encontramos estos puntos de acción en las secciones de próximos pasos y pendientes de tus reuniones MR (sin IA: revisá bien cada uno)."}{" "}
        Tildá los que querés importar y ajustá lo que haga falta.
      </div>
      {meetings.map((m) => {
        const list = rows.filter((r) => r.meeting_id === m.meeting_id);
        const allOn = list.every((r) => r.on);
        return (
          <section key={m.meeting_id} className="mtg">
            <div className="mtg-h">
              <label className="toggle">
                <input type="checkbox" checked={allOn} onChange={(e) => list.forEach((r) => set(r.key, { on: e.target.checked }))} />
                <b>{m.title}</b>
              </label>
              <span className="muted">
                {fmtShort(m.meeting_date)} ·{" "}
                <a href={m.url} target="_blank" rel="noreferrer">
                  ver en Granola ↗
                </a>
              </span>
            </div>
            {list.map((r) => (
              <div key={r.key} className={`draft ${r.on ? "" : "off"}`}>
                <div className="draft-h">
                  <input type="checkbox" checked={r.on} onChange={(e) => set(r.key, { on: e.target.checked })} aria-label="Importar" />
                  <input type="text" value={r.title} onChange={(e) => set(r.key, { title: e.target.value })} aria-label="Nombre" />
                </div>
                <textarea rows={2} value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} aria-label="Descripción" style={{ minHeight: 0 }} />
                <div className="grid4">
                  <label className="mini-field">
                    <span>Inicio</span>
                    <input type="date" value={r.start_date ?? ""} onChange={(e) => set(r.key, { start_date: e.target.value || null })} />
                  </label>
                  <label className="mini-field">
                    <span>Fin</span>
                    <input type="date" value={r.due_date ?? ""} min={r.start_date ?? undefined} onChange={(e) => set(r.key, { due_date: e.target.value || null })} />
                  </label>
                  <label className="mini-field">
                    <span>Prioridad</span>
                    <select value={r.priority} onChange={(e) => set(r.key, { priority: e.target.value as Row["priority"] })}>
                      {PRIORITIES.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mini-field">
                    <span>Cliente</span>
                    <select value={r.client_id ?? ""} onChange={(e) => set(r.key, { client_id: e.target.value || null, project_id: null })}>
                      <option value="">Interno</option>
                      {clients
                        .filter((c) => c.active || c.id === r.client_id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="mtg-proj">
                  <label className="mini-field">
                    <span>Proyecto</span>
                    <select
                      value={r.useNew ? NEW : (r.project_id ?? "")}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === NEW) set(r.key, { useNew: true, project_id: null, newName: r.newName || r.title });
                        else set(r.key, { useNew: false, project_id: v || null, client_id: v ? (byId.project.get(v)?.client_id ?? r.client_id) : r.client_id });
                      }}
                    >
                      <option value="">Sin proyecto</option>
                      {activeProjects
                        .filter((p) => !r.client_id || p.client_id === r.client_id || p.id === r.project_id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {!r.client_id ? ` · ${byId.client.get(p.client_id)?.name ?? ""}` : ""}
                          </option>
                        ))}
                      {staff && <option value={NEW}>＋ Crear proyecto nuevo…</option>}
                    </select>
                  </label>
                  {r.useNew && (
                    <label className="mini-field">
                      <span>Nombre del proyecto nuevo</span>
                      <input type="text" value={r.newName} onChange={(e) => set(r.key, { newName: e.target.value })} placeholder="Ej: Catálogo EuroSteel" />
                    </label>
                  )}
                </div>
                {r.useNew && r.on && !r.client_id && <div className="meta-line warn">⚠ Elegí el cliente del proyecto nuevo.</div>}
                <PeoplePicker value={r.assignee_ids} onChange={(ids) => set(r.key, { assignee_ids: ids })} options={people} all={byId.profile} />
              </div>
            ))}
          </section>
        );
      })}
      {error && <div className="notice err">{error}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- se revisa solo al entrar a la app
const MeetingsCtx = createContext<{ enabled: boolean; checking: boolean; check: () => void }>({ enabled: false, checking: false, check: () => {} });
export const useMeetings = () => useContext(MeetingsCtx);

export function MeetingsProvider({ children }: { children: React.ReactNode }) {
  const { me, toast } = useData();
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<{ meetings: PendingMeeting[]; ai: boolean } | null>(null);

  const run = useCallback(
    async (manual: boolean) => {
      setChecking(true);
      try {
        const res = await fetch("/api/reuniones");
        const body = await res.json().catch(() => ({}));
        if (res.status === 503 || res.status === 403) {
          setEnabled(false);
          if (manual) toast(body.error === "missing_config" ? "Falta conectar Granola (GRANOLA_API_KEY en Vercel)" : "Las reuniones de Granola no están habilitadas para tu usuario", true);
          return;
        }
        setEnabled(res.ok);
        if (!res.ok) {
          if (manual) toast(body.error ?? "No se pudo leer Granola", true);
          return;
        }
        if (body.error && manual) toast(`Granola: ${body.error}`, true);
        if (body.meetings?.length) setFound({ meetings: body.meetings, ai: body.ai });
        else if (manual) toast("No hay reuniones MR nuevas para revisar");
      } catch {
        if (manual) toast("No se pudo conectar con el servidor", true);
      } finally {
        setChecking(false);
      }
    },
    [toast],
  );

  // Una vez por sesión del navegador
  useEffect(() => {
    const k = `mr-reuniones-${me.id}`;
    try {
      if (sessionStorage.getItem(k)) {
        setEnabled(sessionStorage.getItem(k) === "on");
        return;
      }
    } catch {}
    run(false).finally(() => {
      try {
        sessionStorage.setItem(k, "checked");
      } catch {}
    });
  }, [me.id, run]);
  useEffect(() => {
    try {
      if (enabled) sessionStorage.setItem(`mr-reuniones-${me.id}`, "on");
    } catch {}
  }, [enabled, me.id]);

  const value = useMemo(() => ({ enabled, checking, check: () => run(true) }), [enabled, checking, run]);
  return (
    <MeetingsCtx.Provider value={value}>
      {children}
      {found && <MeetingImportDialog meetings={found.meetings} ai={found.ai} onClose={() => setFound(null)} />}
    </MeetingsCtx.Provider>
  );
}
