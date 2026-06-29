import { ShieldAlert, AlertTriangle, Info, ClipboardCheck } from "lucide-react";

const STYLES = {
  critical: { wrap: "bg-red-50 border-red-300", text: "text-red-800", Icon: ShieldAlert, iconColor: "text-red-600" },
  warning: { wrap: "bg-amber-50 border-amber-300", text: "text-amber-800", Icon: AlertTriangle, iconColor: "text-amber-600" },
  info: { wrap: "bg-blue-50 border-blue-200", text: "text-blue-800", Icon: Info, iconColor: "text-blue-600" },
};

/**
 * Surfaces the deterministic chart cross-check (from crossCheckChart): how the
 * note being written lines up against the rest of the patient's chart —
 * allergies, the medication list, fall risk. Purely advisory; the nurse
 * reconciles. Renders nothing when the note is consistent with the chart.
 *
 * Props:
 *   findings — output of crossCheckChart(noteText, patient)
 */
export default function ChartCrossCheckPanel({ findings = [] }) {
  if (!findings.length) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardCheck className="w-4 h-4 text-slate-500" />
        <h3 className="font-semibold text-slate-900">Chart Cross-Check</h3>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        How your note compares against this patient's chart. Review and reconcile — these are not added to the note.
      </p>
      <div className="space-y-2">
        {findings.map((f) => {
          const s = STYLES[f.severity] || STYLES.info;
          const Icon = s.Icon;
          return (
            <div key={f.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${s.wrap}`}>
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${s.iconColor}`} />
              <p className={`text-sm ${s.text}`}>
                <span className="font-semibold">{f.category}:</span> {f.message}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
