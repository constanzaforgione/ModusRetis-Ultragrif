"use client";
// Resúmenes mensuales de los clientes, leídos de ClickUp (docs "Resumen de avance" y tareas de resumen).
// Por cliente (todos sus meses) o por mes (todos los clientes), y cada uno se lee en el panel lateral.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { SidePanel } from "./ui";
import { Markdown, plainPreview } from "./Markdown";
import { matchClient, monthLabel, type SummaryPage } from "@/lib/summaries";
import { isStaff } from "@/lib/permissions";
import { timeAgo } from "@/lib/notifications";

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });

type State = { status: "loading" } | { status: "ok"; summaries: SummaryPage[]; at: string } | { status: "missing" } | { status: "error"; message: string };

export function SummariesView() {
  const { me, clients } = useData();
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [only, setOnly] = useState<Set<string>>(new Set());
  const [month, setMonth] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<SummaryPage | null>(null);

  const load = useCallback(async (fresh = false) => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/resumenes${fresh ? "?fresh=1" : ""}`);
      const body = await res.json();
      if (res.status === 503 && body.error === "missing_config") setState({ status: "missing" });
      else if (!res.ok) setState({ status: "error", message: body.error ?? "No se pudo leer ClickUp" });
      else setState({ status: "ok", summaries: body.summaries, at: body.at });
    } catch {
      setState({ status: "error", message: "No se pudo conectar con el servidor" });
    }
    setRefreshing(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const all = state.status === "ok" ? state.summaries : [];
  const colorOf = (client: string) => matchClient(client, clients)?.color ?? "var(--muted)";
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

  const card = (x: SummaryPage, showClient: boolean) => (
    <button key={x.key} className={`sum-card ${open?.key === x.key ? "sel" : ""}`} style={{ borderTopColor: colorOf(x.client) }} onClick={() => setOpen(x)}>
      <div className="sum-top">
        <b>{showClient ? x.client : monthLabel(x.month)}</b>
        {x.hours !== null && <span className="pill s-en_revision">{x.hours} h</span>}
      </div>
      {showClient && <span className="muted sum-month">{monthLabel(x.month)}</span>}
      <p>{plainPreview(x.content) || <span className="muted">Sin contenido todavía</span>}</p>
      <span className="muted sum-foot">Actualizado el {fmtDay(x.updated)}</span>
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Clientes · desde ClickUp</div>
          <h1>
            Resúmenes <em>mensuales</em>
          </h1>
          {state.status === "ok" && (
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {all.length} resúmenes de {clientNames.length} clientes · leído {timeAgo(state.at)}
            </p>
          )}
        </div>
        <div className="actions">
          <button className="btn" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? "Leyendo ClickUp…" : "↻ Actualizar"}
          </button>
        </div>
      </div>

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
                  <i style={{ background: colorOf(c) }} />
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

      {state.status === "loading" && <div className="empty">Leyendo los resúmenes de ClickUp…</div>}
      {state.status === "error" && <div className="notice err">{state.message}</div>}
      {state.status === "missing" && (
        <div className="notice">
          Falta conectar ClickUp.{" "}
          {isStaff(me)
            ? "En Vercel → Settings → Environment Variables sumá CLICKUP_API_TOKEN (ClickUp → avatar → Configuración → Apps → API Token) y CLICKUP_WORKSPACE_ID, y volvé a publicar."
            : "Pedile a un admin que lo configure."}
        </div>
      )}

      {state.status === "ok" &&
        (list.length === 0 ? (
          <div className="empty">No hay resúmenes con esos filtros.</div>
        ) : month ? (
          <div className="sum-grid">{list.map((x) => card(x, true))}</div>
        ) : (
          byClient.map((g) => (
            <section key={g.client} className="sum-client">
              <h2>
                <i className="dot" style={{ background: colorOf(g.client) }} />
                {g.client}
                <span className="muted"> · {g.items.length} {g.items.length === 1 ? "mes" : "meses"}</span>
              </h2>
              <div className="sum-grid">{g.items.map((x) => card(x, false))}</div>
            </section>
          ))
        ))}

      {open && (
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
              <a className="btn primary" href={open.url} target="_blank" rel="noreferrer">
                Abrir en ClickUp ↗
              </a>
            </>
          }
        >
          <div className="sum-meta">
            <span className="muted">{open.name}</span>
            {open.hours !== null && <span className="pill s-en_revision">{open.hours} horas</span>}
            <span className="muted">· actualizado el {fmtDay(open.updated)}</span>
          </div>
          <Markdown text={open.content} />
          {open.versions.length > 0 && (
            <div className="meta-line">
              Otras versiones de este mes:{" "}
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
        </SidePanel>
      )}
    </>
  );
}
