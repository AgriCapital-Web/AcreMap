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
    <svg viewBox="-4 -4 108 116" className="w-full h-full" role="img" aria-label="Aperçu du morcellement">
      <polygon points={plan.parcelle.map((p) => p.join(",")).join(" ")}
        fill="var(--muted)" stroke="var(--foreground)" strokeWidth="0.6" />

      {plan.voies.map((v, i) => (
        <polygon key={`v${i}`} points={v.poly.map((p) => p.join(",")).join(" ")}
          fill={tint("--foreground", 13)} stroke={tint("--foreground", 35)}
          strokeWidth="0.2" strokeDasharray="1 1" />
      ))}

      {plan.lots.map((l) => {
        const xs = l.poly.map((p) => p[0]);
        const ys = l.poly.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        const faded = dim(l);
        const isSelected = selected === l.code;
        const label = l.kind === "lot" ? l.code : (l.label ?? l.code);
        // Keep the map readable on phones: one short label per polygon.
        // Areas and assignee details remain in the table/cards below the map.
        const canFitLabel = width >= 2.4 && height >= 2.4;
        return (
          <g key={l.code} opacity={faded ? 0.2 : 1}
            onClick={() => l.kind === "lot" && onSelect?.(l.code)}
            className={l.kind === "lot" ? "cursor-pointer" : ""}>
            <polygon points={l.poly.map((p) => p.join(",")).join(" ")}
              fill={fill(l)}
              stroke={isSelected ? "var(--primary)" : tint("--foreground", 60)}
              strokeWidth={isSelected ? 0.9 : 0.25} />
            {canFitLabel && (
              <text x={cx} y={cy + 0.7} textAnchor="middle"
                fontSize={isSelected ? "2.4" : (width < 4 ? "1.5" : "1.9")}
                fontWeight={isSelected ? "800" : "700"}
                fill={isSelected ? "var(--primary)" : "var(--foreground)"}
                paintOrder="stroke" stroke="var(--background)" strokeWidth="0.35">
                {label}
              </text>
            )}
          </g>
        );
      })}

      <text x="0" y="106" fontSize="2.6" fontWeight="700" fill="var(--foreground)">{reference}</text>
      <text x="0" y="110" fontSize="2" fill="var(--muted-foreground)">
        Coordonnées relatives · WGS84 / UTM 30N · aperçu {mode}
      </text>
    </svg>
  );
}
