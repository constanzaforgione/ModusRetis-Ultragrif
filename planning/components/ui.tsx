"use client";
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
