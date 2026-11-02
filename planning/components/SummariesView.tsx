"use client";
// Resúmenes mensuales de los clientes. Viven en la app (se escriben y editan acá) y se pueden mandar a ClickUp;
// los que se escribieron en ClickUp también aparecen (y se copian a la app por las dudas).
// Por cliente (todos sus meses) o por mes (todos los clientes), y cada uno se lee en el panel lateral.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { SidePanel } from "./ui";
import { Markdown, plainPreview } from "./Markdown";
import { matchClient, monthLabel, summaryDraft, type SummaryPage } from "@/lib/summaries";
import { isStaff, canDelete } from "@/lib/permissions";
import { timeAgo } from "@/lib/notifications";

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });

type State =
  | { status: "loading" }
  | { status: "ok"; summaries: SummaryPage[]; at: string; clickup: boolean; clickupError: string | null; needsSql: boolean }
  | { status: "missing" }
  | { status: "error"; message: string };

interface Draft {
  id: string | null;
  client_id: string;
  month: string;
  title: string;
  content: string;
  /** Editar uno que estaba solo en ClickUp: la copia en la app queda unida a esa página */
  clickup_key?: string | null;
  clickup_url?: string;
}

export function SummariesView() {
  const { me, clients, tasks, projects, today, toast, byId } = useData();
  const staff = isStaff(me);
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [only, setOnly] = useState<Set<string>>(new Set());
  const [month, setMonth] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<SummaryPage | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/resumenes${fresh ? "?fresh=1" : ""}`);
      const body = await res.json();
      if (res.status === 503 && body.error === "missing_config") setState({ status: "missing" });
      else if (!res.ok) setState({ status: "error", message: body.error ?? "No se pudieron leer los resúmenes" });
      else {
        setState({ status: "ok", summaries: body.summaries, at: body.at, clickup: body.clickup ?? false, clickupError: body.clickupError ?? null, needsSql: !!body.needsSql });
        return body.summaries as SummaryPage[];
      }
    } catch {
      setState({ status: "error", message: "No se pudo conectar con el servidor" });
    } finally {
      setRefreshing(false);
    }
    return null;
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const all = state.status === "ok" ? state.summaries : [];
  const colorOf = (x: SummaryPage) => (x.client_id ? byId.client.get(x.client_id)?.color : undefined) ?? matchClient(x.client, clients)?.color ?? "var(--muted)";
  const clientNames = useMemo(() => [...new Set(all.map((s) => s.client))].sort(), [all]);
  const months = useMemo(() => [...new Set(all.map((s) => s.month))].sort().reverse(), [all]);

  const s = q.trim().toLowerCase();
  const list = all.filter(
    (x) => (!only.size || only.has(x.client)) && (!month || x.month === month) && (!s || x.content.toLowerCase().includes(s) || x.name.toLowerCase().includes(s)),
  );
  const byClient = clientNames.map((c) => ({ client: c, items: list.filter((x) => x.client === c) })).filter((g) => g.items.length);

  // En el panel: ir al mes anterior/siguiente del mismo cliente
  const siblings = open ? all.filter((x) => x.client === open.client) : [];
  const idx = open ? siblings.findIndex((x) => x.key === open.key) : -1;

  async function post(body: unknown) {
    const res = await fetch("/api/resumenes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? "No se pudo");
    return out;
  }
  const reopen = async (id: string) => {
    const fresh = await load();
    setOpen(fresh?.find((x) => x.id === id) ?? null);
  };

  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    try {
      const { summary } = await post({ action: "save", summary: draft });
      toast(draft.id ? "Resumen actualizado" : "Resumen guardado en la app");
      setDraft(null);
      await reopen(summary.id);
    } catch (e) {
      toast((e as Error).message, true);
    }
    setBusy(false);
  }
  async function send(x: SummaryPage) {
    if (!x.id) return;
    setBusy(true);
    try {
      await post({ action: "send", id: x.id });
      toast(x.clickup_key ? "Actualizado en ClickUp" : "Mandado a ClickUp");
      await reopen(x.id);
    } catch (e) {
      toast((e as Error).message, true);
    }
    setBusy(false);
  }
  async function del(x: SummaryPage) {
    if (!x.id || !confirm(`¿Borrar de la app el resumen de ${x.client} de ${monthLabel(x.month)}? En ClickUp no se borra.`)) return;
    try {
      await post({ action: "delete", id: x.id });
      setOpen(null);
      load();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const newDraft = (): Draft => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1); // por lo general se escribe el del mes que terminó
    const m = d.toISOString().slice(0, 7);
    const c = only.size === 1 ? clients.find((x) => x.name === [...only][0]) : undefined;
    return { id: null, client_id: c?.id ?? "", month: m, title: "", content: "" };
  };
  const editDraft = (x: SummaryPage): Draft => ({
    id: x.id ?? null,
    client_id: x.client_id ?? matchClient(x.client, clients)?.id ?? "",
    month: x.month,
    title: x.name,
    content: x.content,
    ...(x.id ? {} : { clickup_key: x.key, clickup_url: x.url }),
  });

  const card = (x: SummaryPage, showClient: boolean) => (
    <button key={x.key} className={`sum-card ${open?.key === x.key ? "sel" : ""}`} style={{ borderTopColor: colorOf(x) }} onClick={() => (setDraft(null), setOpen(x))}>
      <div className="sum-top">
        <b>{showClient ? x.client : monthLabel(x.month)}</b>
        {x.hours !== null && <span className="pill s-en_revision">{x.hours} h</span>}
      </div>
      {showClient && <span className="muted sum-month">{monthLabel(x.month)}</span>}
      <p>{plainPreview(x.content) || <span className="muted">Sin contenido todavía</span>}</p>
      <span className="muted sum-foot">
        {x.source === "app" ? (x.clickup_key ? "En la app y en ClickUp" : "Escrito en la app") : "De ClickUp"} · {fmtDay(x.updated)}
      </span>
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Clientes</div>
          <h1>
            Resúmenes <em>mensuales</em>
          </h1>
          {state.status === "ok" && (
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {all.length} resúmenes de {clientNames.length} clientes · actualizado {timeAgo(state.at)}
            </p>
          )}
        </div>
        <div className="actions">
          <button className="btn" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? "Leyendo…" : "↻ Actualizar"}
          </button>
          {staff && state.status === "ok" && !state.needsSql && (
            <button className="btn primary" onClick={() => (setOpen(null), setDraft(newDraft()))}>
              + Nuevo resumen
            </button>
          )}
        </div>
      </div>

      {state.status === "ok" && state.needsSql && staff && (
        <div className="notice">Para escribir resúmenes en la app falta correr el SQL 0008_resumenes en Supabase. Mientras tanto se ven los de ClickUp.</div>
      )}
      {state.status === "ok" && state.clickupError && <div className="notice">No se pudo leer ClickUp ({state.clickupError}). Se muestran los que están guardados en la app.</div>}

      {state.status === "ok" && (
        <div className="filters">
          <div className="field">
            <span>Mes</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Todos los meses</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span>Buscar</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mercado Ads, LinkedIn…" />
          </div>
          <div className="field" style={{ flex: "1 1 300px" }}>
            <span>Clientes</span>
            <div className="chips one-line">
              {clientNames.map((c) => (
                <button
                  key={c}
                  className={`chip ${only.has(c) ? "on" : ""}`}
                  onClick={() =>
                    setOnly((x) => {
                      const n = new Set(x);
                      if (n.has(c)) n.delete(c);
                      else n.add(c);
                      return n;
                    })
                  }
                >
                  <i style={{ background: matchClient(c, clients)?.color ?? "var(--muted)" }} />
                  {c}
                </button>
              ))}
              {only.size > 0 && (
                <button className="btn ghost sm" onClick={() => setOnly(new Set())}>
                  Ver todos
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {state.status === "loading" && <div className="empty">Leyendo los resúmenes…</div>}
      {state.status === "error" && <div className="notice err">{state.message}</div>}
      {state.status === "missing" && (
        <div className="notice">
          Falta conectar ClickUp y correr el SQL 0008_resumenes.{" "}
          {staff
            ? "En Vercel → Settings → Environment Variables sumá CLICKUP_API_TOKEN y CLICKUP_WORKSPACE_ID, y en Supabase corré el SQL de resúmenes."
            : "Pedile a un admin que lo configure."}
        </div>
      )}

      {state.status === "ok" &&
        (list.length === 0 ? (
          <div className="empty">{all.length ? "No hay resúmenes con esos filtros." : "Todavía no hay resúmenes."}</div>
        ) : month ? (
          <div className="sum-grid">{list.map((x) => card(x, true))}</div>
        ) : (
          byClient.map((g) => (
            <section key={g.client} className="sum-client">
              <h2>
                <i className="dot" style={{ background: colorOf(g.items[0]) }} />
                {g.client}
                <span className="muted"> · {g.items.length} {g.items.length === 1 ? "mes" : "meses"}</span>
              </h2>
              <div className="sum-grid">{g.items.map((x) => card(x, false))}</div>
            </section>
          ))
        ))}

      {draft && (
        <SummaryEditor
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          onSave={saveDraft}
          onClose={() => setDraft(null)}
          existing={all.find((x) => x.id !== draft.id && x.month === draft.month && (x.client_id ? x.client_id === draft.client_id : matchClient(x.client, clients)?.id === draft.client_id))}
          onOpenExisting={(x) => (setDraft(null), setOpen(x))}
          buildDraft={() => {
            const c = byId.client.get(draft.client_id);
            const done = tasks
              .filter((t) => t.client_id === draft.client_id && t.status === "hecha" && (t.completed_at ?? t.due_date ?? "").slice(0, 7) === draft.month)
              .map((t) => ({ title: t.title, project: t.project_id ? (projects.find((p) => p.id === t.project_id)?.name ?? null) : null }));
            return summaryDraft(c?.name ?? "", draft.month, done);
          }}
        />
      )}

      {open && !draft && (
        <SidePanel
          title={
            <>
              {open.client} · {monthLabel(open.month)}
            </>
          }
          onClose={() => setOpen(null)}
          footer={
            <>
              <div className="actions">
                <button className="btn" disabled={idx >= siblings.length - 1} onClick={() => setOpen(siblings[idx + 1])} title="Mes anterior">
                  ← {idx < siblings.length - 1 ? monthLabel(siblings[idx + 1].month) : ""}
                </button>
                <button className="btn" disabled={idx <= 0} onClick={() => setOpen(siblings[idx - 1])} title="Mes siguiente">
                  {idx > 0 ? monthLabel(siblings[idx - 1].month) : ""} →
                </button>
              </div>
              <div className="actions">
                {open.url && (
                  <a className="btn" href={open.url} target="_blank" rel="noreferrer">
                    Abrir en ClickUp ↗
                  </a>
                )}
                {staff && open.id && state.status === "ok" && state.clickup && (
                  <button className="btn" onClick={() => send(open)} disabled={busy}>
                    {busy ? "Mandando…" : open.clickup_key ? "↑ Actualizar en ClickUp" : "↑ Mandar a ClickUp"}
                  </button>
                )}
                {staff && (open.id || (state.status === "ok" && !state.needsSql)) && (
                  <button className="btn primary" onClick={() => setDraft(editDraft(open))}>
                    Editar
                  </button>
                )}
              </div>
            </>
          }
        >
          <div className="sum-meta">
            <span className="muted">{open.name}</span>
            {open.hours !== null && <span className="pill s-en_revision">{open.hours} horas</span>}
            <span className="muted">
              · {open.source === "app" ? "escrito en la app" : open.id ? "copiado de ClickUp" : "de ClickUp"} · actualizado el {fmtDay(open.updated)}
              {open.sent_at ? ` · mandado a ClickUp el ${fmtDay(open.sent_at)}` : ""}
            </span>
          </div>
          <Markdown text={open.content} />
          {open.versions.length > 0 && (
            <div className="meta-line">
              Otras versiones de este mes en ClickUp:{" "}
              {open.versions.map((v, i) => (
                <span key={v.url}>
                  {i > 0 && " · "}
                  <a href={v.url} target="_blank" rel="noreferrer">
                    {v.name}
                  </a>
                </span>
              ))}
            </div>
          )}
          {open.id && canDelete(me) && (
            <div>
              <button className="btn danger sm" onClick={() => del(open)}>
                Borrar de la app
              </button>
            </div>
          )}
        </SidePanel>
      )}
    </>
  );
}

function SummaryEditor({
  draft,
  setDraft,
  busy,
  onSave,
  onClose,
  existing,
  onOpenExisting,
  buildDraft,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  onSave: () => void;
  onClose: () => void;
  existing?: SummaryPage;
  onOpenExisting: (x: SummaryPage) => void;
  buildDraft: () => string;
}) {
  const { clients } = useData();
  const [preview, setPreview] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  return (
    <SidePanel
      title={draft.id ? "Editar resumen" : "Nuevo resumen"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" onClick={onSave} disabled={busy || !draft.client_id || !draft.month || !draft.content.trim()}>
            {busy ? "Guardando…" : "Guardar en la app"}
          </button>
        </>
      }
    >
      <div className="grid2">
        <label className="field">
          <span>Cliente</span>
          <select value={draft.client_id} onChange={(e) => set({ client_id: e.target.value })}>
            <option value="">Elegí el cliente…</option>
            {clients
              .filter((c) => c.active || c.id === draft.client_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Mes</span>
          <input type="month" value={draft.month} onChange={(e) => set({ month: e.target.value })} />
        </label>
      </div>
      {existing && (
        <div className="notice">
          Ya hay un resumen de este cliente para {monthLabel(draft.month)}.{" "}
          <button className="link" onClick={() => onOpenExisting(existing)}>
            Ver ese
          </button>
        </div>
      )}
      <label className="field">
        <span>Título</span>
        <input type="text" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder={draft.month ? `Resumen de avance - ${monthLabel(draft.month)}` : "Resumen de avance"} />
      </label>
      <div className="field">
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          Contenido
          <span className="seg">
            <button className={!preview ? "on" : ""} onClick={() => setPreview(false)}>
              Escribir
            </button>
            <button className={preview ? "on" : ""} onClick={() => setPreview(true)}>
              Vista previa
            </button>
          </span>
        </span>
        {preview ? (
          <div className="sum-preview">{draft.content.trim() ? <Markdown text={draft.content} /> : <span className="muted">Todavía no hay contenido.</span>}</div>
        ) : (
          <textarea className="sum-text" value={draft.content} onChange={(e) => set({ content: e.target.value })} placeholder={"## Detalle de trabajos realizados (18 horas)\n\n### Mercado Libre\n* …"} />
        )}
        <div className="meta-line">
          Se escribe en Markdown: <code>##</code> títulos, <code>*</code> viñetas, <code>**negrita**</code>. Las horas se toman del título “(18 horas)”.
        </div>
      </div>
      {!draft.id && draft.client_id && draft.month && (
        <div>
          <button
            className="btn sm"
            onClick={() => {
              if (draft.content.trim() && !confirm("¿Reemplazar lo escrito por el borrador?")) return;
              set({ content: buildDraft() });
              setPreview(false);
            }}
          >
            ✨ Armar borrador con las tareas cerradas del mes
          </button>
        </div>
      )}
    </SidePanel>
  );
}
