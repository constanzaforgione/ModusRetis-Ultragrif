"use client";
// Importar un calendario en HTML: se lee en el navegador (no se sube a ningún lado), se revisan las
// piezas encontradas y se cargan al calendario del cliente elegido.
import { useMemo, useRef, useState } from "react";
import { useData } from "./DataProvider";
import { Modal } from "./ui";
import { NetBadges } from "./NetBadges";
import { supabaseBrowser } from "@/lib/supabase/client";
import { norm, parseSocialCalendar, type ImportedPiece, type ImportResult } from "@/lib/socialImport";
import { FORMATS, NETWORKS, POST_STATUS } from "@/lib/social";
import { fmtShort } from "@/lib/dates";
import type { Network, PostFormat, PostStatus } from "@/lib/types";

type Row = ImportedPiece & { on: boolean; dup: boolean; noNet: boolean; open: boolean };

const METHOD_LABEL: Record<NonNullable<ImportResult["method"]>, string> = {
  script: "datos del archivo",
  tabla: "una tabla con una fila por pieza",
  grilla: "una grilla de calendario",
  tarjetas: "tarjetas por día",
};

export function SocialImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (firstDate: string | null) => void }) {
  const { me, clients, posts, today, toast, reload } = useData();
  const socialClients = clients.filter((c) => c.social && c.active);
  const [stage, setStage] = useState<"archivo" | "revisar">("archivo");
  const [html, setHtml] = useState("");
  const [fileName, setFileName] = useState("");
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function readFile(f: File | undefined) {
    if (!f) return;
    if (!/\.html?$/i.test(f.name) && !f.type.includes("html")) return toast("Tiene que ser un archivo .html", true);
    setFileName(f.name);
    setHtml(await f.text());
  }

  const markDups = (list: Row[], cid: string) =>
    list.map((r) => {
      const dup = !!r.date && posts.some((p) => p.client_id === cid && p.publish_date === r.date && norm(p.title) === norm(r.title));
      return { ...r, dup, on: r.on && !dup };
    });

  function analyze() {
    if (!html.trim()) return toast("Elegí un archivo o pegá el HTML", true);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const res = parseSocialCalendar(doc, { clients: socialClients.map((c) => c.name), fileName });
    setResult(res);
    const cid = clientId || socialClients.find((c) => c.name === res.client)?.id || (socialClients.length === 1 ? socialClients[0].id : "");
    setClientId(cid);
    setRows(
      markDups(
        res.pieces.map((p) => ({ ...p, on: !!p.date, dup: false, noNet: !p.networks.length, networks: p.networks.length ? p.networks : (["instagram"] as Network[]), open: false })),
        cid,
      ),
    );
    setStage("revisar");
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.on);
  const missingDate = chosen.filter((r) => !r.date).length;
  const range = useMemo(() => {
    const ds = rows.map((r) => r.date).filter(Boolean).sort() as string[];
    return ds.length ? `${fmtShort(ds[0])} → ${fmtShort(ds[ds.length - 1])}` : "";
  }, [rows]);

  async function importNow() {
    if (!clientId) return toast("Elegí a qué cliente pertenece el calendario", true);
    if (!chosen.length) return toast("No hay piezas marcadas para importar", true);
    if (missingDate) return toast(`Faltan fechas en ${missingDate} ${missingDate === 1 ? "pieza" : "piezas"}`, true);
    setBusy(true);
    const payload = chosen.map((r) => ({
      client_id: clientId,
      publish_date: r.date,
      publish_time: r.time,
      networks: r.networks,
      format: r.format ?? "post",
      title: r.title.slice(0, 300) || "Sin título",
      copy: r.copy,
      hashtags: r.hashtags,
      pillar: r.pillar,
      brief: r.brief,
      cta: r.cta,
      asset_url: r.asset_url,
      notes: [r.notes, fileName ? `Importada de ${fileName}` : ""].filter(Boolean).join("\n"),
      status: r.status ?? "idea",
      assignee_id: me.id,
      created_by: me.id,
    }));
    const { error } = await supabaseBrowser().from("social_posts").insert(payload);
    setBusy(false);
    if (error) return toast(/schema cache|does not exist/i.test(error.message) ? "Falta correr en Supabase la migración de RRSS (0005_rrss.sql)." : error.message, true);
    await reload("social_posts");
    toast(`Listo: ${payload.length} ${payload.length === 1 ? "pieza importada" : "piezas importadas"}`);
    onDone(payload.map((p) => p.publish_date!).sort()[0] ?? null);
    onClose();
  }

  if (stage === "archivo")
    return (
      <Modal
        title="Importar calendario (HTML)"
        onClose={onClose}
        footer={
          <>
            <span />
            <div className="actions">
              <button className="btn" onClick={onClose}>
                Cancelar
              </button>
              <button className="btn primary" onClick={analyze} disabled={!html.trim()}>
                Leer calendario
              </button>
            </div>
          </>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Subí el calendario de contenidos en HTML (exportado de Notion, Google Docs, Excel, Canva o armado a mano). Se lee en tu navegador y antes de cargar nada te mostramos lo que encontramos.
        </p>
        <div
          className={`dropzone ${drag ? "on" : ""} ${html ? "ok" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            readFile(e.dataTransfer.files[0]);
          }}
        >
          {html ? (
            <>
              <b>✓ {fileName || "HTML pegado"}</b>
              <span className="muted">{Math.round(html.length / 1024)} KB · clic para cambiarlo</span>
            </>
          ) : (
            <>
              <b>Arrastrá el archivo .html acá</b>
              <span className="muted">o hacé clic para elegirlo</span>
            </>
          )}
          <input ref={input} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => readFile(e.target.files?.[0])} />
        </div>
        <details>
          <summary className="muted" style={{ cursor: "pointer" }}>
            O pegá el código HTML
          </summary>
          <textarea rows={5} value={fileName ? "" : html} onChange={(e) => (setFileName(""), setHtml(e.target.value))} placeholder="<html>…" style={{ marginTop: 8, width: "100%" }} />
        </details>
        <label className="field">
          <span>Cliente</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Detectar del archivo</option>
            {socialClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </Modal>
    );

  return (
    <Modal
      title="Revisar antes de importar"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => setStage("archivo")}>
            ← Otro archivo
          </button>
          <div className="actions">
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn primary" onClick={importNow} disabled={busy || !chosen.length || !clientId}>
              {busy ? "Importando…" : `Importar ${chosen.length} ${chosen.length === 1 ? "pieza" : "piezas"}`}
            </button>
          </div>
        </>
      }
    >
      {!rows.length ? (
        <div className="notice err">
          No encontramos piezas en este archivo. Funciona con tablas (una fila por pieza o una grilla del mes), tarjetas con fecha y red, o datos dentro del HTML. Si tu calendario tiene otra forma, mandanos un ejemplo y lo sumamos.
        </div>
      ) : (
        <>
          <div className="notice">
            Encontramos <b>{rows.length}</b> {rows.length === 1 ? "pieza" : "piezas"} leyendo {result?.method ? METHOD_LABEL[result.method] : "el archivo"}
            {range ? ` (${range})` : ""}. Revisá fechas, redes y formato; el resto (copy, hashtags, brief, links) se carga tal cual y lo podés editar después.
            {rows.some((r) => r.dup) && " Las que ya están en el calendario quedan desmarcadas."}
          </div>
          <div className="grid2">
            <label className="field">
              <span>Cliente</span>
              <select
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setRows((rs) => markDups(rs.map((r) => ({ ...r, on: r.on || r.dup })), e.target.value));
                }}
              >
                <option value="">Elegí…</option>
                {socialClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Selección</span>
              <div className="seg">
                <button onClick={() => setRows((rs) => rs.map((r) => ({ ...r, on: !r.dup })))}>Todas</button>
                <button onClick={() => setRows((rs) => rs.map((r) => ({ ...r, on: false })))}>Ninguna</button>
              </div>
            </div>
          </div>
          {rows.some((r) => r.date && r.date < today && r.status !== "publicada") && (
            <div className="notice">
              {rows.filter((r) => r.date && r.date < today).length} piezas tienen fecha anterior a hoy.{" "}
              <button className="btn sm" onClick={() => setRows((rs) => rs.map((r) => (r.date && r.date < today ? { ...r, status: "publicada" } : r)))}>
                Marcarlas como publicadas
              </button>
            </div>
          )}
          <div className="imp-list">
            {rows.map((r, i) => (
              <div key={i} className={`imp-row ${r.on ? "" : "off"}`}>
                <div className="imp-main">
                  <input type="checkbox" checked={r.on} onChange={(e) => setRow(i, { on: e.target.checked })} aria-label="Importar esta pieza" />
                  <input type="date" value={r.date ?? ""} onChange={(e) => setRow(i, { date: e.target.value || null })} className={!r.date ? "need" : ""} aria-label="Fecha" />
                  <div className="imp-nets">
                    {NETWORKS.map((n) => {
                      const on = r.networks.includes(n.key);
                      return (
                        <button
                          key={n.key}
                          type="button"
                          className={`net-toggle ${on ? "on" : ""}`}
                          title={n.label}
                          aria-pressed={on}
                          onClick={() => {
                            const next = on ? r.networks.filter((x) => x !== n.key) : [...r.networks, n.key];
                            if (next.length) setRow(i, { networks: next, noNet: false });
                          }}
                        >
                          <NetBadges nets={[n.key]} />
                        </button>
                      );
                    })}
                  </div>
                  <select value={r.format ?? "post"} onChange={(e) => setRow(i, { format: e.target.value as PostFormat })} aria-label="Formato">
                    {FORMATS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <input type="text" value={r.title} onChange={(e) => setRow(i, { title: e.target.value })} aria-label="Título" className="imp-title" />
                  <select value={r.status ?? "idea"} onChange={(e) => setRow(i, { status: e.target.value as PostStatus })} aria-label="Estado">
                    {POST_STATUS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button className="btn ghost sm" onClick={() => setRow(i, { open: !r.open })} aria-expanded={r.open}>
                    {r.open ? "▴" : "▾"}
                  </button>
                </div>
                <div className="imp-flags">
                  {r.dup && <span className="pill k-sin_movimiento">Ya está en el calendario</span>}
                  {!r.date && <span className="pill k-vencida">Falta la fecha</span>}
                  {r.noNet && <span className="pill k-por_vencer">Red no indicada: quedó Instagram</span>}
                  {r.time && <span className="muted">{r.time.slice(0, 5)} hs</span>}
                  {!r.open && r.copy && <span className="muted imp-preview">{r.copy}</span>}
                </div>
                {r.open && (
                  <div className="imp-detail">
                    {(
                      [
                        ["Copy", r.copy],
                        ["Hashtags", r.hashtags],
                        ["Pilar", r.pillar],
                        ["Brief", r.brief],
                        ["CTA", r.cta],
                        ["Arte", r.asset_url],
                        ["Notas", r.notes],
                      ] as const
                    )
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k}>
                          <span className="lbl">{k}</span>
                          <div className="pre">{v}</div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
