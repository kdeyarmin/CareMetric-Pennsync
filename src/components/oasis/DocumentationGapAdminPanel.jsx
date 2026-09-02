import { TrendingUp, AlertTriangle, Lock } from "lucide-react";
import FinancialGate from "@/components/ui/FinancialGate";
import {
  aggregateDocumentationGaps,
  uploadsToClosedEpisodes,
  MIN_COHORT_FOR_RATE,
} from "./documentationGapAnalytics.js";

// ADMINISTRATOR view of documentation-gap patterns and their revenue context.
//
// Wrapped in <FinancialGate>, which is fail-closed: it renders nothing while
// the current user is still resolving, and nothing for any non-admin. That is
// the client-side half; `listOASISUploads` already strips financial keys
// server-side, which is the half that actually matters.
//
// What this panel deliberately does NOT do is name a patient, an assessment or
// a nurse alongside a dollar figure. It reports where documentation is weakest
// across closed episodes, which is a training signal. The moment a revenue
// number is attached to one open assessment it stops being management
// information and becomes a coding target aimed at the person who has to attest
// to it — so `documentationGapAnalytics` refuses open episodes outright rather
// than leaving that to the caller.

/**
 * @param {object} props
 * @param {Array} [props.episodes] Episode-shaped rows.
 * @param {Array} [props.uploads]  OASISUpload rows, converted via
 *   `uploadsToClosedEpisodes`. An upload is not an episode — see that function.
 */
export default function DocumentationGapAdminPanel({ episodes = [], uploads = [] }) {
  const rows = episodes.length ? episodes : uploadsToClosedEpisodes(uploads);
  return (
    <FinancialGate
      fallback={
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <Lock className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <p className="text-sm text-slate-500">Documentation-gap analytics are available to administrators.</p>
        </div>
      }
    >
      <AdminBody episodes={rows} />
    </FinancialGate>
  );
}

function AdminBody({ episodes }) {
  const gaps = aggregateDocumentationGaps(episodes);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="gap-admin-heading">
      <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <TrendingUp className="h-4 w-4 text-slate-600" aria-hidden="true" />
        <h3 id="gap-admin-heading" className="text-sm font-bold text-slate-800">
          Documentation gap patterns
        </h3>
      </header>

      <div className="p-4">
        <p className="text-xs text-slate-500">
          {gaps.episodes_analysed} closed episode{gaps.episodes_analysed === 1 ? "" : "s"} analysed.
          {gaps.excluded_reason ? ` ${gaps.excluded_reason}` : ""}
        </p>

        {gaps.cohort_too_small && (
          <p className="mt-2 text-xs text-amber-700">
            Fewer than {MIN_COHORT_FOR_RATE} closed episodes — treat these counts as anecdotes, not a rate.
          </p>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="sr-only">Documentation gaps by OASIS item and direction</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="p-2 text-left text-xs font-semibold text-slate-600">Item</th>
                <th scope="col" className="p-2 text-right text-xs font-semibold text-slate-600">Note shows more assistance</th>
                <th scope="col" className="p-2 text-right text-xs font-semibold text-slate-600">Note shows more independence</th>
                <th scope="col" className="p-2 text-right text-xs font-semibold text-slate-600">Total</th>
              </tr>
            </thead>
            <tbody>
              {gaps.items.filter((i) => i.total > 0).map((i) => (
                <tr key={i.item} className="border-b border-slate-100">
                  <th scope="row" className="p-2 text-left text-xs font-normal text-slate-700">{i.label}</th>
                  <td className="p-2 text-right text-slate-700">{i.suggests_more_dependence}</td>
                  <td className="p-2 text-right text-slate-700">{i.suggests_less_dependence}</td>
                  <td className="p-2 text-right font-semibold text-slate-800">{i.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {gaps.direction_balance !== null && gaps.direction_balance > 3 && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            <span>
              Findings run {gaps.direction_balance}× more often toward more assistance than toward more
              independence. That may be a real documentation habit worth training — or a sign the detection
              rules have drifted one way and should be re-read before this drives any decision.
            </span>
          </p>
        )}

        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>Payment/case-mix cohort comparison is unavailable — not $0.</strong> Legacy estimator values are excluded until the verified CMS grouper is available.
        </div>
      </div>
    </section>
  );
}
