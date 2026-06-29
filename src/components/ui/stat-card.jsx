import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

/**
 * StatCard — the single, canonical KPI/stat tile for the whole app.
 *
 * Historically several pages each defined their own local `StatCard` with
 * slightly different prop names and looks (label vs title, sub vs subtitle vs
 * description, tone vs color vs accent). That inconsistency is exactly what
 * made dashboards feel "off". This component absorbs every one of those prop
 * shapes so it is a safe drop-in everywhere, and renders one premium, restrained
 * tile: a clean white card with a thin tone-matched accent rail, a soft ringed
 * icon chip, and tabular-aligned figures.
 *
 * Accepted props (aliases are intentional for backward-compatibility):
 *   title | label        heading text
 *   value                the big figure
 *   icon                 a lucide icon component
 *   description | sub | subtitle   secondary line
 *   trend (+ trendValue) a delta line; trend may be "up"/"down" or a plain
 *                        string (older call sites pass the text directly)
 *   tone | color | variant   named accent (see TONES + ALIAS below)
 *   accent               an explicit hex color (wins over tone); used by the
 *                        time-off cards
 */

const TONES = {
  navy: { chip: "bg-navy-50 text-navy-700 ring-navy-100", rail: "bg-navy-500" },
  sky: { chip: "bg-sky-50 text-sky-700 ring-sky-100", rail: "bg-sky-500" },
  emerald: { chip: "bg-emerald-50 text-emerald-700 ring-emerald-100", rail: "bg-emerald-500" },
  amber: { chip: "bg-amber-50 text-amber-700 ring-amber-100", rail: "bg-amber-500" },
  orange: { chip: "bg-orange-50 text-orange-700 ring-orange-100", rail: "bg-orange-500" },
  rose: { chip: "bg-rose-50 text-rose-700 ring-rose-100", rail: "bg-rose-500" },
  violet: { chip: "bg-violet-50 text-violet-700 ring-violet-100", rail: "bg-violet-500" },
  slate: { chip: "bg-slate-100 text-slate-600 ring-slate-200", rail: "bg-slate-400" },
  gold: { chip: "bg-gold-100 text-gold-700 ring-gold-200", rail: "bg-gold-400" },
};

// Map every legacy tone/color/variant name a call site might pass onto one of
// the canonical tones above.
const ALIAS = {
  default: "navy",
  ai: "navy",
  primary: "navy",
  blue: "navy",
  indigo: "navy",
  purple: "violet",
  success: "emerald",
  green: "emerald",
  teal: "emerald",
  warning: "amber",
  yellow: "amber",
  critical: "rose",
  danger: "rose",
  red: "rose",
  neutral: "slate",
  gray: "slate",
};

function resolveTone(name) {
  if (!name) return TONES.navy;
  const key = ALIAS[name] || name;
  return TONES[key] || TONES.navy;
}

export default function StatCard({
  title,
  label,
  value,
  icon: Icon,
  description,
  sub,
  subtitle,
  trend,
  trendValue,
  tone,
  color,
  variant,
  accent,
  className,
}) {
  const heading = title ?? label;
  const secondary = description ?? sub ?? subtitle;

  // Only an explicit direction ("up"/"down", paired with `trendValue`) is a real
  // KPI delta — that gets a green/red arrow. Older call sites pass a freeform
  // status string ("Last 50 documents"), which is NOT a positive change, so it
  // renders as a neutral note: no arrow, no up/down color.
  const isDirection = trend === "up" || trend === "down";
  const deltaText = isDirection ? trendValue : null;
  const noteText = isDirection ? null : trend;
  const deltaDown = trend === "down";
  const DeltaIcon = deltaDown ? TrendingDown : TrendingUp;
  const deltaColor = deltaDown ? "text-rose-600" : "text-emerald-600";

  const t = resolveTone(tone ?? color ?? variant);
  const useHex = typeof accent === "string" && accent.startsWith("#");

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.06)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(15,23,42,0.10)]",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-1", !useHex && t.rail)}
        style={useHex ? { backgroundColor: accent } : undefined}
      />
      <div className="p-4 pl-5 sm:p-5 sm:pl-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {heading && (
              <p className="truncate text-xs font-semibold uppercase tracking-wider text-slate-500">
                {heading}
              </p>
            )}
            <p className="mt-1.5 text-2xl sm:text-3xl font-bold tabular-nums tracking-tight text-slate-900 break-words leading-tight">
              {value}
            </p>
            {secondary && (
              <p className="mt-1 truncate text-sm text-slate-500">{secondary}</p>
            )}
            {deltaText && (
              <span className={cn("mt-2 inline-flex items-center gap-1 text-sm font-semibold", deltaColor)}>
                <DeltaIcon className="h-4 w-4" aria-hidden="true" />
                {deltaText}
              </span>
            )}
            {noteText && (
              <p className="mt-1 truncate text-sm text-slate-500">{noteText}</p>
            )}
          </div>

          {Icon && (
            <div
              className={cn(
                "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset transition-transform duration-300 group-hover:scale-105",
                !useHex && t.chip
              )}
              style={useHex ? { backgroundColor: `${accent}1a`, color: accent } : undefined}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}