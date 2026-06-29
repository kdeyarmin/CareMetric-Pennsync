import { TrendingUp, TrendingDown, Minus, AlertTriangle, LineChart } from "lucide-react";

/**
 * Surfaces the deterministic visit-over-visit comparison (from compareVisits):
 * what changed in the patient's measured values since their last documented
 * visit, plus any multi-visit sustained trends (from detectSustainedTrends).
 * This is the "check the note against the chart so trends are caught" step. The
 * nurse can opt to add a purely factual change summary to the note so the change
 * is recorded ("changes can be noted in the note").
 *
 * Props:
 *   comparisons    — output of compareVisits(currentNote, priorNote)
 *   trends         — output of detectSustainedTrends(noteHistory) (advisory only)
 *   include        — whether the change summary will be added to the note
 *   onToggleInclude(next) — toggle handler for the include checkbox
 *   summary        — the factual sentence buildTrendSummary() produced
 */
export default function VisitComparisonPanel({ comparisons = [], trends = [], include = false, onToggleInclude, summary = "" }) {
  if (!comparisons.length && !trends.length) return null;

  return (
    <div className="bg-white border border-navy-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="w-4 h-4 text-navy-500" />
        <h3 className="font-semibold text-slate-900">Changes Since Last Visit</h3>
      </div>

      {trends.length > 0 && (
        <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <p className="text-xs font-semibold text-orange-800 flex items-center gap-1.5 mb-1.5">
            <LineChart className="w-3.5 h-3.5" /> Sustained trend across recent visits
          </p>
          <div className="space-y-1.5">
            {trends.map((t) => {
              const Icon = t.direction === "up" ? TrendingUp : TrendingDown;
              return (
                <div key={t.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-orange-900 flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                    {t.label} {t.direction === "up" ? "rising" : "declining"}
                  </span>
                  <span className="font-mono text-orange-800 shrink-0">{t.display}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-orange-700 mt-1.5">Advisory — review and document clinical significance in your own words.</p>
        </div>
      )}

      {comparisons.length === 0 ? null : (
      <>
      <p className="text-xs text-slate-500 mb-3">
        Measured values from your note compared against this patient's last documented visit. Review for trends —
        flagged rows ({" "}
        <AlertTriangle className="w-3 h-3 text-amber-500 inline -mt-0.5" /> ) crossed a clinical threshold.
      </p>

      <div className="space-y-1.5">
        {comparisons.map((c) => {
          const Icon = c.direction === "up" ? TrendingUp : c.direction === "down" ? TrendingDown : Minus;
          const iconColor = c.concern ? "text-amber-600" : c.direction === "same" ? "text-slate-400" : "text-slate-500";
          const unit = c.trailingUnit ? ` ${c.trailingUnit}` : "";
          return (
            <div
              key={c.key}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${c.concern ? "bg-amber-50 border border-amber-200" : "bg-slate-50 border border-slate-100"}`}
            >
              <span className="font-medium text-slate-700 flex items-center gap-1.5">
                {c.concern && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                {c.label}
              </span>
              <span className="flex items-center gap-2 font-mono text-slate-600 shrink-0">
                <span className="text-slate-400">{c.prevStr}</span>
                <Icon className={`w-4 h-4 ${iconColor}`} />
                <span className={`font-semibold ${c.concern ? "text-amber-700" : "text-slate-900"}`}>
                  {c.nextStr}
                  {unit}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {summary && (
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-700 cursor-pointer bg-navy-50 border border-navy-200 rounded-lg px-3 py-2">
          <input
            type="checkbox"
            checked={include}
            onChange={(e) => onToggleInclude?.(e.target.checked)}
            className="w-4 h-4 mt-0.5 text-indigo-600 rounded shrink-0"
          />
          <span>
            Add a factual change summary to the note
            <span className="block text-xs text-slate-500 mt-0.5 italic">“{summary}”</span>
          </span>
        </label>
      )}
      </>
      )}
    </div>
  );
}
