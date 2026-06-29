import { ChevronUp, ChevronDown } from "lucide-react";

/**
 * CollapsibleResultHeader — the clickable header bar repeated across the OASIS
 * Results-tab categories (mismatches, cross-validation, incomplete, …). Each was
 * an identical ~18-line block differing only by color, icon, title, and subtitle.
 *
 * The body (the `{expanded && …}` list) stays at the call site; this component
 * owns only the header + toggle + chevron. `onToggle` is called with `name`
 * (the parent's `toggleCategory`), and `isExpanded` drives the chevron.
 *
 * Colors are a static map because Tailwind cannot generate interpolated class
 * names (`bg-${color}-50`); these literals already exist in the original markup.
 *
 * @param {{ name: string, icon: React.ComponentType, color?: 'navy'|'orange'|'yellow'|'green'|'red'|'amber', title: string, count: number, subtitle: string, isExpanded: boolean, onToggle: (name: string) => void }} props
 */

const COLOR_CLASSES = {
  navy: { wrap: 'bg-navy-50 border-navy-200', accent: 'text-navy-600', title: 'text-navy-900', subtitle: 'text-navy-700' },
  orange: { wrap: 'bg-orange-50 border-orange-200', accent: 'text-orange-600', title: 'text-orange-900', subtitle: 'text-orange-700' },
  yellow: { wrap: 'bg-yellow-50 border-yellow-200', accent: 'text-yellow-600', title: 'text-yellow-900', subtitle: 'text-yellow-700' },
  green: { wrap: 'bg-green-50 border-green-200', accent: 'text-green-600', title: 'text-green-900', subtitle: 'text-green-700' },
  red: { wrap: 'bg-red-50 border-red-200', accent: 'text-red-600', title: 'text-red-900', subtitle: 'text-red-700' },
  amber: { wrap: 'bg-amber-50 border-amber-200', accent: 'text-amber-600', title: 'text-amber-900', subtitle: 'text-amber-700' },
};

export default function CollapsibleResultHeader({
  name,
  icon: Icon,
  color = "navy",
  title,
  count,
  subtitle,
  isExpanded,
  onToggle,
}) {
  const cs = COLOR_CLASSES[color] || COLOR_CLASSES.navy;
  return (
    <div
      className={`flex items-center justify-between cursor-pointer ${cs.wrap} p-4 rounded-lg border-2`}
      onClick={() => onToggle(name)}
    >
      <div className="flex items-center gap-3">
        <Icon className={`w-6 h-6 ${cs.accent}`} />
        <div>
          <h4 className={`font-bold ${cs.title} text-lg`}>
            {title} ({count})
          </h4>
          <p className={`text-xs ${cs.subtitle}`}>{subtitle}</p>
        </div>
      </div>
      {isExpanded ? (
        <ChevronUp className={`w-5 h-5 ${cs.accent}`} />
      ) : (
        <ChevronDown className={`w-5 h-5 ${cs.accent}`} />
      )}
    </div>
  );
}
