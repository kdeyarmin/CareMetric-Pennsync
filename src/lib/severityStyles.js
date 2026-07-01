/**
 * Canonical severity/priority → Tailwind class helpers.
 *
 * Dozens of components each defined their own `getSeverityColor` / `getPriorityColor`
 * with the same two underlying palettes. Centralised here so severity coloring is
 * consistent app-wide and defined once. Two treatments:
 *
 *  - badge  — light chip: `bg-{c}-100 text-{c}-800 border-{c}-300` (the dominant style)
 *  - solid  — emphatic pill: `bg-{c}-500/600 text-white` (used for priority pills)
 *
 * Levels: critical | high | medium | low (unknown → neutral slate).
 */

const SEVERITY_BADGE = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high: "bg-orange-100 text-orange-800 border-orange-300",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
  low: "bg-blue-100 text-blue-800 border-blue-300",
};

const SEVERITY_SOLID = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-white",
  low: "bg-blue-500 text-white",
};

/** Light badge/chip classes for a severity or priority level. */
export function severityBadgeClass(level) {
  return SEVERITY_BADGE[level] || "bg-slate-100 text-slate-800 border-slate-300";
}

/** Solid, high-emphasis pill classes for a severity or priority level. */
export function severitySolidClass(level) {
  return SEVERITY_SOLID[level] || "bg-slate-500 text-white";
}
