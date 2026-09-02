import { Badge } from "@/components/ui/badge";
import { ShieldAlert, ShieldCheck, CheckCircle2 } from "lucide-react";
import { AcknowledgeControl } from "./AcknowledgeGate";
import { DENIAL_CLUSTER_LABELS } from "./compliance/reportingFields";

// ── Denial-risk panel ───────────────────────────────────────────────────────
// Renders the deterministic denial-guardrail findings (the four recurring audit
// clusters behind most documentation-driven denials) in the same visual language
// as the compliance checklist: severity badges + expandable remediation/evidence.
// ADVISORY: findings never hard-block. When `ack` is provided (the save step) and
// a critical cluster fails, the nurse acknowledges before saving — the same
// override pattern as the chart safety conflicts.
// Cluster names come from reportingFields' DENIAL_CLUSTER_LABELS so the live
// panel and the persisted compliance issues/tags use identical wording.
const DENIAL_SEVERITY_BADGE = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  info: "bg-slate-100 text-slate-600",
};

/**
 * `chrome` draws the panel's own frame and heading. The pre-generation view now
 * nests this inside a collapsible whose header already carries the title and the
 * risk score, so it passes chrome={false} to avoid a card inside a card (and a
 * heading repeated twice). The save gate still renders it standalone.
 */
export default function DenialRiskPanel({ guard, openClusters, onToggleCluster, ack = null, chrome = true }) {
  if (!guard || !guard.findings?.length) return null;
  const failed = guard.findings.filter((f) => f.status === "fail");
  const passedOrNA = guard.findings.filter((f) => f.status !== "fail");
  const blocking = failed.filter((f) => f.severity === "critical");
  const tone = blocking.length ? "red" : failed.length ? "orange" : "green";
  const frame = tone === "red" ? "border-red-300 bg-red-50" : tone === "orange" ? "border-orange-300 bg-orange-50" : "border-green-300 bg-green-50";
  const heading = tone === "red" ? "text-red-800" : tone === "orange" ? "text-orange-800" : "text-green-800";
  return (
    <div className={chrome ? `rounded-xl border-2 p-4 space-y-2 ${frame}` : "space-y-2"}>
      {chrome && (
        <div className="flex items-center justify-between gap-2">
          <h3 className={`font-semibold flex items-center gap-2 ${heading}`}>
            {failed.length > 0 ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />} Denial Risk
          </h3>
          <Badge className={`${tone === "red" ? "bg-red-600" : tone === "orange" ? "bg-orange-500" : "bg-green-600"} text-white shrink-0`}>
            {guard.denial_risk_score}% risk
          </Badge>
        </div>
      )}
      {failed.length === 0 ? (
        <p className="text-sm text-green-800">No denial-risk documentation patterns detected — the audited clusters below all read as documented.</p>
      ) : (
        <p className={`text-xs ${tone === "red" ? "text-red-700" : "text-orange-700"}`}>
          These documentation patterns drive most Medicare denials. Advisory only — strengthen the language, or review and proceed.
        </p>
      )}
      {failed.length > 0 && (
        <div className="space-y-2">
          {failed.map((f) => {
            const open = openClusters.has(f.cluster);
            return (
              <div key={f.cluster} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <button type="button" onClick={() => onToggleCluster(f.cluster)} className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-slate-50">
                  <Badge className={`shrink-0 text-xs ${DENIAL_SEVERITY_BADGE[f.severity] || DENIAL_SEVERITY_BADGE.info}`}>{f.severity}</Badge>
                  <span className="flex-1 min-w-0 text-sm text-slate-800">
                    <span className="font-semibold">{DENIAL_CLUSTER_LABELS[f.cluster] || f.cluster}:</span> {f.message}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0">{open ? "Hide" : "Detail"}</span>
                </button>
                {open && (
                  <div className="px-3 pb-2.5 space-y-1 border-t border-slate-100">
                    {f.remediation && <p className="text-xs text-slate-600 mt-1.5"><span className="font-semibold">How to fix:</span> {f.remediation}</p>}
                    {f.evidence && <p className="text-xs text-slate-500 italic">Found: “{f.evidence}”</p>}
                    {f.cop_reference && <p className="text-[10px] text-slate-400">{f.cop_reference}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {passedOrNA.length > 0 && (
        <ul className="space-y-0.5">
          {passedOrNA.map((f) => (
            <li key={f.cluster} className="flex items-start gap-1.5 text-xs text-slate-600">
              <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${f.status === "pass" ? "text-green-600" : "text-slate-300"}`} />
              <span><span className="font-medium">{DENIAL_CLUSTER_LABELS[f.cluster] || f.cluster}:</span> {f.message}</span>
            </li>
          ))}
        </ul>
      )}
      {ack && blocking.length > 0 && (
        <AcknowledgeControl
          tone="red"
          checked={ack.acknowledged}
          onCheckedChange={ack.onAcknowledge}
          label="I have reviewed these denial risks and choose to save the note as documented."
          justification={ack.justification}
          onJustificationChange={ack.onJustification}
          justificationPlaceholder="Optional: why the documentation stands as written (e.g. detail lives in the plan of care). Saved to the compliance record."
        />
      )}
    </div>
  );
}
