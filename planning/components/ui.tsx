"use client";
import { useEffect } from "react";
import type { Client, Profile } from "@/lib/types";

const PALETTE = ["#304cd3", "#00a9b0", "#8b5cf6", "#e8930c", "#2f9e57", "#d64545", "#0ea5e9", "#db2777"];

export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function Avatar({ p, sm }: { p?: Profile; sm?: boolean }) {
  if (!p) return <span className={`avatar ${sm ? "sm" : ""}`} style={{ background: "var(--border)" }} />;
  return (
    <span className={`avatar ${sm ? "sm" : ""}`} style={{ background: colorFor(p.id) }} title={p.full_name}>
      {initials(p.full_name || p.email)}
    </span>
  );
}

/** Varias personas: avatares superpuestos (hasta `max`, después "+N") */
export function Avatars({ people, sm, max = 3 }: { people: (Profile | undefined)[]; sm?: boolean; max?: number }) {
  const list = people.filter(Boolean) as Profile[];
  if (list.length <= 1) return <Avatar p={list[0]} sm={sm} />;
  const shown = list.slice(0, max);
  return (
    <span className="avatars" title={list.map((p) => p.full_name).join(", ")}>
      {shown.map((p) => (
        <Avatar key={p.id} p={p} sm={sm} />
      ))}
      {list.length > max && <span className={`avatar more ${sm ? "sm" : ""}`}>+{list.length - max}</span>}
    </span>
  );
}

/** Nombres: "Yani", "Yani y Maxi", "Yani, Maxi y Coni" */
export function namesOf(people: (Profile | undefined)[], empty = "—") {
  const n = people.filter(Boolean).map((p) => p!.full_name);
  if (!n.length) return empty;
  return n.length === 1 ? n[0] : `${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`;
}

/** Corto, para listas: "Yani" o "Yani +2" */
export function shortNames(people: (Profile | undefined)[]) {
  const n = people.filter(Boolean).map((p) => p!.full_name);
  return n.length ? (n.length > 1 ? `${n[0]} +${n.length - 1}` : n[0]) : "—";
}

/** Elegir varias personas: chips con ✕ y un desplegable para sumar */
export function PeoplePicker({
  value,
  onChange,
  options,
  all,
  disabled,
  locked = [],
  emptyLabel = "Sin responsable",
  title,
  required = true,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** a quiénes se puede sumar */
  options: Profile[];
  /** para mostrar nombres de quienes ya están aunque no sean elegibles */
  all: Map<string, Profile>;
  disabled?: boolean;
  /** no se pueden sacar (p. ej. quienes participan por sus tareas) */
  locked?: string[];
  emptyLabel?: string;
  title?: string;
  /** siempre tiene que quedar al menos una persona */
  required?: boolean;
}) {
  const addable = options.filter((p) => !value.includes(p.id));
  return (
    <div className="people" title={title}>
      {value.length === 0 && <span className="muted">{emptyLabel}</span>}
      {value.map((id, i) => {
        const p = all.get(id);
        const canRemove = !disabled && !locked.includes(id) && (!required || value.length > 1);
        return (
          <span key={id} className="person-chip">
            <Avatar p={p} sm />
            {p?.full_name ?? "—"}
            {i === 0 && value.length > 1 && <small className="muted"> · principal</small>}
            {canRemove && (
              <button type="button" aria-label={`Sacar a ${p?.full_name ?? "esta persona"}`} onClick={() => onChange(value.filter((x) => x !== id))}>
                ✕
              </button>
            )}
          </span>
        );
      })}
      {!disabled && addable.length > 0 && (
        <select
          className="person-add"
          value=""
          aria-label="Agregar persona"
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        >
          <option value="">+ Agregar persona</option>
          {addable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function ClientTag({ c }: { c?: Client }) {
  if (!c) return <span className="client-tag muted">Interno</span>;
  return (
    <span className="client-tag">
      <i style={{ background: c.color }} />
      {c.name}
    </span>
  );
}

export const CLIENT_COLORS = ["#304cd3", "#00a9b0", "#e8b100", "#8b5cf6", "#714b67", "#2f9e57", "#e8930c", "#d64545", "#0ea5e9", "#db2777", "#111827"];

export function Modal({
  title,
  onClose,
  children,
  footer,
  side,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: boolean;
}) {
  return (
    <div
      className={`scrim ${side ? "" : "center"}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className={side ? "drawer" : "modal"} role="dialog" aria-modal="true">
        <div className="sheet-h">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="sheet-b">{children}</div>
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Panel lateral derecho, sin tapar la pantalla: la lista sigue visible y clickeable al lado,
 * así se puede pasar de una tarea a otra sin cerrar. Esc o ✕ lo cierran.
 */
export function SidePanel({
  title,
  onClose,
  children,
  footer,
  back,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Flecha arriba a la izquierda para volver a lo que se estaba viendo (ej.: el proyecto) */
  back?: { label: string; onClick: () => void };
}) {
  useEffect(() => {
    document.body.classList.add("has-side");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("has-side");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <aside className="side" role="complementary" aria-label={typeof title === "string" ? title : "Detalle"}>
      <div className="sheet-h">
        <div className="side-title">
          {back && (
            <button className="back" onClick={back.onClick} aria-label={`Volver a ${back.label}`} title={`Volver a ${back.label}`}>
              ←
            </button>
          )}
          <div style={{ minWidth: 0 }}>
            {back && <div className="crumb">{back.label}</div>}
            <h2>{title}</h2>
          </div>
        </div>
        <button className="btn ghost sm" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)">
          ✕
        </button>
      </div>
      <div className="sheet-b">{children}</div>
      {footer && <div className="sheet-f">{footer}</div>}
    </aside>
  );
}
