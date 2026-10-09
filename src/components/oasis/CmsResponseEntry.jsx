import { useState } from "react";
import { ChevronDown, ChevronUp, ClipboardCheck } from "lucide-react";
import OasisResponseControl from "./OasisResponseControl";
import { visitTypeToTimepoint } from "./responseSchema/registry.js";
import { cmsEntryDefinitions, cmsEntryProgress } from "./cmsResponseSelections.js";

/**
 * The CMS-aligned OASIS-E2 items a clinician records for this assessment — the
 * part of the Assessment tab that is SAVED to the chart.
 *
 * Every control starts blank and is driven by its definition (single choice,
 * matrix, check-all-that-apply or grid), at the time point the assessment's own
 * reason names. Nothing is pre-filled from the screening form below or from any
 * AI evidence panel: a response is only ever one the clinician chose here.
 */
export default function CmsResponseEntry({ visitType, responses, onChange, disabled = false }) {
  const [open, setOpen] = useState(true);
  const timepoint = visitTypeToTimepoint(visitType);
  const definitions = cmsEntryDefinitions(visitType);
  const { answered, total } = cmsEntryProgress(visitType, responses);

  return (
    <section className="border-2 border-indigo-200 rounded-xl overflow-hidden bg-white shadow-sm" aria-label="CMS-aligned OASIS responses">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-indigo-50 hover:bg-indigo-100 transition-colors"
        aria-expanded={open}
      >
        <ClipboardCheck className="w-5 h-5 text-indigo-600" aria-hidden="true" />
        <span className="flex-1 text-left">
          <span className="block text-sm font-bold text-slate-800">CMS-aligned OASIS-E2 responses — saved to the chart</span>
          <span className="block text-xs text-slate-500">
            Choose each response from the wording in your EMR. These are the only answers PennSync saves.
          </span>
        </span>
        <span className="text-xs text-slate-500">{answered}/{total} selected</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="p-4 space-y-3">
          {!timepoint && (
            <p className="text-sm text-amber-800">Choose the assessment reason to see the items CMS collects for it.</p>
          )}
          {definitions.map((definition) => (
            <OasisResponseControl
              key={definition.definition_id}
              definition={definition}
              timepoint={timepoint}
              value={responses?.[definition.definition_id] ?? null}
              onChange={(value) => onChange(definition.definition_id, value)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </section>
  );
}
