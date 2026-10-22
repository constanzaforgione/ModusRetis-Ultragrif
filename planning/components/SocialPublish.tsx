"use client";
// Material de la pieza (fotos, videos, PDF) y su publicación en cada red.
import { useRef, useState } from "react";
import { useData } from "./DataProvider";
import { NetBadges } from "./NetBadges";
import { supabaseBrowser } from "@/lib/supabase/client";
import { prepare, sizeHints, type Prepared } from "@/lib/social/files";
import { checkFor } from "@/lib/social/checks";
import { NETWORK } from "@/lib/social";
import { isStaff } from "@/lib/permissions";
import type { Network, SocialMedia, SocialPost, SocialPublication } from "@/lib/types";

const MAX_BYTES = 50 * 1024 * 1024; // límite por archivo del plan gratis de Supabase

const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/** Sube archivos ya preparados a una pieza existente */
export async function uploadMedia(postId: string, files: Prepared[], startAt: number, userId: string) {
  const sb = supabaseBrowser();
  for (const [i, p] of files.entries()) {
    const path = `${postId}/${crypto.randomUUID().slice(0, 8)}-${p.name}`;
    const up = await sb.storage.from("social").upload(path, p.file, { contentType: p.mime, upsert: false });
    if (up.error) throw new Error(/bucket|not found/i.test(up.error.message) ? "Falta correr en Supabase la migración 0006 (publicación)." : up.error.message);
    const url = sb.storage.from("social").getPublicUrl(path).data.publicUrl;
    const ins = await sb.from("social_media").insert({
      post_id: postId,
      path,
      url,
      kind: p.kind,
      mime: p.mime,
      size_bytes: p.file.size,
      width: p.width,
      height: p.height,
      duration: p.duration,
      position: startAt + i,
      created_by: userId,
    });
    if (ins.error) {
      await sb.storage.from("social").remove([path]);
      throw new Error(ins.error.message);
    }
  }
}

type Thumb = { key: string; kind: Prepared["kind"]; src: string; name: string; size: number; hints: string[] };

