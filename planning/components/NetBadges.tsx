import { NETWORK } from "@/lib/social";
import type { Network } from "@/lib/types";

/** Íconos de red: IG / in / TT con el color de cada una */
export function NetBadges({ nets, plain }: { nets: Network[]; plain?: boolean }) {
  return (
    <span className="nets" aria-label={nets.map((n) => NETWORK[n]?.label).join(", ")}>
      {nets.map((n) => (
        <i key={n} className={`net ${plain ? "plain" : ""}`} style={plain ? undefined : { background: NETWORK[n]?.color }} title={NETWORK[n]?.label}>
          {NETWORK[n]?.short}
        </i>
      ))}
    </span>
  );
}

/** Logo de cada red (dibujo simple, toma el color del texto) */
export function NetLogo({ net, size = 18 }: { net: Network; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (net === "instagram")
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  if (net === "linkedin")
    return (
      <svg {...common} fill="currentColor">
        <circle cx="5.6" cy="5.4" r="2.2" />
        <rect x="3.6" y="9" width="4" height="11.5" rx="0.6" />
        <path d="M10 9h3.8v1.7c.6-1.1 2-2 3.8-2 3.7 0 4.4 2.4 4.4 5.6v6.2h-4v-5.4c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8v5.5H10z" />
      </svg>
    );
  return (
    <svg {...common} fill="currentColor">
      <path d="M16.6 2.5c.4 2.2 1.9 3.8 4.1 4v3.3a7.7 7.7 0 0 1-4.1-1.3v6.6a6 6 0 1 1-5.9-6v3.4a2.7 2.7 0 1 0 2.5 2.7V2.5z" />
    </svg>
  );
}

/** Filtro de redes: un círculo por red con su logo */
export function NetFilter({ value, onChange }: { value: Set<Network>; onChange: (v: Set<Network>) => void }) {
  return (
    <div className="net-filter" role="group" aria-label="Redes">
      {Object.values(NETWORK).map((n) => {
        const on = value.has(n.key);
        return (
          <button
            key={n.key}
            type="button"
            className={`net-round net-${n.key} ${on ? "on" : ""}`}
            // TikTok va en el color del texto (negro en claro, blanco en oscuro)
            style={n.key === "tiktok" ? undefined : { ["--net" as string]: n.color }}
            aria-pressed={on}
            title={on ? `Mostrando ${n.label} (clic para quitar)` : `Ver solo ${n.label}`}
            aria-label={n.label}
            onClick={() => {
              const next = new Set(value);
              if (on) next.delete(n.key);
              else next.add(n.key);
              onChange(next);
            }}
          >
            <NetLogo net={n.key} />
          </button>
        );
      })}
    </div>
  );
}
