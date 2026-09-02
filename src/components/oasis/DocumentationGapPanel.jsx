import { FileSearch, Quote, ArrowUpDown } from "lucide-react";
import { toClinicianView, CLINICIAN_GAP_NOTICE } from "./documentationGaps.js";

// Clinician-facing documentation gaps.
//
// This panel shows where a visit note and a recorded OASIS response appear to
// describe different things, quotes the note, and asks a question. It states
// its whole reason — there is no second, unstated one.
//
// It renders `toClinicianView(gaps)`, which is an ALLOW-LIST projection. That
// matters more than it looks: it means a field added to a finding later cannot
// reach this component by being forgotten, because nothing is copied unless it
// is named. There is no `<FinancialGate>` anywhere in this file, and there
// should never be one — a role check here would imply there is something
// financial to hide, and the point is that the data this panel receives has no
// financial dimension at all.

const DIRECTION_LABEL = {
  suggests_more_dependence: "the note describes more assistance than the recorded response",
  suggests_less_dependence: "the note describes more independence than the recorded response",
};

export default function DocumentationGapPanel({ gaps = [] }) {
  const rows = toClinicianView(gaps);
  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="doc-gap-heading">
      <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <FileSearch className="h-4 w-4 text-slate-600" aria-hidden="true" />
        <h3 id="doc-gap-heading" className="text-sm font-bold text-slate-800">
          Documentation to re-read ({rows.length})
        </h3>
      </header>

      <p className="px-4 pt-3 text-xs text-slate-600">{CLINICIAN_GAP_NOTICE}</p>

      <ul className="list-none space-y-3 p-4">
        {rows.map((g) => (
          <li key={g.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">{g.label}</span>
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                {DIRECTION_LABEL[g.direction]}
              </span>
            </div>

            <p className="mt-1 text-xs text-slate-600">
              Recorded response: <span className="font-mono font-semibold">{g.recorded_code}</span>
            </p>

            <div className="mt-2 rounded bg-slate-50 p-2">
              <p className="text-xs font-semibold text-slate-600">From the documentation:</p>
              <ul className="mt-1 list-none space-y-1 p-0">
                {g.evidence.map((quote, i) => (
                  <li key={i} className="flex gap-1 text-xs italic text-slate-700">
                    <Quote className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />
                    <span>{quote}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-2 text-xs text-slate-700">{g.question}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
