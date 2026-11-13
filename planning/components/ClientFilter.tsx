"use client";
// Filtro de clientes: un desplegable propio con el color de cada cliente (un circulito), igual en todas las pestañas.
// Puede elegir varios (Roadmap, RRSS, Resúmenes) o uno solo (Tareas, Exportar).
import { useEffect, useRef, useState } from "react";

export interface ClientOption {
  id: string;
  name: string;
  color?: string | null;
}

export function ClientFilter({
  options,
  value,
  onChange,
  multiple = true,
  allLabel = "Todos los clientes",
  extra = [],
}: {
  options: ClientOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** false: se elige uno solo (o todos) */
  multiple?: boolean;
  allLabel?: string;
  /** Opciones sin color al principio, p. ej. "Interno / sin cliente" */
  extra?: ClientOption[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const all = [...extra, ...options];
  const chosen = all.filter((o) => value.includes(o.id));
  const pick = (id: string) => {
    if (!multiple) {
      onChange(value[0] === id ? [] : [id]);
      setOpen(false);
    } else onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  const dot = (o: ClientOption) => <i className="cf-dot" style={{ background: o.color ?? "transparent", borderColor: o.color ?? "var(--muted)" }} />;

  return (
    <div className="cf" ref={box}>
      <button type="button" className={`cf-btn ${chosen.length ? "active" : ""}`} onClick={() => setOpen((x) => !x)} aria-haspopup="listbox" aria-expanded={open}>
        {chosen.length === 0 ? (
          <span className="cf-label">{allLabel}</span>
        ) : chosen.length === 1 ? (
          <span className="cf-label">
            {dot(chosen[0])}
            {chosen[0].name}
          </span>
        ) : (
          <span className="cf-label">
            <span className="cf-dots">{chosen.slice(0, 4).map((o) => <span key={o.id}>{dot(o)}</span>)}</span>
            {chosen.length} clientes
          </span>
        )}
        <span className="cf-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="cf-pop" role="listbox" aria-multiselectable={multiple}>
          <button
            type="button"
            role="option"
            aria-selected={!value.length}
            className={`cf-opt ${!value.length ? "on" : ""}`}
            onClick={() => {
              onChange([]);
              if (!multiple) setOpen(false);
            }}
          >
            <i className="cf-dot all" />
            {allLabel}
          </button>
          {all.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={value.includes(o.id)} className={`cf-opt ${value.includes(o.id) ? "on" : ""}`} onClick={() => pick(o.id)}>
              {dot(o)}
              <span className="cf-name">{o.name}</span>
              {value.includes(o.id) && <span className="cf-check">✓</span>}
            </button>
          ))}
          {multiple && value.length > 0 && (
            <div className="cf-foot">
              <button type="button" className="btn ghost sm" onClick={() => onChange([])}>
                Ver todos
              </button>
              <button type="button" className="btn sm" onClick={() => setOpen(false)}>
                Listo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
