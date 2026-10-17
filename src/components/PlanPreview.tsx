import type { ApercuMode, PlanResult, PlanLot } from "@/lib/morcellement-v11";

/** Mélange un token de thème (oklch) avec du transparent — compatible charte actuelle. */
const tint = (token: string, pct: number) => `color-mix(in oklab, var(${token}) ${pct}%, transparent)`;

/** Aperçu vectoriel du morcellement (géométrie réelle du moteur). */
export function PlanPreview({
  plan, mode, selected, assigned, onSelect, reference,
}: {
  plan: PlanResult;
  mode: ApercuMode;
  selected?: string | null;
  assigned?: Record<string, { nom: string; compte: string }>;
  onSelect?: (code: string) => void;
  reference: string;
}) {
  const dim = (l: PlanLot) => {
    if (mode === "entreprise" && l.kind === "lot" && l.part !== "ac") return true;
    if (mode === "client" && l.kind === "lot" && l.code !== selected) return true;
    return false;
  };

  const fill = (l: PlanLot) => {
    if (l.kind === "reserve") return tint("--accent", 22);
    if (l.kind === "collecte") return tint("--warn", 30);
    if (!l.conforme) return tint("--destructive", 24);
    if (l.part === "ac") return tint("--primary", 24);
    return tint("--secondary", 18);
  };

  return (
    <svg viewBox="-9 -10 126 142" className="block w-full h-full" role="img" aria-label={`Plan d'aménagement ${reference}, vue ${mode}`}>
      <defs>
        <pattern id="acre-grid" width="5" height="5" patternUnits="userSpaceOnUse">
          <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#64748b" strokeOpacity="0.12" strokeWidth="0.12" />
        </pattern>
        <filter id="acre-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0.3" dy="0.5" stdDeviation="0.45" floodColor="#0f172a" floodOpacity="0.16" />
        </filter>
      </defs>
      <rect x="-9" y="-10" width="126" height="142" rx="2" fill="#f8fafc" />
      <rect x="-9" y="-10" width="126" height="142" fill="url(#acre-grid)" />
      <g filter="url(#acre-shadow)">
        <polygon points={plan.parcelle.map((p) => p.join(",")).join(" ")}
          fill="#dce8d4" stroke="#243b2b" strokeWidth="0.85" strokeLinejoin="round" />
      </g>

      {plan.voies.map((v, i) => {
        const points = v.poly.map((p) => p.join(",")).join(" ");
        return (
          <g key={`v${i}`}>
            <polygon points={points} fill="none" stroke="#f8f1d8" strokeWidth="2.2" strokeLinejoin="round" />
            <polygon points={points} fill="#77758e" stroke="#55536e" strokeWidth="0.45" strokeLinejoin="round" />
          </g>
        );
      })}

      {plan.lots.map((l) => {
        const xs = l.poly.map((p) => p[0]);
        const ys = l.poly.map((p) => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const width = maxX - minX;
        const height = maxY - minY;
        const faded = dim(l);
        const isSelected = selected === l.code;
        const label = l.kind === "lot" ? l.code : (l.label ?? l.code);
        const lotFill = l.kind === "reserve" ? "#f2d9a6"
          : l.kind === "collecte" ? "#efb28d"
          : !l.conforme ? "#efc5c5"
          : l.part === "ac" ? "#b8d5a7" : "#d5e5bd";
        const canFitLabel = width >= 2.8 && height >= 2.8;
        const canFitArea = width >= 6.5 && height >= 5;
        return (
          <g key={l.code} opacity={faded ? 0.18 : 1}
            onClick={() => l.kind === "lot" && onSelect?.(l.code)}
            className={l.kind === "lot" ? "cursor-pointer" : ""}>
            <polygon points={l.poly.map((p) => p.join(",")).join(" ")}
              fill={isSelected ? "#a6cf8e" : lotFill}
              stroke={isSelected ? "#1d6a36" : "#314d35"}
              strokeWidth={isSelected ? 0.8 : 0.34} strokeLinejoin="round" />
            {canFitLabel && (
              <text x={cx} y={cy - (canFitArea ? 0.55 : -0.25)} textAnchor="middle"
                fontSize={isSelected ? "2.5" : (width < 4 ? "1.45" : "1.9")}
                fontWeight="700" fill="#203328"
                paintOrder="stroke" stroke="#f8fafc" strokeOpacity="0.8" strokeWidth="0.45">
                {label}
              </text>
            )}
            {canFitArea && l.kind === "lot" && (
              <text x={cx} y={cy + 1.9} textAnchor="middle" fontSize="1.35"
                fontWeight="500" fill="#263a2d"
                paintOrder="stroke" stroke="#f8fafc" strokeOpacity="0.8" strokeWidth="0.3">
                {`${Math.round(l.reelM2).toLocaleString("fr-FR")} m²`}
              </text>
            )}
          </g>
        );
      })}

      {/* Flèche nord et cartouche : codes visuels inspirés des plans d'aménagement. */}
      <g transform="translate(105 -3)">
        <text x="0" y="-1.2" textAnchor="middle" fontSize="2.5" fontWeight="700" fill="#26372b">N</text>
        <path d="M 0 0 L -1.6 5 L 0 4 L 1.6 5 Z" fill="#26372b" />
        <path d="M 0 0 L 0 6" stroke="#26372b" strokeWidth="0.45" />
      </g>

      <g>
        <rect x="-7.5" y="114" width="123" height="15.5" rx="1.2" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.3" />
        <text x="-5.5" y="117.5" fontSize="2.6" fontWeight="700" fill="#1f2937">{reference}</text>
        <text x="-5.5" y="121" fontSize="1.9" fill="#475569">
          PLAN DE MORCELLEMENT · VUE {mode.toUpperCase()}
        </text>
        <g transform="translate(72 124)">
          <rect x="0" y="-1.6" width="3.2" height="2.2" rx="0.3" fill="#d5e5bd" stroke="#314d35" strokeWidth="0.25" />
          <text x="4.2" y="0" fontSize="1.7" fill="#475569">Lots</text>
          <rect x="15" y="-1.6" width="3.2" height="2.2" rx="0.3" fill="#f2d9a6" stroke="#b48a45" strokeWidth="0.25" />
          <text x="19.2" y="0" fontSize="1.7" fill="#475569">Réserve</text>
          <rect x="34" y="-1.6" width="3.2" height="2.2" rx="0.3" fill="#77758e" />
          <text x="38.2" y="0" fontSize="1.7" fill="#475569">Voirie</text>
        </g>
        <text x="-5.5" y="125" fontSize="1.65" fill="#64748b">
          Schéma vectoriel · superficies issues du calcul du morcellement
        </text>
      </g>
    </svg>
  );
}
