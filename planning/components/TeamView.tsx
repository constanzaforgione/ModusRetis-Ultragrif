"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useData } from "./DataProvider";
import { Avatar } from "./ui";
import { ROLE_LABEL, type Profile, type Role } from "@/lib/types";
import { hasPerson } from "@/lib/people";

export function TeamView() {
  const { me, profiles, tasks, today, save, toast, reload } = useData();
  const admin = me.role === "admin";
  const [name, setName] = useState(me.full_name);
  const [add, setAdd] = useState({ full_name: "", email: "", role: "miembro" as Role, lead_id: "" });
  const [adding, setAdding] = useState(false);

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    const res = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(add) });
    const body = await res.json().catch(() => ({}));
    setAdding(false);
    if (!res.ok) return toast(body.error ?? "No se pudo sumar a la persona", true);
    toast(`${add.full_name} ya está en el equipo: le podés asignar tareas`);
    setAdd({ full_name: "", email: "", role: "miembro", lead_id: "" });
    reload("profiles");
  }

  async function update(p: Profile, patch: Partial<Profile>) {
    const { error } = await save<Profile>("profiles", { id: p.id, ...patch });
    toast(error ?? "Guardado", !!error);
  }

  const leads = profiles.filter((p) => p.active && (p.role === "lider" || p.role === "admin"));
  const sorted = [...profiles].sort((a, b) => Number(b.active) - Number(a.active) || a.full_name.localeCompare(b.full_name));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Equipo</div>
          <h1>
            Roles y <em>permisos</em>
          </h1>
        </div>
      </div>

      <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "1 1 220px" }}>
          <span>Mi nombre</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn" onClick={() => update(me, { full_name: name.trim() })} disabled={!name.trim() || name === me.full_name}>
          Guardar nombre
        </button>
        <label className="toggle">
          <input type="checkbox" checked={me.email_alerts} onChange={(e) => update(me, { email_alerts: e.target.checked })} /> Recibir alertas por mail
        </label>
      </div>

      {admin && (
        <form className="panel" onSubmit={addPerson} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <h2>Sumar a alguien</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              Queda cargada al instante para asignarle tareas, aunque todavía no haya entrado. Después le pasás el link de la app y entra con ese mismo mail.
            </div>
          </div>
          <div className="grid4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <label className="field">
              <span>Nombre</span>
              <input type="text" required value={add.full_name} onChange={(e) => setAdd({ ...add, full_name: e.target.value })} placeholder="Ej: Yanina" />
            </label>
            <label className="field">
              <span>Mail</span>
              <input type="email" required value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} placeholder="yani@modusretis.com" />
            </label>
            <label className="field">
              <span>Rol</span>
              <select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as Role })}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Líder</span>
              <select value={add.lead_id} onChange={(e) => setAdd({ ...add, lead_id: e.target.value })}>
                <option value="">—</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.full_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <button className="btn primary" disabled={adding}>
              {adding ? "Sumando…" : "+ Sumar al equipo"}
            </button>
          </div>
        </form>
      )}

      <div className="panel">
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          <b>Admin</b>: todo, incluido borrar y cambiar roles. <b>Líder</b>: edita el roadmap, asigna tareas a cualquiera y gestiona las de su equipo.{" "}
          <b>Miembro</b>: crea y edita solo sus tareas. Todos ven todo.
          {!admin && " Solo un admin puede cambiar roles."}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Rol</th>
                <th>Líder</th>
                <th>Abiertas</th>
                <th>Vencidas</th>
                <th>Activa</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const open = tasks.filter((t) => hasPerson(t, p.id) && t.status !== "hecha");
                const late = open.filter((t) => t.due_date && t.due_date < today).length;
                return (
                  <tr key={p.id} style={{ opacity: p.active ? 1 : 0.55 }}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Avatar p={p} />
                        <div>
                          <b>{p.full_name}</b>
                          {p.id === me.id && <span className="muted"> (vos)</span>}
                          <div className="muted" style={{ fontSize: 12 }}>
                            {p.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Rol">
                      {admin && p.id !== me.id ? (
                        <select value={p.role} onChange={(e) => update(p, { role: e.target.value as Role })}>
                          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        ROLE_LABEL[p.role]
                      )}
                    </td>
                    <td data-label="Líder">
                      {admin && p.role !== "admin" ? (
                        <select value={p.lead_id ?? ""} onChange={(e) => update(p, { lead_id: e.target.value || null })}>
                          <option value="">—</option>
                          {leads
                            .filter((l) => l.id !== p.id)
                            .map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.full_name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        (p.lead_id && profiles.find((l) => l.id === p.lead_id)?.full_name) || "—"
                      )}
                    </td>
                    <td data-label="Abiertas" className="mono">{open.length}</td>
                    <td data-label="Vencidas" className={`mono ${late ? "late" : ""}`}>{late}</td>
                    <td data-label="Activa">
                      <input
                        type="checkbox"
                        checked={p.active}
                        disabled={!admin || p.id === me.id}
                        onChange={(e) => update(p, { active: e.target.checked })}
                        aria-label="Cuenta activa"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          También pueden entrar solos con su mail de trabajo: aparecen acá como Miembro y un admin les asigna rol y líder.
        </p>
      </div>
      {admin && <DeletionLog />}
    </>
  );
}

const KIND: Record<string, string> = {
  social_posts: "Pieza de redes",
  tasks: "Tarea",
  projects: "Proyecto",
  clients: "Cliente",
  recurring_tasks: "Tarea que se repite",
  monthly_summaries: "Resumen mensual",
};

interface Deletion {
  id: number;
  table_name: string;
  title: string;
  client_id: string | null;
  deleted_by: string | null;
  deleted_at: string;
  row_data: Record<string, unknown>;
}

/** Lo que se borró, quién y cuándo (lo registra la base sola; solo lo ven admins) */
function DeletionLog() {
  const { byId } = useData();
  const [rows, setRows] = useState<Deletion[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [kind, setKind] = useState("");
  useEffect(() => {
    supabaseBrowser()
      .from("deletion_log")
      .select("id, table_name, title, client_id, deleted_by, deleted_at, row_data")
      .order("deleted_at", { ascending: false })
      .limit(200)
      .then(({ data, error }: { data: unknown[] | null; error: unknown }) => {
        if (error) setMissing(true);
        else setRows((data ?? []) as Deletion[]);
      });
  }, []);
  const when = (iso: string) =>
    new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  const detail = (r: Deletion) => {
    const d = r.row_data;
    const date = (d.publish_date ?? d.due_date ?? d.month ?? d.start_date) as string | undefined;
    return [date, d.status as string | undefined].filter(Boolean).join(" · ");
  };
  const list = (rows ?? []).filter((r) => !kind || r.table_name === kind);
  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2>Registro de borrados</h2>
        {rows && rows.length > 0 && (
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Qué se borró">
            <option value="">Todo</option>
            {Object.entries(KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
        Cada vez que alguien borra algo queda acá qué era, quién lo borró y cuándo. Solo lo ven los admins y no se puede borrar.
      </p>
      {missing ? (
        <div className="notice">Falta correr en Supabase el SQL del registro de borrados (0013).</div>
      ) : !rows ? (
        <div className="muted">Cargando…</div>
      ) : !list.length ? (
        <div className="empty">Todavía no se borró nada.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Quién</th>
                <th>Qué</th>
                <th>Cliente</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{when(r.deleted_at)}</td>
                  <td>{r.deleted_by ? (byId.profile.get(r.deleted_by)?.full_name ?? "—") : "Sistema"}</td>
                  <td>
                    <span className="muted">{KIND[r.table_name] ?? r.table_name}:</span> <b>{r.title || "Sin título"}</b>
                    {detail(r) && <span className="muted"> · {detail(r)}</span>}
                  </td>
                  <td>{r.client_id ? (byId.client.get(r.client_id)?.name ?? "Cliente borrado") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
