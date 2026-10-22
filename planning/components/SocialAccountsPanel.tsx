"use client";
// Cuentas de redes de cada cliente: conectar (login de la red), ver vencimientos y desconectar.
import { useEffect, useState } from "react";
import { useData } from "./DataProvider";
import { Modal, SidePanel } from "./ui";
import { NetBadges } from "./NetBadges";
import { NETWORKS } from "@/lib/social";
import { isStaff } from "@/lib/permissions";
import type { SocialAccount } from "@/lib/types";

const daysLeft = (iso: string | null) => (iso ? Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);

export function SocialAccountsPanel({ onClose, choose }: { onClose: () => void; choose?: string | null }) {
  const { me, clients, accounts, toast, reload } = useData();
  const staff = isStaff(me);
  const social = clients.filter((c) => c.social && c.active);

  async function disconnect(a: SocialAccount) {
    if (!confirm(`¿Desconectar ${a.username ? "@" + a.username : a.name}? Las piezas programadas de esa red van a quedar con error hasta que se vuelva a conectar.`)) return;
    const { supabaseBrowser } = await import("@/lib/supabase/client");
    const r = await supabaseBrowser().from("social_accounts").delete().eq("id", a.id);
    if (r.error) return toast(r.error.message, true);
    toast("Cuenta desconectada");
    reload("social_accounts");
  }

  return (
    <SidePanel title="Cuentas conectadas" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        Cada cliente conecta su cuenta una vez. Con la cuenta conectada, las piezas programadas salen solas a su hora. Las conexiones se renuevan solas; si alguna vence, aparece en rojo.
      </p>
      {!staff && <div className="notice">Solo admins y líderes conectan o desconectan cuentas.</div>}
      {social.map((c) => (
        <section key={c.id} className="acc-client">
          <h3>
            <i className="dot" style={{ background: c.color }} />
            {c.name}
          </h3>
          {NETWORKS.map((n) => {
            const a = accounts.find((x) => x.client_id === c.id && x.network === n.key);
            const left = daysLeft(a?.expires_at ?? null);
            return (
              <div key={n.key} className="acc-row">
                <NetBadges nets={[n.key]} />
                {a ? (
                  <>
                    {a.avatar_url ? <img className="acc-avatar" src={a.avatar_url} alt="" /> : null}
                    <div className="acc-main">
                      <b>{a.username ? `@${a.username}` : a.name}</b>
                      <small className={a.status !== "conectada" ? "late" : "muted"}>
                        {a.status !== "conectada" ? a.last_error || "Hay que volver a conectarla" : left !== null && left < 10 ? `La conexión vence en ${left} ${left === 1 ? "día" : "días"} (se renueva sola)` : n.label}
                      </small>
                    </div>
                    {staff && (
                      <div className="actions">
                        {a.status !== "conectada" && (
                          <a className="btn sm primary" href={`/api/social/connect/${n.key}?client=${c.id}`}>
                            Reconectar
                          </a>
                        )}
                        <button className="btn sm" onClick={() => disconnect(a)}>
                          Desconectar
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="acc-main">
                      <span className="muted">Sin conectar</span>
                    </div>
                    {staff && (
                      <a className="btn sm" href={`/api/social/connect/${n.key}?client=${c.id}`}>
                        Conectar {n.label}
                      </a>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </section>
      ))}
      <p className="meta-line">
        Instagram: cuenta profesional (empresa o creador). LinkedIn: quien conecta tiene que ser administrador de la página. TikTok: las publicaciones llegan a los borradores hasta que TikTok apruebe la publicación directa.
      </p>
      {choose && <LinkedInChooser pending={choose} onDone={() => (reload("social_accounts"), onClose())} />}
    </SidePanel>
  );
}

/** LinkedIn: la persona administra varias páginas; elegir la del cliente */
function LinkedInChooser({ pending, onDone }: { pending: string; onDone: () => void }) {
  const { toast } = useData();
  const [pages, setPages] = useState<{ id: string; name: string; username: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/social/linkedin-choose?pending=${pending}`)
      .then((r) => r.json())
      .then((b) => (b.pages ? setPages(b.pages) : setError(b.error ?? "Error")))
      .catch(() => setError("No se pudo cargar la lista de páginas"));
  }, [pending]);
  async function pick(page: string) {
    const r = await fetch("/api/social/linkedin-choose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pending, page }) });
    const b = await r.json();
    if (!r.ok) return toast(b.error ?? "Error", true);
    toast("Página de LinkedIn conectada");
    onDone();
  }
  return (
    <Modal title="¿Qué página de LinkedIn es la del cliente?" onClose={onDone}>
      {error && <div className="notice err">{error}</div>}
      {!pages && !error && <p className="muted">Cargando…</p>}
      <div className="acc-pick">
        {pages?.map((p) => (
          <button key={p.id} className="btn" onClick={() => pick(p.id)}>
            {p.name}
            {p.username ? <small className="muted"> · linkedin.com/company/{p.username}</small> : null}
          </button>
        ))}
      </div>
    </Modal>
  );
}
