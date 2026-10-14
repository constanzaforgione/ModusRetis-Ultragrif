"use client";
import { useState } from "react";
import { useData } from "./DataProvider";
import { Avatar } from "./ui";
import { ROLE_LABEL, type Profile, type Role } from "@/lib/types";

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
                const open = tasks.filter((t) => t.assignee_id === p.id && t.status !== "hecha");
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
    </>
  );
}
