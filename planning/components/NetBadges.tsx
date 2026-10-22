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
