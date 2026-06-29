import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Info,
  DollarSign,
  ClipboardList,
  Copy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Audit Defense Summary — surfaces the scrubber's strongest/weakest documentation,
 * priority fixes, derived high-risk audit scenarios, and a pre-audit checklist.
 *
 * The checklist's "Apply Fix" button looks up a related issue by index across the
 * critical-missing / vague-documentation / underscoring result arrays, so those are
 * passed in alongside the summary. Quick-fix and copy actions are lifted to props.
 * Renders nothing when there is no summary.
 */
export default function AuditDefenseSummary({
  summary,
  copiedText,
  criticalMissing,
  vagueDocumentation,
  underscoringOpportunities,
  onQuickFix,
  onCopy,
}) {
  if (!summary) return null;

  return (
    <div className="bg-slate-50 p-4 rounded-lg border-2 border-slate-200">
      <h4 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
        <ShieldCheck className="w-5 h-5" />
        Audit Defense Summary
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {summary.strongest_documentation?.length > 0 && (
          <div className="bg-green-50 p-3 rounded border border-green-200">
            <p className="text-xs font-semibold text-green-800 mb-2 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Strongest Documentation
            </p>
            <ul className="text-xs text-green-700 space-y-1">
              {summary.strongest_documentation.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </div>
        )}
        {summary.weakest_documentation?.length > 0 && (
          <div className="bg-red-50 p-3 rounded border border-red-200">
            <p className="text-xs font-semibold text-red-800 mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Weakest Documentation
            </p>
            <ul className="text-xs text-red-700 space-y-1">
              {summary.weakest_documentation.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </div>
        )}
        {summary.recommended_priority_fixes?.length > 0 && (
          <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
            <p className="text-xs font-semibold text-yellow-800 mb-2 flex items-center gap-1">
              <Info className="w-3 h-3" /> Priority Fixes
            </p>
            <ol className="text-xs text-yellow-700 space-y-1 list-decimal list-inside">
              {summary.recommended_priority_fixes.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* High-Risk Audit Scenarios */}
      {summary.weakest_documentation?.length > 0 && (
        <div className="bg-red-100 p-4 rounded-lg border border-red-300 mb-4">
          <h5 className="font-bold text-red-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            High-Risk Audit Scenarios
          </h5>
          <div className="space-y-3">
            {summary.weakest_documentation.slice(0, 3).map((weakness, idx) => {
              const auditScenarios = {
                functional: {
                  interpretation: "Surveyor may determine functional scores are inflated without objective evidence of assistance levels. Terms like 'some help' or 'needs assistance' lack specificity required by CMS.",
                  financialImpact: "$1,500-$3,000 per episode recoupment if functional level downgraded",
                  auditType: "ADR/TPE Review"
                },
                bathing: {
                  interpretation: "Without documented shower chair use, grab bar locations, or specific caregiver actions during bathing, surveyor will default to lowest defensible score.",
                  financialImpact: "$200-$500 per episode if M1830 downscored by 2+ points",
                  auditType: "SMRC Targeted Review"
                },
                ambulation: {
                  interpretation: "Vague ambulation documentation (e.g., 'walks with difficulty') doesn't specify distance, surface, or device requirements per OASIS definitions.",
                  financialImpact: "$300-$600 per episode for M1860 adjustments",
                  auditType: "RAC Audit"
                },
                transfer: {
                  interpretation: "Missing weight-bearing status or transfer technique details make scores indefensible. Surveyor will question any score above 1 without specific assistance documentation.",
                  financialImpact: "$150-$400 per episode recoupment risk",
                  auditType: "ADR Review"
                },
                cognitive: {
                  interpretation: "Without BIMS score or specific orientation testing, cognitive impairment claims are unsupported. May affect multiple M-items and care plan justification.",
                  financialImpact: "$500-$1,200 episode impact across affected items",
                  auditType: "Comprehensive Review"
                },
                wound: {
                  interpretation: "Incomplete wound measurements or staging documentation violates M1306-M1342 requirements. Surveyor will question clinical group assignment.",
                  financialImpact: "$800-$2,000 clinical group reclassification risk",
                  auditType: "TPE/SMRC Review"
                },
                medication: {
                  interpretation: "Missing high-risk drug identification or drug regimen review documentation creates immediate compliance flag.",
                  financialImpact: "$200-$500 per episode + quality measure penalties",
                  auditType: "Quality Review"
                },
                homebound: {
                  interpretation: "Insufficient homebound criteria documentation may result in entire episode denial. Must document 2+ criteria with taxing effort details.",
                  financialImpact: "100% episode denial risk ($2,500-$4,000+)",
                  auditType: "Medical Necessity Review"
                }
              };

              const weaknessLower = weakness.toLowerCase();
              let scenario = auditScenarios.functional;
              if (weaknessLower.includes('bath') || weaknessLower.includes('shower')) scenario = auditScenarios.bathing;
              else if (weaknessLower.includes('ambul') || weaknessLower.includes('walk') || weaknessLower.includes('mobil')) scenario = auditScenarios.ambulation;
              else if (weaknessLower.includes('transfer')) scenario = auditScenarios.transfer;
              else if (weaknessLower.includes('cogn') || weaknessLower.includes('mental') || weaknessLower.includes('bims')) scenario = auditScenarios.cognitive;
              else if (weaknessLower.includes('wound') || weaknessLower.includes('ulcer') || weaknessLower.includes('skin')) scenario = auditScenarios.wound;
              else if (weaknessLower.includes('med') || weaknessLower.includes('drug')) scenario = auditScenarios.medication;
              else if (weaknessLower.includes('homebound') || weaknessLower.includes('home bound')) scenario = auditScenarios.homebound;

              return (
                <div key={idx} className="bg-white p-3 rounded border border-red-200">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-semibold text-red-900 text-sm">{idx + 1}. {weakness}</p>
                    <Badge className="bg-red-600 text-white text-xs flex-shrink-0">{scenario.auditType}</Badge>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="bg-orange-50 p-2 rounded border border-orange-200">
                      <p className="text-orange-800">
                        <strong>🔍 Surveyor Interpretation:</strong> {scenario.interpretation}
                      </p>
                    </div>
                    <div className="bg-red-50 p-2 rounded border border-red-300">
                      <p className="text-red-900 font-semibold">
                        <DollarSign className="w-3 h-3 inline mr-1" />
                        Financial Impact: {scenario.financialImpact}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 bg-red-200 p-2 rounded text-center">
            <p className="text-red-900 font-bold text-sm">
              ⚠️ Combined Maximum Risk Exposure: $2,000-$7,000+ per episode
            </p>
          </div>
        </div>
      )}

      {/* Pre-Audit Checklist */}
      <div className="bg-blue-100 p-4 rounded-lg border border-blue-300">
        <h5 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
          <ClipboardList className="w-4 h-4" />
          Pre-Audit Checklist
          <Badge variant="outline" className="ml-auto bg-blue-200 text-blue-800 text-xs">Complete Before Submission</Badge>
        </h5>
        <div className="space-y-2">
          {(summary.recommended_priority_fixes?.slice(0, 3) || [
            "Verify all functional scores have specific assistance level documentation",
            "Confirm homebound status with 2+ documented criteria",
            "Ensure medication reconciliation and high-risk drug review documented"
          ]).map((fix, idx) => (
            <div key={idx} className="flex items-start gap-3 bg-white p-3 rounded border border-blue-200">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                {idx + 1}
              </div>
              <div className="flex-1">
                <p className="text-sm text-blue-900 font-medium">{fix}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                    onClick={() => {
                      const relatedIssue = criticalMissing?.[idx] ||
                                           vagueDocumentation?.[idx] ||
                                           underscoringOpportunities?.[idx];
                      if (relatedIssue?.example || relatedIssue?.improved_language) {
                        onQuickFix(fix, relatedIssue.example || relatedIssue.improved_language);
                      }
                    }}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Apply Fix
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs text-blue-600"
                    aria-label="Copy checklist item"
                    title="Copy checklist item"
                    onClick={() => onCopy(fix, `checklist-${idx}`)}
                  >
                    {copiedText === `checklist-${idx}` ? (
                      <CheckCircle2 className="w-3 h-3 text-green-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 bg-green-100 p-3 rounded border border-green-200">
          <p className="text-green-800 text-xs">
            <strong>✓ Audit-Ready Tip:</strong> Completing these 3 items addresses approximately
            <strong> 70-80%</strong> of common audit findings. Document changes with timestamps
            and clinician signatures for maximum defensibility.
          </p>
        </div>
      </div>
    </div>
  );
}
