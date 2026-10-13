"use client";
import { useState } from "react";
import { useData } from "./DataProvider";
import { Avatar } from "./ui";
import { ROLE_LABEL, type Profile, type Role } from "@/lib/types";

export function TeamView() {
  const { me, profiles, tasks, today, save, toast } = useData();
  const admin = me.role === "admin";
  const [name, setName] = useState(me.full_name);

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

      <div className="panel">
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          <b>Admin</b>: todo, incluido borrar y cambiar roles. <b>Líder</b>: edita el roadmap y las tareas de su equipo. <b>Miembro</b>: crea y edita solo sus
          tareas. Todos ven todo.
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
                    <td>
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
                    <td>
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
                    <td className="mono">{open.length}</td>
                    <td className={`mono ${late ? "late" : ""}`}>{late}</td>
                    <td>
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
          Para sumar a alguien, que entre con su mail de trabajo: aparece acá como Miembro y un admin le asigna rol y líder.
        </p>
      </div>
    </>
  );
}
