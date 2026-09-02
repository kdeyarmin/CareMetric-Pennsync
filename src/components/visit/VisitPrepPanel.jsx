import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, ClipboardList, FileText, Info, Mic, Pill, Stethoscope, User,
} from "lucide-react";
import { buildVisitPrep } from "./visitPrep";

const BAND = {
  critical: { label: "Needs attention", frame: "border-red-200 bg-red-50", text: "text-red-900", badge: "destructive", icon: AlertTriangle },
  high: { label: "Important today", frame: "border-amber-200 bg-amber-50", text: "text-amber-900", badge: "warning", icon: Info },
  routine: { label: "Background", frame: "border-slate-200 bg-slate-50", text: "text-slate-800", badge: "secondary", icon: Info },
};

function Row({ item, tone }) {
  return (
    <li className="rounded-lg border border-white/60 bg-white/70 px-3 py-2">
      <p className={`text-xs font-semibold ${tone.text}`}>{item.label}</p>
      {item.detail && <p className="text-xs text-slate-700 mt-0.5 leading-relaxed">{item.detail}</p>}
      {item.overflow > 0 && (
        <p className="text-xs text-slate-500 mt-0.5">+{item.overflow} more — open the chart for the full list.</p>
      )}
      {item.caveat && <p className="text-xs text-slate-500 italic mt-0.5">{item.caveat}</p>}
    </li>
  );
}

/**
 * VisitPrepPanel — the compact pre-visit briefing.
 *
 * Progressive disclosure is the whole design: the "needs attention" band is open
 * on arrival, the rest is one tap away, so a nurse standing in a driveway on a
 * phone sees the handful of facts that change what they do today rather than a
 * wall of chart data.
 *
 * Every line is deterministic (see visitPrep.js) — no LLM is involved, because a
 * briefing that could invent a clinical fact is worse than no briefing. What
 * PennSync does not hold is stated as "not recorded in PennSync", never as a
 * clinical negative: PennSync is not the EMR and does not hold the whole chart.
 */
export default function VisitPrepPanel({
  patient,
  priorVisits = [],
  openTasks = [],
  carePlans = [],
  oasisAssessments = [],
  alerts = [],
  className = "",
}) {
  const prep = useMemo(
    () => buildVisitPrep({ patient, priorVisits, openTasks, carePlans, oasisAssessments, alerts }),
    [patient, priorVisits, openTasks, carePlans, oasisAssessments, alerts],
  );
  const [showAll, setShowAll] = useState(false);

  const patientId = patient?.id || "";
  const bands = showAll ? ["critical", "high", "routine"] : ["critical", "high"];
  const hiddenCount = showAll ? 0 : prep.counts.routine;

  return (
    <section aria-labelledby="visit-prep-heading" className={`space-y-3 ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="visit-prep-heading" className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Stethoscope className="w-4 h-4 text-navy-600" aria-hidden="true" />
          Visit prep — {prep.patientName}
        </h2>
        <div className="flex items-center gap-1.5">
          {prep.counts.critical > 0 && (
            <Badge variant="destructive" className="text-xs">{prep.counts.critical} need attention</Badge>
          )}
          {prep.counts.high > 0 && (
            <Badge variant="warning" className="text-xs">{prep.counts.high} important</Badge>
          )}
        </div>
      </header>

      {/* Direct actions: the point of the briefing is to start the work, not to
          make the nurse navigate back through several hubs to reach it. */}
      <div className="flex flex-wrap gap-2">
        <Button asChild className="h-11 gap-1.5 text-xs font-semibold">
          <Link to={`/SmartNoteAssistant?patientId=${encodeURIComponent(patientId)}`}>
            <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Start Smart Note
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11 gap-1.5 text-xs font-semibold">
          <Link to={`/ClinicalDocumentation?patientId=${encodeURIComponent(patientId)}`}>
            <Mic className="w-3.5 h-3.5" aria-hidden="true" /> Visit Scribe
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11 gap-1.5 text-xs font-semibold">
          <Link to={`/PatientDetails?id=${encodeURIComponent(patientId)}`}>
            <User className="w-3.5 h-3.5" aria-hidden="true" /> Open chart
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11 gap-1.5 text-xs font-semibold">
          {/* `clinical` is where the medication list lives; there is no
              standalone medications tab. */}
          <Link to={`/PatientDetails?id=${encodeURIComponent(patientId)}&tab=clinical`}>
            <Pill className="w-3.5 h-3.5" aria-hidden="true" /> Medications
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11 gap-1.5 text-xs font-semibold">
          <Link to="/OASISCenter">
            <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" /> OASIS guidance
          </Link>
        </Button>
      </div>

      {prep.items.length === 0 && (
        <p className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-3">
          PennSync has nothing recorded for this patient yet. Review the chart in your EMR before
          the visit.
        </p>
      )}

      {bands.map((band) => {
        const rows = prep.byPriority[band];
        if (!rows?.length) return null;
        const tone = BAND[band];
        const Icon = tone.icon;
        return (
          <div key={band} className={`rounded-xl border p-3 space-y-2 ${tone.frame}`}>
            <h3 className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 ${tone.text}`}>
              <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {tone.label}
            </h3>
            <ul className="space-y-1.5">
              {rows.map((row, i) => <Row key={`${row.category}-${i}`} item={row} tone={tone} />)}
            </ul>
          </div>
        );
      })}

      {hiddenCount > 0 && (
        <Button
          variant="ghost"
          onClick={() => setShowAll(true)}
          className="h-11 w-full text-xs font-semibold text-navy-700"
        >
          Show {hiddenCount} background item{hiddenCount === 1 ? "" : "s"}
        </Button>
      )}

      {prep.missing.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-xs font-semibold text-slate-600">Not recorded in PennSync</p>
          <ul className="mt-1 ml-4 list-disc text-xs text-slate-500 space-y-0.5">
            {prep.missing.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
          <p className="text-xs text-slate-400 mt-1">
            PennSync is not the EMR and does not hold the whole chart — confirm anything missing there.
          </p>
        </div>
      )}
    </section>
  );
}
