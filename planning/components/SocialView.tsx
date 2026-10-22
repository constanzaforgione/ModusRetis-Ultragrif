"use client";
// RRSS: calendario de publicaciones de los clientes con redes. Cada cliente se ve con el mismo formato
// (grilla del mes o lista), se filtra por cliente y por red, y cada pieza se abre en el panel lateral.
import { useEffect, useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { Avatar } from "./ui";
import { NetBadges } from "./NetBadges";
import { SocialPostDrawer, type PostDraft } from "./SocialPostDrawer";
import { SocialImportDialog } from "./SocialImportDialog";
import { SocialAccountsPanel } from "./SocialAccountsPanel";
import { addDays, addMonths, fmtMonth, hhmm, startOfMonth, startOfWeek, weekday } from "@/lib/dates";
import { FORMAT_LABEL, NETWORKS, POST_STATUS, POST_STATUS_META } from "@/lib/social";
import { isStaff } from "@/lib/permissions";
import type { Client, Network, PostStatus, SocialPost, SocialPublication } from "@/lib/types";

const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MAX_IN_CELL = 4;

/** Cómo va la publicación automática de una pieza, en un ícono */
export function pubMark(pubs: SocialPublication[]): { icon: string; title: string } | null {
  if (!pubs.length) return null;
  if (pubs.some((x) => x.status === "error")) return { icon: "⚠", title: "No se pudo publicar en alguna red" };
  if (pubs.some((x) => x.status === "manual")) return { icon: "✋", title: "Hay que terminarla a mano en alguna red" };
  if (pubs.every((x) => x.status === "publicada")) return { icon: "✓", title: "Publicada en todas sus redes" };
  if (pubs.some((x) => x.status === "procesando")) return { icon: "↻", title: "Publicándose" };
  return { icon: "⏱", title: "Programada: sale sola" };
}

function PostChip({ p, client, onOpen, showClient, sel, pubs }: { p: SocialPost; client?: Client; onOpen: () => void; showClient?: boolean; sel?: boolean; pubs: SocialPublication[] }) {
  const mark = pubMark(pubs);
  return (
    <button
      className={`post-chip st-${p.status} ${sel ? "sel" : ""}`}
      style={{ borderLeftColor: client?.color ?? "var(--border)" }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      data-hover-post={p.id}
    >
      <NetBadges nets={p.networks} />
      {p.publish_time && <span className="mono">{hhmm(p.publish_time)}</span>}
      <span className="t">
        {showClient && client ? <b>{client.name} · </b> : null}
        {p.title}
      </span>
      {mark && (
        <span className={`pub-mark ${mark.icon === "⚠" ? "bad" : ""}`} title={mark.title}>
          {mark.icon}
        </span>
      )}
      <i className={`st-dot ${POST_STATUS_META[p.status].pill}`} title={POST_STATUS_META[p.status].label} />
    </button>
  );
}

export function SocialView() {
  const { me, clients, posts, publications, accounts, today, byId, loading, toast } = useData();
  const [showAccounts, setShowAccounts] = useState(false);
  const [choose, setChoose] = useState<string | null>(null);
  const socialClients = clients.filter((c) => c.social && c.active);
  const [onlyClients, setOnlyClients] = useState<Set<string>>(new Set());
  const [onlyNets, setOnlyNets] = useState<Set<Network>>(new Set());
  const [status, setStatus] = useState<PostStatus | "">("");
  const [layout, setLayout] = useState<"separados" | "juntos">("separados");
  const [view, setView] = useState<"mes" | "lista">("mes");
  const [anchor, setAnchor] = useState(startOfMonth(today));
  const [open, setOpen] = useState<PostDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [mobile, setMobile] = useState(false);

  // Recordar filtros de esta persona
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("mr-rrss") ?? "{}");
      if (s.clients) setOnlyClients(new Set(s.clients));
      if (s.nets) setOnlyNets(new Set(s.nets));
      if (s.layout) setLayout(s.layout);
      if (s.view) setView(s.view);
    } catch {}
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("mr-rrss", JSON.stringify({ clients: [...onlyClients], nets: [...onlyNets], layout, view }));
    } catch {}
  }, [onlyClients, onlyNets, layout, view]);

  // Links directos: /rrss?pieza=<id> abre la pieza en su mes; /rrss?cliente=<id> filtra
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = posts.find((x) => x.id === q.get("pieza"));
    if (p) {
      setOpen(p);
      setAnchor(startOfMonth(p.publish_date));
    }
    const c = q.get("cliente");
    if (c) setOnlyClients(new Set([c]));
    // Vuelta de conectar una cuenta: /rrss?cuentas=1&ok=instagram | &error=… | &elegir=<id>
    if (q.get("cuentas")) {
      setShowAccounts(true);
      if (q.get("ok")) toast(`Cuenta de ${q.get("ok")} conectada`);
      if (q.get("error")) toast(q.get("error")!, true);
      if (q.get("elegir")) setChoose(q.get("elegir"));
    }
    if ((p || c || q.get("cuentas")) && window.location.search) window.history.replaceState(null, "", window.location.pathname);
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; id: string }>).detail;
      const x = d.key === "pieza" ? posts.find((y) => y.id === d.id) : undefined;
      if (x) {
        setOpen(x);
        setAnchor(startOfMonth(x.publish_date));
      }
    };
    window.addEventListener("mr-open", onOpen);
    return () => window.removeEventListener("mr-open", onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts.length]);

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    apply(n);
  };

  const visibleClients = socialClients.filter((c) => !onlyClients.size || onlyClients.has(c.id));
  const filtered = useMemo(
    () =>
      posts.filter(
        (p) =>
          visibleClients.some((c) => c.id === p.client_id) &&
          (!onlyNets.size || p.networks.some((n) => onlyNets.has(n))) &&
          (!status || p.status === status),
      ),
    [posts, visibleClients, onlyNets, status],
  );

  const monthStart = startOfMonth(anchor);
  const monthEnd = addMonths(monthStart, 1);
  const inMonth = filtered.filter((p) => p.publish_date >= monthStart && p.publish_date < monthEnd);
  const gridStart = startOfWeek(monthStart);
  const weeks = Math.ceil((weekday(monthStart) + Number(addDays(monthEnd, -1).slice(8))) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));

  const groups: { key: string; client?: Client; posts: SocialPost[] }[] =
    layout === "juntos" || visibleClients.length <= 1
      ? [{ key: "todos", client: visibleClients.length === 1 ? visibleClients[0] : undefined, posts: inMonth }]
      : visibleClients.map((c) => ({ key: c.id, client: c, posts: inMonth.filter((p) => p.client_id === c.id) }));

  const newPost = (date: string, client?: Client) =>
    setOpen({ publish_date: date, client_id: client?.id ?? (visibleClients.length === 1 ? visibleClients[0].id : undefined), networks: onlyNets.size ? NETWORKS.map((n) => n.key).filter((k) => onlyNets.has(k)) : ["instagram"] });

  const summary = (list: SocialPost[]) => {
    const per = NETWORKS.map((n) => [n, list.filter((p) => p.networks.includes(n.key)).length] as const).filter(([, k]) => k > 0);
    const pub = list.filter((p) => p.status === "publicada").length;
    return (
      <span className="muted cal-sum">
        {list.length} {list.length === 1 ? "pieza" : "piezas"}
        {per.map(([n, k]) => (
          <span key={n.key}>
            {" · "}
            <NetBadges nets={[n.key]} /> {k}
          </span>
        ))}
        {list.length > 0 && ` · ${pub} publicadas`}
      </span>
    );
  };

  const showList = view === "lista" || mobile;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Redes sociales</div>
          <h1>
            Calendario de <em>contenidos</em>
          </h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {monthPieces(inMonth.length)} en {fmtMonth(monthStart, true)}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setShowAccounts(true)} title="Cuentas de Instagram, LinkedIn y TikTok de cada cliente">
            🔗 Cuentas{accounts.some((a) => a.status !== "conectada") ? " ⚠" : ""}
          </button>
          <button className="btn" onClick={() => setImporting(true)} disabled={!socialClients.length}>
            ⇪ Importar HTML
          </button>
          <button className="btn primary" onClick={() => newPost(today >= monthStart && today < monthEnd ? today : monthStart)} disabled={!socialClients.length}>
            + Programar pieza
          </button>
        </div>
      </div>

      <div className="filters">
        <div className="field">
          <span>Mes</span>
          <div className="seg">
            <button onClick={() => setAnchor(addMonths(monthStart, -1))} aria-label="Mes anterior">
              ←
            </button>
            <button onClick={() => setAnchor(startOfMonth(today))}>Hoy</button>
            <button onClick={() => setAnchor(addMonths(monthStart, 1))} aria-label="Mes siguiente">
              →
            </button>
          </div>
        </div>
        <div className="field">
          <span>Vista</span>
          <div className="seg">
            <button className={view === "mes" ? "on" : ""} onClick={() => setView("mes")} disabled={mobile} title={mobile ? "En el celular se ve como lista" : undefined}>
              Mes
            </button>
            <button className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>
              Lista
            </button>
          </div>
        </div>
        {visibleClients.length > 1 && (
          <div className="field">
            <span>Calendarios</span>
            <div className="seg">
              <button className={layout === "separados" ? "on" : ""} onClick={() => setLayout("separados")} title="Un calendario por cliente">
                Separados
              </button>
              <button className={layout === "juntos" ? "on" : ""} onClick={() => setLayout("juntos")} title="Todos en un mismo calendario">
                Juntos
              </button>
            </div>
          </div>
        )}
        <div className="field">
          <span>Estado</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as PostStatus | "")}>
            <option value="">Todos</option>
            {POST_STATUS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 260px" }}>
          <span>Cliente</span>
          <div className="chips one-line">
            {socialClients.map((c) => (
              <button key={c.id} className={`chip ${onlyClients.has(c.id) ? "on" : ""}`} onClick={() => toggle(onlyClients, c.id, setOnlyClients)}>
                <i style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
            {onlyClients.size > 0 && (
              <button className="btn ghost sm" onClick={() => setOnlyClients(new Set())}>
                Ver todos
              </button>
            )}
          </div>
        </div>
        <div className="field" style={{ flex: "1 1 260px" }}>
          <span>Redes</span>
          <div className="chips one-line">
            {NETWORKS.map((n) => (
              <button key={n.key} className={`chip ${onlyNets.has(n.key) ? "on" : ""}`} onClick={() => toggle(onlyNets, n.key, setOnlyNets)} aria-pressed={onlyNets.has(n.key)}>
                <NetBadges nets={[n.key]} plain={onlyNets.has(n.key)} />
                {n.label}
              </button>
            ))}
            {onlyNets.size > 0 && (
              <button className="btn ghost sm" onClick={() => setOnlyNets(new Set())}>
                Todas
              </button>
            )}
          </div>
        </div>
      </div>

      {!socialClients.length && !loading ? (
        <div className="empty">
          Todavía no hay clientes con calendario de redes.
          {isStaff(me) ? " En Roadmap → editar cliente, marcá “Tiene calendario de redes”." : " Pedile a un admin o líder que los marque."}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="rrss-cal">
            <div className="rrss-h">
              <b className="cal-title">
                {g.client ? (
                  <>
                    <i className="dot" style={{ background: g.client.color }} />
                    {g.client.name}
                  </>
                ) : (
                  "Todos los clientes"
                )}
                <span className="muted"> · {fmtMonth(monthStart, true)}</span>
              </b>
              {summary(g.posts)}
            </div>
            {showList ? (
              <AgendaList posts={g.posts} showClient={!g.client} onOpen={setOpen} selected={open?.id} onNew={(d) => newPost(d, g.client)} monthStart={monthStart} monthEnd={monthEnd} />
            ) : (
              <div className="cal-month rrss-month">
                {DOW.map((d) => (
                  <div key={d} className="cal-dow">
                    {d}
                  </div>
                ))}
                {days.map((d) => {
                  const list = g.posts.filter((p) => p.publish_date === d).sort((a, b) => (a.publish_time ?? "99").localeCompare(b.publish_time ?? "99"));
                  return (
                    <div
                      key={d}
                      className={`cal-cell ${d < monthStart || d >= monthEnd ? "out" : ""} ${d === today ? "today" : ""} ${weekday(d) > 4 ? "we" : ""}`}
                      onClick={() => newPost(d, g.client)}
                      title="Clic en un espacio libre para programar una pieza ese día"
                    >
                      <span className="cal-num">{Number(d.slice(8))}</span>
                      {list.slice(0, MAX_IN_CELL).map((p) => (
                        <PostChip key={p.id} p={p} client={byId.client.get(p.client_id)} onOpen={() => setOpen(p)} showClient={!g.client} sel={open?.id === p.id} pubs={publications.filter((x) => x.post_id === p.id)} />
                      ))}
                      {list.length > MAX_IN_CELL && (
                        <button
                          className="cal-more"
                          onClick={(e) => {
                            e.stopPropagation();
                            setView("lista");
                          }}
                        >
                          +{list.length - MAX_IN_CELL} más
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))
      )}

      {open && <SocialPostDrawer key={open.id ?? `new-${open.publish_date}`} post={open} onClose={() => setOpen(null)} />}
      {showAccounts && !open && <SocialAccountsPanel onClose={() => (setShowAccounts(false), setChoose(null))} choose={choose} />}
      {importing && <SocialImportDialog onClose={() => setImporting(false)} onDone={(month) => month && setAnchor(startOfMonth(month))} />}
    </>
  );
}

const monthPieces = (n: number) => (n === 1 ? "1 pieza" : `${n} piezas`);

function AgendaList({
  posts,
  showClient,
  onOpen,
  onNew,
  selected,
  monthStart,
  monthEnd,
}: {
  posts: SocialPost[];
  showClient: boolean;
  onOpen: (p: SocialPost) => void;
  onNew: (d: string) => void;
  selected?: string;
  monthStart: string;
  monthEnd: string;
}) {
  const { byId, today, publications } = useData();
  const byDay = new Map<string, SocialPost[]>();
  for (const p of [...posts].sort((a, b) => a.publish_date.localeCompare(b.publish_date) || (a.publish_time ?? "99").localeCompare(b.publish_time ?? "99")))
    byDay.set(p.publish_date, [...(byDay.get(p.publish_date) ?? []), p]);
  if (!byDay.size)
    return (
      <div className="empty">
        No hay piezas este mes con estos filtros.{" "}
        <button className="btn sm" onClick={() => onNew(today >= monthStart && today < monthEnd ? today : monthStart)}>
          + Programar una
        </button>
      </div>
    );
  return (
    <div className="rrss-list">
      {[...byDay.entries()].map(([d, list]) => (
        <div key={d} className={`rrss-day ${d === today ? "today" : ""} ${d < today ? "past" : ""}`}>
          <div className="rrss-date">
            <b>{Number(d.slice(8))}</b>
            <span>{DOW[weekday(d)]}</span>
          </div>
          <div className="rrss-items">
            {list.map((p) => {
              const c = byId.client.get(p.client_id);
              const who = p.assignee_id ? byId.profile.get(p.assignee_id) : undefined;
              return (
                <div key={p.id} className={`rrss-row ${selected === p.id ? "sel" : ""}`} style={{ borderLeftColor: c?.color }} onClick={() => onOpen(p)} data-hover-post={p.id}>
                  <NetBadges nets={p.networks} />
                  <div className="rrss-main">
                    <b>{p.title}</b>
                    <small className="muted">
                      {showClient && c ? `${c.name} · ` : ""}
                      {FORMAT_LABEL[p.format]}
                      {p.publish_time ? ` · ${hhmm(p.publish_time)}` : ""}
                      {p.pillar ? ` · ${p.pillar}` : ""}
                    </small>
                  </div>
                  {(() => {
                    const mark = pubMark(publications.filter((x) => x.post_id === p.id));
                    return mark ? (
                      <span className={`pub-mark ${mark.icon === "⚠" ? "bad" : ""}`} title={mark.title}>
                        {mark.icon}
                      </span>
                    ) : null;
                  })()}
                  {who && <Avatar p={who} sm />}
                  <span className={`pill ${POST_STATUS_META[p.status].pill}`}>{POST_STATUS_META[p.status].label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
