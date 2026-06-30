import { useMemo, useState } from "react";
import { extractClinicalIndicators } from "./clinicalIndicators";
import {
  Stethoscope, Footprints, Wind, Activity, AlertTriangle, Zap,
  Brain, Droplet, Heart, Hand, CheckCircle2, ChevronDown,
} from "lucide-react";

// Deterministic clinical-indicator categories, in display order. Each maps to a
// "Assistance Needed" needs POSITIVE evidence. The engine's broad `detected` flag
// also fires on negated/independent text ("ambulates independently without
// assistance") because it matches the bare word "assist" — surfacing that chip
// would contradict the nurse. So this one category is gated on an actual graded
// assist level / dependency phrase instead of `detected`. (All other categories
// use the engine's `detected`.)
const ASSIST_NEEDED_RE = /\b(?:(?:min(?:imal)?|mod(?:erate)?|max(?:imal)?|total|complete)\s+assist|requires?\s+assist(?:ance)?|assist(?:ance)?\s+(?:required|needed)|needs?\s+(?:help|assist)|dependent|unable to|cannot\b|supervision|standby|contact guard|cga|sba|[12][\s-]?person\s+assist)/i;

// key on the extractClinicalIndicators() result ({ detected, ...phrases, sentences }).
const CATEGORIES = [
  { key: "assistDevices",        label: "Assistive Devices",  Icon: Footprints },
  { key: "oxygenUse",            label: "Oxygen Use",         Icon: Wind },
  { key: "woundPresent",         label: "Wounds / Skin",      Icon: Activity },
  { key: "fallRisk",             label: "Fall Risk",          Icon: AlertTriangle },
  { key: "painMentioned",        label: "Pain",               Icon: Zap },
  { key: "cognitiveIssues",      label: "Cognition",          Icon: Brain },
  { key: "diabetic",             label: "Diabetes",           Icon: Droplet },
  { key: "cardiacIssues",        label: "Cardiac",            Icon: Heart },
  { key: "assistanceNeeded",     label: "Assistance Needed",  Icon: Hand, detect: (text) => ASSIST_NEEDED_RE.test(text) },
  { key: "independentMentioned", label: "Independence",       Icon: CheckCircle2 },
];

const MAX_EVIDENCE = 3; // sentences shown per category (kept tight to stay scannable)

/**
 * Advisory panel: a deterministic, offline scan of the visit narrative that
 * surfaces the clinical indicators it parsed (assistive devices, oxygen, wounds,
 * fall risk, pain, cognition, diabetes, cardiac, assistance level). Pure — no LLM,
 * no network — built on the tested `clinicalIndicators` engine. It never edits the
 * note; it just shows the clinician what the system understood, as a completeness
 * cross-check ("I mentioned a wound — did I capture staging/measurements?").
 *
 * Renders nothing until the narrative is substantive and at least one indicator is
 * detected, so it stays out of the way on a sparse draft.
 */
export default function ClinicalIndicatorsPanel({ narrativeText }) {
  const [open, setOpen] = useState(false);

  const indicators = useMemo(
    () => (narrativeText && narrativeText.trim().length >= 20 ? extractClinicalIndicators(narrativeText) : null),
    [narrativeText],
  );
  const detected = useMemo(
    () =>
      indicators
        ? CATEGORIES.filter((c) =>
            c.detect ? c.detect(narrativeText) : indicators[c.key]?.detected,
          )
        : [],
    [indicators, narrativeText],
  );

  if (!detected.length) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Stethoscope className="w-4 h-4 text-navy-600" />
          Clinical indicators detected
          <span className="text-xs font-normal text-slate-400">· advisory, from your draft</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold text-navy-700 bg-navy-50 border border-navy-200 rounded-full px-2 py-0.5">
            {detected.length}
          </span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {!open && (
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {detected.map(({ key, label, Icon }) => (
            <span key={key} className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-full px-2 py-1">
              <Icon className="w-3 h-3 text-navy-500" /> {label}
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-500">
            A deterministic scan of your draft (no AI). Use it to confirm the note captures each finding in enough detail — it never changes your text.
          </p>
          {detected.map(({ key, label, Icon }) => {
            const sentences = (indicators[key]?.sentences || []).slice(0, MAX_EVIDENCE);
            return (
              <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Icon className="w-4 h-4 text-navy-600" /> {label}
                </p>
                {sentences.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {sentences.map((s, i) => (
                      <li key={i} className="text-xs text-slate-600 leading-relaxed pl-3 border-l-2 border-navy-200">
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
