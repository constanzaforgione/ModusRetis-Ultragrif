"use client";
// Exportar tareas por período, colaboradores y cliente: un texto para pegar en Claude (que arma el resumen
// para ClickUp) o un CSV. No llama a ninguna IA desde la app: se copia y se pega.
import { useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { Modal, PeoplePicker } from "./ui";
import { addDays, addMonths, startOfMonth } from "@/lib/dates";
import { claudePrompt, selectTasks, toCSV, type ExportFilters } from "@/lib/exportTasks";

export function TaskExportDialog({ onClose, initial }: { onClose: () => void; initial?: Partial<ExportFilters> }) {
  const { tasks, clients, profiles, today, byId, toast } = useData();
  // Por defecto, el mes pasado (lo habitual para el resumen mensual)
  const lastMonth = addMonths(startOfMonth(today), -1);
  const [f, setF] = useState<ExportFilters>({
    from: lastMonth,
    to: addDays(startOfMonth(today), -1),
    people: [],
    client_id: null,
    include: "todas",
    ...initial,
  });
  const [audience, setAudience] = useState<"cliente" | "interno">("cliente");
  const set = (p: Partial<ExportFilters>) => setF((x) => ({ ...x, ...p }));

  const look = useMemo(
    () => ({
      client: (id: string | null) => (id ? (byId.client.get(id)?.name ?? null) : null),
      project: (id: string | null) => {
        const p = id ? byId.project.get(id) : undefined;
        return p ? { name: p.name, client_id: p.client_id } : null;
      },
      person: (id: string) => byId.profile.get(id)?.full_name ?? "—",
    }),
    [byId],
  );
  const list = useMemo(() => selectTasks(tasks, f, look), [tasks, f, look]);
  const prompt = useMemo(() => claudePrompt(list, f, look, { audience }), [list, f, look, audience]);
  const done = list.filter((t) => t.status === "hecha").length;

  const fileBase = `tareas-${(f.client_id ? look.client(f.client_id) : "todos") ?? "todos"}-${f.from}-a-${f.to}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const download = (name: string, text: string, type: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([type.includes("csv") ? "﻿" + text : text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      toast("Copiado: pegalo en Claude");
    } catch {
      toast("No se pudo copiar: seleccioná el texto y copialo a mano", true);
    }
  }
  const quick = (from: string, to: string) => set({ from, to });
  const thisMonth = startOfMonth(today);

  return (
    <Modal
      title="Exportar tareas para un resumen"
      onClose={onClose}
      footer={
        <>
          <div className="actions">
            <button className="btn" onClick={() => download(`${fileBase}.csv`, toCSV(list, look), "text/csv;charset=utf-8")} disabled={!list.length}>
              ⇩ CSV
            </button>
            <button className="btn" onClick={() => download(`${fileBase}.md`, prompt, "text/markdown;charset=utf-8")} disabled={!list.length}>
              ⇩ Texto
            </button>
          </div>
          <div className="actions">
            <a className="btn" href="https://claude.ai/new" target="_blank" rel="noreferrer">
              Abrir Claude ↗
            </a>
            <button className="btn primary" onClick={copy} disabled={!list.length}>
              Copiar para Claude
            </button>
          </div>
        </>
      }
    >
      <div className="grid2">
        <label className="field">
          <span>Desde</span>
          <input type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        </label>
        <label className="field">
          <span>Hasta</span>
          <input type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
        </label>
      </div>
      <div className="chips">
        <button className="chip" onClick={() => quick(lastMonth, addDays(thisMonth, -1))}>
          Mes pasado
        </button>
        <button className="chip" onClick={() => quick(thisMonth, addDays(addMonths(thisMonth, 1), -1))}>
          Este mes
        </button>
        <button className="chip" onClick={() => quick(addDays(today, -6), today)}>
          Últimos 7 días
        </button>
      </div>
      <div className="grid2">
        <label className="field">
          <span>Cliente</span>
          <select value={f.client_id ?? ""} onChange={(e) => set({ client_id: e.target.value || null })}>
            <option value="">Todos los clientes</option>
            {clients
              .filter((c) => c.active || c.id === f.client_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Tareas</span>
          <select value={f.include} onChange={(e) => set({ include: e.target.value as ExportFilters["include"] })}>
            <option value="todas">Cerradas en el período y las abiertas</option>
            <option value="hechas">Solo las cerradas en el período</option>
          </select>
        </label>
      </div>
      <div className="field">
        <span>Colaboradores</span>
        <PeoplePicker value={f.people} onChange={(ids) => set({ people: ids })} options={profiles.filter((p) => p.active)} all={byId.profile} required={false} emptyLabel="Todo el equipo" />
      </div>
      <div className="field">
        <span>El resumen es para</span>
        <div className="seg">
          <button className={audience === "cliente" ? "on" : ""} onClick={() => setAudience("cliente")}>
            El cliente
          </button>
          <button className={audience === "interno" ? "on" : ""} onClick={() => setAudience("interno")}>
            Uso interno
          </button>
        </div>
      </div>
      <div className="notice">
        {list.length ? (
          <>
            <b>{list.length}</b> {list.length === 1 ? "tarea" : "tareas"} ({done} {done === 1 ? "cerrada" : "cerradas"}, {list.length - done} abiertas). Copiá el texto, pegalo en Claude y te
            devuelve el resumen en Markdown para pegar en ClickUp.
          </>
        ) : (
          "No hay tareas con esos filtros."
        )}
      </div>
      <textarea className="sum-text" readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} aria-label="Texto para Claude" style={{ minHeight: 220 }} />
    </Modal>
  );
}
