import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Circle, ChevronDown } from "lucide-react";

/**
 * SetupStage — one collapsible step of the super-admin telephony setup.
 *
 * The config page previously rendered every panel expanded, so an admin who had
 * finished setup still scrolled past the whole thing to reach the one section
 * that needed attention. Finished stages collapse to a single row; the status
 * badge is derived from the integration checklist (see setupStages.js), never
 * stored, so it can't disagree with the checks inside.
 *
 * Children stay MOUNTED when collapsed (hidden via CSS) rather than unmounted:
 * the progress card scrolls to anchors that live inside these panels, and those
 * ids have to exist in the document for the jump to work. It also avoids
 * re-running each panel's queries every time a stage is toggled.
 */
const STATUS_META = {
  done: { label: "Done", icon: CheckCircle2, badge: "bg-emerald-100 text-emerald-800", icon_class: "text-emerald-600" },
  attention: { label: "Needs attention", icon: AlertTriangle, badge: "bg-amber-100 text-amber-800", icon_class: "text-amber-600" },
  todo: { label: "Not finished", icon: Circle, badge: "bg-slate-100 text-slate-700", icon_class: "text-slate-400" },
};

export default function SetupStage({ index, title, description, status = "todo", expanded, onToggle, children }) {
  const meta = STATUS_META[status] || STATUS_META.todo;
  const Icon = meta.icon;
  const panelId = `setup-stage-${index}`;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
          {index}
        </span>
        <Icon className={`h-4 w-4 flex-shrink-0 ${meta.icon_class}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{title}</span>
          <span className="block truncate text-xs text-slate-500">{description}</span>
        </span>
        <Badge className={`${meta.badge} flex-shrink-0`}>{meta.label}</Badge>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {/* Hidden, not unmounted — see the note above about anchor scrolling. */}
      <div id={panelId} hidden={!expanded} className="space-y-6 border-t border-slate-100 p-4">
        {children}
      </div>
    </section>
  );
}
