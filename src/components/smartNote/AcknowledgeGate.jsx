import { AlertTriangle } from "lucide-react";

/**
 * The single acknowledge-and-record pattern for every override gate in the
 * Smart Note flow: chart safety conflicts, denial risk, facility requirements
 * and thin critical answers.
 *
 * Before this, each gate hand-rolled its own frame, checkbox and justification
 * box in a slightly different visual language, so one note could present four
 * different-looking "tick this to continue" controls. The gating logic is
 * unchanged — this only makes the controls read as the same thing.
 *
 * Two exports, because one gate (the denial-risk panel) already draws its own
 * frame and would otherwise nest two cards:
 *   AcknowledgeControl — the checkbox (+ optional justification + actions) alone.
 *   AcknowledgeGate    — that control inside the standard titled card.
 *
 * The native checkbox inside its own <label> is deliberate. It is already fully
 * labelled for assistive tech, so swapping in the Radix control would add a
 * name-association dependency without an accessibility gain.
 */
const TONES = {
  red: {
    frame: "border-red-300 bg-red-50",
    heading: "text-red-800",
    label: "text-red-900",
    accent: "text-red-600",
    box: "border-red-300 text-red-900 placeholder:text-red-400 focus:ring-red-400",
  },
  amber: {
    frame: "border-amber-300 bg-amber-50",
    heading: "text-amber-800",
    label: "text-amber-900",
    accent: "text-amber-600",
    box: "border-amber-300 text-amber-900 placeholder:text-amber-400 focus:ring-amber-400",
  },
};

export function AcknowledgeControl({
  tone = "red",
  checked = false,
  onCheckedChange,
  label,
  justification = "",
  onJustificationChange = null,
  justificationPlaceholder = "",
  actions = null,
}) {
  const t = TONES[tone] || TONES.red;
  return (
    <>
      <label className={`flex items-start gap-2 text-sm cursor-pointer pt-1 ${t.label}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          className={`w-4 h-4 mt-0.5 rounded shrink-0 ${t.accent}`}
        />
        <span>{label}</span>
      </label>
      {/* The rationale box only matters once the override is actually taken. */}
      {onJustificationChange && checked && (
        <textarea
          value={justification}
          onChange={(e) => onJustificationChange(e.target.value)}
          rows={2}
          placeholder={justificationPlaceholder}
          className={`w-full text-sm rounded-lg border bg-white p-2 focus:outline-none focus:ring-1 ${t.box}`}
        />
      )}
      {actions}
    </>
  );
}

export default function AcknowledgeGate({ tone = "red", icon, title, children, className = "", ...control }) {
  const t = TONES[tone] || TONES.red;
  const Icon = icon || AlertTriangle;
  return (
    <div className={`rounded-xl border-2 p-4 space-y-2 ${t.frame} ${className}`}>
      <h3 className={`font-semibold flex items-center gap-2 ${t.heading}`}>
        <Icon className="w-4 h-4" /> {title}
      </h3>
      {children}
      <AcknowledgeControl tone={tone} {...control} />
    </div>
  );
}
