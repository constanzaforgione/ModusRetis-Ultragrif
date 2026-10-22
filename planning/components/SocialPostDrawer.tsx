"use client";
// Panel lateral de una pieza de redes: ver el detalle, programarla o editarla.
import { useState } from "react";
import { useData } from "./DataProvider";
import { SidePanel } from "./ui";
import { MediaManager, PublishPanel, uploadMedia } from "./SocialPublish";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Prepared } from "@/lib/social/files";
import { NetBadges } from "./NetBadges";
import { assignableProfiles, canDelete, canEditPost } from "@/lib/permissions";
import { FORMATS, NETWORKS, POST_STATUS } from "@/lib/social";
import { fmtShort, hhmm } from "@/lib/dates";
import type { Network, SocialPost } from "@/lib/types";

export type PostDraft = Partial<SocialPost>;

export function SocialPostDrawer({ post, onClose }: { post: PostDraft; onClose: () => void }) {
  const { me, profiles, clients, media, save, remove, toast, byId, reload } = useData();
  const isNew = !post.id;
  const [f, setF] = useState<PostDraft>({
    networks: ["instagram"],
    format: "post",
    status: "idea",
    title: "",
    copy: "",
    hashtags: "",
    pillar: "",
    brief: "",
    cta: "",
    asset_url: "",
    post_url: "",
    notes: "",
    first_comment: "",
    publish_time: null,
    assignee_id: me.id,
    ...post,
  });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Prepared[]>([]);
  const [dirty, setDirty] = useState(false);
  const editable = isNew || canEditPost(me, post, profiles);
  const people = assignableProfiles(me, profiles);
  const socialClients = clients.filter((c) => c.social && (c.active || c.id === f.client_id));
  const set = <K extends keyof SocialPost>(k: K, v: SocialPost[K] | null) => {
    setDirty(true);
    setF((x) => ({ ...x, [k]: v }));
  };
  const toggleNet = (n: Network) => {
    const cur = f.networks ?? [];
    set("networks", cur.includes(n) ? cur.filter((x) => x !== n) : NETWORKS.map((x) => x.key).filter((k) => k === n || cur.includes(k)));
  };

  /** Guarda la pieza (y sube el material en espera). Devuelve el id, o null si no se pudo. */
  async function persist(over: PostDraft = {}): Promise<string | null> {
    if (!f.title?.trim()) return toast("Poné un tema o título para la pieza", true), null;
    if (!f.client_id) return toast("Elegí el cliente", true), null;
    if (!f.publish_date) return toast("Elegí la fecha de publicación", true), null;
    if (!f.networks?.length) return toast("Elegí al menos una red", true), null;
    setBusy(true);
    const row: PostDraft = {
      id: f.id,
      client_id: f.client_id,
      publish_date: f.publish_date,
      publish_time: f.publish_time || null,
      networks: f.networks,
      format: f.format,
      title: f.title.trim(),
      copy: f.copy ?? "",
      hashtags: f.hashtags ?? "",
      pillar: f.pillar ?? "",
      brief: f.brief ?? "",
      cta: f.cta ?? "",
      asset_url: (f.asset_url ?? "").trim(),
      post_url: (f.post_url ?? "").trim(),
      notes: f.notes ?? "",
      first_comment: f.first_comment ?? "",
      status: f.status,
      assignee_id: f.assignee_id || null,
      ...(isNew ? { created_by: me.id } : {}),
      ...over,
    };
    const { error, row: saved } = await save<SocialPost>("social_posts", row);
    if (error || !saved) {
      setBusy(false);
      return toast(error ?? "No se pudo guardar", true), null;
    }
    if (pending.length) {
      try {
        await uploadMedia(saved.id, pending, 0, me.id);
        setPending([]);
        await reload("social_media");
      } catch (e) {
        toast(`La pieza se guardó, pero no se pudo subir el material: ${(e as Error).message}`, true);
      }
    }
    setBusy(false);
    setDirty(false);
    setF((x) => ({ ...x, ...saved }));
    return saved.id;
  }

  async function submit() {
    if (await persist()) {
      toast(isNew ? "Pieza guardada" : "Cambios guardados");
      onClose();
    }
  }

  async function program() {
    if (!f.publish_time) return toast("Poné la hora de publicación para programarla", true);
    if (`${f.publish_date}T${f.publish_time}` < new Date().toLocaleString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).replace(" ", "T").slice(0, 16))
      return toast("Esa fecha y hora ya pasó: elegí otra o usá «Publicar ahora»", true);
    if (await persist({ status: "programada" })) {
      toast("Programada: se publica sola a la hora indicada");
      onClose();
    }
  }

  async function unprogram() {
    if (await persist({ status: "aprobada" })) toast("Se canceló la programación (quedó como Aprobada)");
  }

  async function publishNow(network?: Network) {
    if (!network && !confirm("¿Publicar ahora en las redes de la pieza?")) return;
    const id = dirty || isNew ? await persist() : f.id!;
    if (!id) return;
    setBusy(true);
    toast("Publicando… puede tardar hasta un minuto");
    try {
      const res = await fetch("/api/social/publish-now", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ post_id: id, network }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Error");
      const r = (body.results ?? []) as { kind: string; network: Network; message?: string }[];
      const done = r.filter((x) => x.kind === "done").length;
      const waiting = r.filter((x) => x.kind === "wait").length;
      const bad = r.filter((x) => x.kind === "error" || x.kind === "manual");
      toast(
        [done && `Publicada en ${done} ${done === 1 ? "red" : "redes"}`, waiting && `${waiting} procesando (se termina sola en unos minutos)`, bad.length && `${bad.length} con problemas: ${bad.map((x) => x.message).join(" · ")}`]
          .filter(Boolean)
          .join(". ") || "No había nada para publicar",
        bad.length > 0,
      );
    } catch (e) {
      toast((e as Error).message, true);
    }
    setBusy(false);
    reload("social_publications");
    reload("social_posts");
  }

  async function duplicate() {
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = f;
    void _id;
    void _c;
    void _u;
    const { error } = await save<SocialPost>("social_posts", { ...rest, title: `${f.title} (copia)`, status: "idea", post_url: "", created_by: me.id, assignee_id: f.assignee_id && people.some((p) => p.id === f.assignee_id) ? f.assignee_id : me.id });
    toast(error ?? "Pieza duplicada: quedó como idea el mismo día", !!error);
  }

  async function del() {
    if (!post.id || !confirm(`¿Borrar la pieza "${post.title}"? No se puede deshacer.`)) return;
    const paths = media.filter((m) => m.post_id === post.id).map((m) => m.path);
    const err = await remove("social_posts", post.id);
    if (err) return toast(err, true);
    // Los archivos no se borran solos con la pieza: liberar el espacio
    if (paths.length) await supabaseBrowser().storage.from("social").remove(paths);
    toast("Pieza borrada");
    onClose();
  }

  const client = f.client_id ? byId.client.get(f.client_id) : undefined;
  const copyLen = (f.copy ?? "").length + ((f.hashtags ?? "").length ? (f.hashtags ?? "").length + 2 : 0);
  const creator = post.created_by ? byId.profile.get(post.created_by) : undefined;

  return (
    <SidePanel
      title={isNew ? "Programar pieza" : editable ? "Editar pieza" : "Detalle de la pieza"}
      onClose={onClose}
      footer={
        <>
          <div className="actions">
            {!isNew && canDelete(me) && (
              <button className="btn danger" onClick={del}>
                Borrar
              </button>
            )}
            {!isNew && editable && (
              <button className="btn" onClick={duplicate} title="Crea una copia como idea, para reutilizarla en otra fecha o red">
                Duplicar
              </button>
            )}
          </div>
          <div className="actions">
            <button className="btn" onClick={onClose}>
              {editable ? "Cancelar" : "Cerrar"}
            </button>
            {editable && (
              <button className="btn primary" onClick={submit} disabled={busy}>
                {busy ? "Guardando…" : isNew ? "Programar" : "Guardar"}
              </button>
            )}
          </div>
        </>
      }
    >
      {!editable && <div className="notice">Podés verla, pero solo quien la creó, su responsable (o su líder) y admins/líderes la pueden cambiar.</div>}
      {!isNew && client && (
        <div className="post-head" style={{ borderLeftColor: client.color }}>
          <NetBadges nets={f.networks ?? []} />
          <span>
            <b>{client.name}</b> · {fmtShort(f.publish_date ?? "")}
            {f.publish_time ? ` · ${hhmm(f.publish_time)}` : ""}
          </span>
        </div>
      )}
      <input type="text" className="title-input" placeholder="Tema o título de la pieza" value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} disabled={!editable} autoFocus={isNew} />

      <div className="field">
        <span>Redes</span>
        <div className="chips">
          {NETWORKS.map((n) => {
            const on = f.networks?.includes(n.key);
            return (
              <button key={n.key} type="button" className={`chip net-chip ${on ? "on" : ""}`} style={on ? { background: n.color, borderColor: n.color } : undefined} onClick={() => toggleNet(n.key)} disabled={!editable} aria-pressed={on}>
                <NetBadges nets={[n.key]} plain={on} />
                {n.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid2">
        <label className="field">
          <span>Cliente</span>
          <select value={f.client_id ?? ""} onChange={(e) => set("client_id", e.target.value || null)} disabled={!editable}>
            <option value="">Elegí…</option>
            {socialClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Formato</span>
          <select value={f.format} onChange={(e) => set("format", e.target.value as SocialPost["format"])} disabled={!editable}>
            {FORMATS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Fecha de publicación</span>
          <input type="date" value={f.publish_date ?? ""} onChange={(e) => set("publish_date", e.target.value || null)} disabled={!editable} />
        </label>
        <label className="field">
          <span>Hora</span>
          <input type="time" value={hhmm(f.publish_time)} onChange={(e) => set("publish_time", e.target.value || null)} disabled={!editable} step={900} />
        </label>
        <label className="field">
          <span>Estado</span>
          <select value={f.status} onChange={(e) => set("status", e.target.value as SocialPost["status"])} disabled={!editable}>
            {POST_STATUS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Responsable</span>
          <select value={f.assignee_id ?? ""} onChange={(e) => set("assignee_id", e.target.value || null)} disabled={!editable}>
            <option value="">Sin asignar</option>
            {[...people, ...(f.assignee_id && !people.some((p) => p.id === f.assignee_id) && byId.profile.get(f.assignee_id) ? [byId.profile.get(f.assignee_id)!] : [])].map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
                {p.id === me.id ? " (yo)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Copy {copyLen > 0 && <small className={`muted ${copyLen > 2200 ? "late" : ""}`}>· {copyLen} caracteres{copyLen > 2200 ? " (Instagram admite 2.200)" : ""}</small>}</span>
        <textarea rows={6} value={f.copy ?? ""} onChange={(e) => set("copy", e.target.value)} disabled={!editable} placeholder="El texto que acompaña la publicación" />
      </label>
      <label className="field">
        <span>Hashtags</span>
        <input type="text" value={f.hashtags ?? ""} onChange={(e) => set("hashtags", e.target.value)} disabled={!editable} placeholder="#marca #producto" />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Pilar / objetivo</span>
          <input type="text" value={f.pillar ?? ""} onChange={(e) => set("pillar", e.target.value)} disabled={!editable} placeholder="Producto, marca, comunidad…" />
        </label>
        <label className="field">
          <span>Llamado a la acción</span>
          <input type="text" value={f.cta ?? ""} onChange={(e) => set("cta", e.target.value)} disabled={!editable} placeholder="Escribinos por WhatsApp" />
        </label>
      </div>
      <label className="field">
        <span>Brief visual / guion</span>
        <textarea rows={3} value={f.brief ?? ""} onChange={(e) => set("brief", e.target.value)} disabled={!editable} placeholder="Qué se ve, referencias, indicaciones para diseño o edición" />
      </label>
      <label className="field">
        <span>Primer comentario</span>
        <input type="text" value={f.first_comment ?? ""} onChange={(e) => set("first_comment", e.target.value)} disabled={!editable} placeholder="Se publica como primer comentario: ideal para el link" />
      </label>
      <MediaManager postId={f.id} format={f.format ?? "post"} editable={editable} pending={pending} setPending={(p) => (setPending(p), setDirty(true))} />
      <PublishPanel draft={f} pending={pending} editable={editable && !busy} dirty={dirty} onProgram={program} onUnprogram={unprogram} onPublishNow={publishNow} />
      <label className="field">
        <span>Link al arte editable</span>
        <div className="with-link">
          <input type="url" value={f.asset_url ?? ""} onChange={(e) => set("asset_url", e.target.value)} disabled={!editable} placeholder="Link a Drive, Canva o Figma" />
          {/^https?:\/\//.test(f.asset_url ?? "") && (
            <a className="btn sm" href={f.asset_url} target="_blank" rel="noreferrer">
              Abrir ↗
            </a>
          )}
        </div>
      </label>
      {(f.status === "publicada" || f.post_url) && (
        <label className="field">
          <span>Link a la publicación</span>
          <div className="with-link">
            <input type="url" value={f.post_url ?? ""} onChange={(e) => set("post_url", e.target.value)} disabled={!editable} placeholder="https://instagram.com/p/…" />
            {/^https?:\/\//.test(f.post_url ?? "") && (
              <a className="btn sm" href={f.post_url} target="_blank" rel="noreferrer">
                Ver ↗
              </a>
            )}
          </div>
        </label>
      )}
      <label className="field">
        <span>Notas</span>
        <textarea rows={3} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} disabled={!editable} placeholder="Comentarios del cliente, pendientes…" />
      </label>
      {!isNew && (
        <div className="meta-line">
          {creator ? `Creada por ${creator.full_name}` : "Importada"} · actualizada {new Date(post.updated_at ?? "").toLocaleDateString("es-AR")}
        </div>
      )}
    </SidePanel>
  );
}