function Thumbnail({ t, editable, onLeft, onRight, onRemove }: { t: Thumb; editable: boolean; onLeft?: () => void; onRight?: () => void; onRemove: () => void }) {
  return (
    <div className="media-item" title={`${t.name} · ${fmtSize(t.size)}`}>
      {t.kind === "image" ? <img src={t.src} alt="" /> : t.kind === "video" ? <video src={t.src} muted preload="metadata" /> : <div className="doc">📄 PDF</div>}
      {t.kind === "video" && <span className="badge-v">▶</span>}
      {t.hints.length > 0 && (
        <span className="badge-w" title={t.hints.join(" ")}>
          !
        </span>
      )}
      {editable && (
        <div className="media-ctrls">
          {onLeft && (
            <button type="button" onClick={onLeft} aria-label="Mover antes">
              ←
            </button>
          )}
          {onRight && (
            <button type="button" onClick={onRight} aria-label="Mover después">
              →
            </button>
          )}
          <button type="button" onClick={onRemove} aria-label="Sacar">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

/** Material: en una pieza nueva queda en espera y se sube al guardar */
export function MediaManager({
  postId,
  format,
  editable,
  pending,
  setPending,
}: {
  postId?: string;
  format: string;
  editable: boolean;
  pending: Prepared[];
  setPending: (p: Prepared[]) => void;
}) {
  const { me, media, toast, reload } = useData();
  const items = postId ? media.filter((m) => m.post_id === postId).sort((a, b) => a.position - b.position) : [];
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [previews] = useState(() => new Map<Blob, string>());
  const previewOf = (b: Blob) => {
    if (!previews.has(b)) previews.set(b, URL.createObjectURL(b));
    return previews.get(b)!;
  };

  async function add(files: FileList | File[]) {
    const list = [...files];
    const big = list.find((f) => f.size > MAX_BYTES);
    if (big) return toast(`«${big.name}» pesa ${fmtSize(big.size)}: el máximo es 50 MB por archivo.`, true);
    setBusy(true);
    try {
      const prepared: Prepared[] = [];
      for (const f of list) prepared.push(await prepare(f));
      if (postId) {
        await uploadMedia(postId, prepared, (items.at(-1)?.position ?? -1) + 1, me.id);
        await reload("social_media");
      } else setPending([...pending, ...prepared]);
    } catch (e) {
      toast((e as Error).message, true);
    }
    setBusy(false);
  }

  async function removeItem(m: SocialMedia) {
    const sb = supabaseBrowser();
    const r = await sb.from("social_media").delete().eq("id", m.id);
    if (r.error) return toast(r.error.message, true);
    await sb.storage.from("social").remove([m.path]);
    reload("social_media");
  }

  async function swap(a: SocialMedia, b: SocialMedia) {
    const sb = supabaseBrowser();
    await sb.from("social_media").update({ position: b.position }).eq("id", a.id);
    await sb.from("social_media").update({ position: a.position }).eq("id", b.id);
    reload("social_media");
  }

  const thumbs: { t: Thumb; left?: () => void; right?: () => void; remove: () => void }[] = postId
    ? items.map((m, i) => ({
        t: { key: m.id, kind: m.kind, src: m.url, name: m.path.split("/").pop() ?? "", size: m.size_bytes, hints: sizeHints(m, format) },
        left: i > 0 ? () => swap(m, items[i - 1]) : undefined,
        right: i < items.length - 1 ? () => swap(m, items[i + 1]) : undefined,
        remove: () => removeItem(m),
      }))
    : pending.map((p, i) => ({
        t: { key: `${i}-${p.name}`, kind: p.kind, src: p.kind === "document" ? "" : previewOf(p.file), name: p.name, size: p.file.size, hints: sizeHints(p, format) },
        left: i > 0 ? () => setPending(pending.map((x, j) => (j === i ? pending[i - 1] : j === i - 1 ? p : x))) : undefined,
        right: i < pending.length - 1 ? () => setPending(pending.map((x, j) => (j === i ? pending[i + 1] : j === i + 1 ? p : x))) : undefined,
        remove: () => setPending(pending.filter((_, j) => j !== i)),
      }));
  const hints = [...new Set(thumbs.flatMap((x) => x.t.hints))];

  return (
    <div className="field">
      <span>
        Material {thumbs.length > 0 && <small className="muted">· {thumbs.length} {thumbs.length === 1 ? "archivo" : "archivos"} (en este orden se publican)</small>}
      </span>
      <div
        className={`media-grid ${drag ? "drag" : ""}`}
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (editable && e.dataTransfer.files.length) add(e.dataTransfer.files);
        }}
      >
        {thumbs.map((x) => (
          <Thumbnail key={x.t.key} t={x.t} editable={editable} onLeft={x.left} onRight={x.right} onRemove={x.remove} />
        ))}
        {editable && (
          <button type="button" className="media-add" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? "Subiendo…" : thumbs.length ? "+ Sumar" : "+ Fotos, video o PDF"}
            <small className="muted">o arrastralos acá</small>
          </button>
        )}
        <input ref={input} type="file" multiple accept="image/*,video/*,application/pdf" hidden onChange={(e) => e.target.files && add(e.target.files).then(() => (e.target.value = ""))} />
      </div>
      {hints.length > 0 && <div className="meta-line">⚠ {hints.join(" ")}</div>}
      {!postId && pending.length > 0 && <div className="meta-line">Se suben al guardar la pieza.</div>}
    </div>
  );
}

const PUB_LABEL: Record<SocialPublication["status"], string> = {
  pendiente: "Programada",
  procesando: "Publicando…",
  publicada: "Publicada",
  error: "No se pudo publicar",
  manual: "Hay que terminarla a mano",
};
const PUB_PILL: Record<SocialPublication["status"], string> = {
  pendiente: "s-programada",
  procesando: "s-en_curso",
  publicada: "s-hecha",
  error: "s-bloqueada",
  manual: "s-pendiente",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Cada red de la pieza: cuenta, si sale sola o a mano, y cómo le fue */
export function PublishPanel({
  draft,
  pending,
  editable,
  dirty,
  onProgram,
  onUnprogram,
  onPublishNow,
}: {
  draft: Partial<SocialPost>;
  pending: Prepared[];
  editable: boolean;
  dirty: boolean;
  onProgram: () => void;
  onUnprogram: () => void;
  onPublishNow: (network?: Network) => void;
}) {
  const { me, accounts, media, publications, clients, toast, reload } = useData();
  const staff = isStaff(me);
  const items = draft.id ? media.filter((m) => m.post_id === draft.id).sort((a, b) => a.position - b.position) : pending.map((p) => ({ ...p, url: "", size_bytes: p.file.size }));
  const pubs = draft.id ? publications.filter((p) => p.post_id === draft.id) : [];
  const client = clients.find((c) => c.id === draft.client_id);
  const programmed = draft.status === "programada";
  const asPost = { id: draft.id ?? "", title: draft.title ?? "", copy: draft.copy ?? "", hashtags: draft.hashtags ?? "", format: draft.format ?? "post", first_comment: draft.first_comment ?? "" };

  async function markDone(p: SocialPublication) {
    const link = prompt(`¿Link de la publicación en ${NETWORK[p.network].label}? (opcional)`, "");
    if (link === null) return;
    const r = await supabaseBrowser()
      .from("social_publications")
      .update({ status: "publicada", permalink: link.trim(), message: "Publicada a mano", published_at: new Date().toISOString() })
      .eq("id", p.id);
    if (r.error) return toast(r.error.message, true);
    toast("Listo, quedó como publicada");
    reload("social_publications");
    reload("social_posts");
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copiado`);
    } catch {
      toast("No se pudo copiar: seleccioná el texto a mano", true);
    }
  }

  const rows = (draft.networks ?? []).map((n) => {
    const acc = accounts.find((a) => a.client_id === draft.client_id && a.network === n);
    const reason = checkFor(n, asPost, items);
    const pub = pubs.find((p) => p.network === n);
    return { n, acc, reason, pub };
  });
  const autoOk = rows.filter((r) => !r.reason && r.acc?.status === "conectada").length;

  return (
    <div className="field publish">
      <span>Publicación</span>
      <div className="pub-box">
        {rows.map(({ n, acc, reason, pub }) => (
          <div key={n} className="pub-row">
            <NetBadges nets={[n]} />
            <div className="pub-main">
              <b>
                {acc ? (acc.username ? `@${acc.username}` : acc.name) : <span className="muted">Sin cuenta conectada</span>}
                {acc && acc.status !== "conectada" && <span className="late"> · conexión vencida</span>}
              </b>
              <small className={reason ? "late" : "muted"}>
                {pub?.message
                  ? pub.message
                  : reason
                    ? `A mano: ${reason}`
                    : !acc
                      ? `Conectá la cuenta de ${client?.name ?? "este cliente"} para que salga sola.`
                      : n === "tiktok"
                        ? "Llega a los borradores de TikTok y se termina desde la app (hasta que TikTok apruebe la publicación directa)."
                        : "Sale sola a la hora programada."}
              </small>
            </div>
            {pub ? (
              <div className="pub-actions">
                <span className={`pill ${PUB_PILL[pub.status]}`}>{PUB_LABEL[pub.status]}</span>
                {pub.status === "publicada" && pub.permalink && (
                  <a className="btn sm" href={pub.permalink} target="_blank" rel="noreferrer">
                    Ver ↗
                  </a>
                )}
                {editable && pub.status === "error" && (
                  <button className="btn sm" onClick={() => onPublishNow(n)}>
                    Reintentar
                  </button>
                )}
                {editable && (pub.status === "manual" || pub.status === "error") && (
                  <button className="btn sm" onClick={() => markDone(pub)}>
                    Ya la publiqué
                  </button>
                )}
              </div>
            ) : (
              !acc &&
              staff &&
              draft.client_id && (
                <a className="btn sm" href={`/api/social/connect/${n}?client=${draft.client_id}`}>
                  Conectar
                </a>
              )
            )}
          </div>
        ))}
        {pubs.some((p) => p.status === "manual" || p.status === "error") && (
          <div className="pub-manual">
            <span className="muted">Para publicar a mano:</span>
            <button className="btn sm" onClick={() => copy([asPost.copy, asPost.hashtags].filter(Boolean).join("\n\n"), "Copy")}>
              Copiar copy
            </button>
            {asPost.first_comment && (
              <button className="btn sm" onClick={() => copy(asPost.first_comment, "Comentario")}>
                Copiar comentario
              </button>
            )}
            {items.map((m, i) =>
              "id" in m ? (
                <a key={m.id} className="btn sm" href={m.url} target="_blank" rel="noreferrer">
                  Archivo {i + 1} ↗
                </a>
              ) : null,
            )}
          </div>
        )}
        {editable && (
          <div className="pub-cta">
            {programmed ? (
              <>
                <span className="muted">
                  {pubs[0] ? `Sale ${when(pubs[0].scheduled_at)}` : "Programada"}
                  {dirty ? " · guardá los cambios para que se publique la versión nueva" : ""}
                </span>
                <div className="actions">
                  <button className="btn sm" onClick={onUnprogram}>
                    Cancelar programación
                  </button>
                  <button className="btn sm primary" onClick={() => onPublishNow()} disabled={!autoOk}>
                    Publicar ahora
                  </button>
                </div>
              </>
            ) : draft.status !== "publicada" ? (
              <>
                <span className="muted">
                  {autoOk ? `${autoOk} de ${rows.length} ${rows.length === 1 ? "red sale sola" : "redes salen solas"} a la fecha y hora de la pieza.` : "Ninguna red puede salir sola todavía (revisá cuentas y material)."}
                </span>
                <button className="btn sm primary" onClick={onProgram}>
                  Programar publicación
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
