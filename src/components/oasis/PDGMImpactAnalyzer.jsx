import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Activity,
  Loader2,
  ArrowRight,
  Target,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  Zap
} from "lucide-react";
import { calculatePDGM } from "@/functions/calculatePDGM";

export default function PDGMImpactAnalyzer({
  currentPdgmData,
  suggestedChanges,
  onAnalysisComplete
}) {
  const ai = useAICall();
  const [impactAnalysis, setImpactAnalysis] = useState(null);

  const analyzePDGMImpact = async () => {
    if (!currentPdgmData || !suggestedChanges) return;


    try {
      // Build modified PDGM data based on suggestions
      const modifiedPdgmData = { ...currentPdgmData };
      
      // Apply suggested changes to create hypothetical improved assessment
      if (suggestedChanges.functional_improvements) {
        modifiedPdgmData.functional_scores = {
          ...currentPdgmData.functional_scores,
          ...suggestedChanges.functional_improvements
        };
      }

      if (suggestedChanges.comorbidity_additions) {
        modifiedPdgmData.comorbidities = [
          ...(currentPdgmData.comorbidities || []),
          ...suggestedChanges.comorbidity_additions
        ];
      }

      if (suggestedChanges.clinical_items) {
        modifiedPdgmData.clinical_items = {
          ...currentPdgmData.clinical_items,
          ...suggestedChanges.clinical_items
        };
      }

      // Calculate both current and improved PDGM
      const pdgmComparison = await calculatePDGM({
        pdgmData: currentPdgmData,
        correctedPdgmData: modifiedPdgmData
      });

      // Get detailed AI analysis of the changes
      const aiAnalysis = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a PDGM reimbursement optimization expert. Analyze the impact of suggested documentation improvements on PDGM payment.

CURRENT PDGM DATA:
${JSON.stringify(pdgmComparison.data.original, null, 2)}

IMPROVED PDGM DATA (with suggested changes):
${JSON.stringify(pdgmComparison.data.corrected, null, 2)}

SUGGESTED CHANGES:
${JSON.stringify(suggestedChanges, null, 2)}

Provide comprehensive PDGM impact analysis:

1. CASE-MIX COMPONENT BREAKDOWN
   - Analyze EACH case-mix component change:
     * Clinical Group Weight: original vs new, what caused the change
     * Functional Impairment Level: original vs new, specific M-items that drove change
     * Comorbidity Adjustment: original vs new, which comorbidities added/changed
   - Calculate the dollar impact of EACH component change
   - Identify which change had the biggest financial impact

2. FUNCTIONAL LEVEL ANALYSIS
   - Current functional level (Low/Medium/High) and points
   - New functional level and points after changes
   - SPECIFIC M-items that moved the functional level:
     * Which M-items were scored differently
     * How many points each change added
     * Whether the change crossed a threshold (e.g., Low → Medium)
   - Clinical justification required for each functional score change

3. COMORBIDITY OPTIMIZATION
   - Current comorbidities captured and their point values
   - New comorbidities added and their point values
   - Whether comorbidity adjustment tier changed (None/Low/High)
   - Which diagnoses support each new comorbidity
   - Documentation required to justify each comorbidity

4. CLINICAL GROUP IMPACT
   - Whether clinical grouping changed
   - If yes, what specific documentation drove the reclassification
   - Payment differential from clinical group change alone

5. PAYMENT OPTIMIZATION STRATEGY
   - Total payment increase: $ and %
   - ROI analysis: documentation time vs payment gain
   - Priority ranking of changes (which to implement first for max impact)
   - Risk assessment: compliance risk vs reward for each change

6. IMPLEMENTATION ROADMAP
   - Immediate actions (can implement on next visit)
   - Short-term improvements (need additional assessment)
   - Documentation templates needed
   - Training requirements for staff

7. COMPLIANCE SAFEGUARDS
   - Which changes require additional clinical evidence
   - Warning flags for aggressive scoring
   - CMS audit risk assessment
   - Required supporting documentation

Return detailed JSON analysis:`,
        response_json_schema: {
          type: "object",
          properties: {
            case_mix_breakdown: {
              type: "object",
              properties: {
                clinical_weight_impact: {
                  type: "object",
                  properties: {
                    original: { type: "number" },
                    new: { type: "number" },
                    change: { type: "number" },
                    dollar_impact: { type: "number" },
                    explanation: { type: "string" }
                  }
                },
                functional_impact: {
                  type: "object",
                  properties: {
                    original_level: { type: "string" },
                    new_level: { type: "string" },
                    original_multiplier: { type: "number" },
                    new_multiplier: { type: "number" },
                    dollar_impact: { type: "number" },
                    driving_m_items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          m_item: { type: "string" },
                          original_score: { type: "number" },
                          new_score: { type: "number" },
                          points_added: { type: "number" },
                          clinical_justification: { type: "string" }
                        }
                      }
                    }
                  }
                },
                comorbidity_impact: {
                  type: "object",
                  properties: {
                    original_tier: { type: "string" },
                    new_tier: { type: "string" },
                    original_multiplier: { type: "number" },
                    new_multiplier: { type: "number" },
                    dollar_impact: { type: "number" },
                    new_comorbidities: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          comorbidity: { type: "string" },
                          icd10_codes: { type: "array", items: { type: "string" } },
                          documentation_required: { type: "string" }
                        }
                      }
                    }
                  }
                }
              }
            },
            payment_summary: {
              type: "object",
              properties: {
                original_payment: { type: "number" },
                optimized_payment: { type: "number" },
                total_increase: { type: "number" },
                percentage_increase: { type: "number" },
                annual_impact: { type: "number" }
              }
            },
            optimization_strategy: {
              type: "object",
              properties: {
                priority_changes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      change: { type: "string" },
                      payment_impact: { type: "number" },
                      implementation_effort: { type: "string" },
                      priority_rank: { type: "number" },
                      roi_score: { type: "number" }
                    }
                  }
                },
                immediate_actions: { type: "array", items: { type: "string" } },
                short_term_improvements: { type: "array", items: { type: "string" } },
                documentation_templates_needed: { type: "array", items: { type: "string" } }
              }
            },
            compliance_safeguards: {
              type: "object",
              properties: {
                high_risk_changes: { type: "array", items: { type: "string" } },
                additional_evidence_required: { type: "array", items: { type: "string" } },
                audit_risk_level: { type: "string" },
                supporting_documentation: { type: "array", items: { type: "string" } }
              }
            },
            implementation_roadmap: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  phase: { type: "string" },
                  timeline: { type: "string" },
                  actions: { type: "array", items: { type: "string" } },
                  expected_payment_gain: { type: "number" }
                }
              }
            }
          }
        }
      });

      setImpactAnalysis({
        pdgmComparison: pdgmComparison.data,
        aiAnalysis: aiAnalysis
      });

      if (onAnalysisComplete) {
        onAnalysisComplete({
          pdgmComparison: pdgmComparison.data,
          aiAnalysis: aiAnalysis
        });
      }
    } catch (error) {
      console.error("PDGM impact analysis error:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  const getEffortColor = (effort) => {
    const colors = {
      low: 'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-orange-100 text-orange-800'
    };
    return colors[effort] || 'bg-slate-100 text-slate-800';
  };

  const getRiskColor = (risk) => {
    const colors = {
      low: 'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-red-100 text-red-800'
    };
    return colors[risk] || 'bg-slate-100 text-slate-800';
  };

  return (
    <Card className="border-2 border-green-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-green-50 to-emerald-50">
        <CardTitle className="text-lg flex items-center gap-2">
          <Target className="w-5 h-5 text-green-600" />
          PDGM Impact Analyzer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {!impactAnalysis ? (
          <div className="text-center py-6">
            <p className="text-sm text-slate-600 mb-4">
              Analyze the precise PDGM payment impact of suggested documentation improvements
            </p>
            <Button
              onClick={analyzePDGMImpact}
              disabled={ai.loading || !currentPdgmData || !suggestedChanges}
              className="bg-green-600 hover:bg-green-700"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing Impact...</>
              ) : (
                <><BarChart3 className="w-4 h-4 mr-2" /> Analyze PDGM Impact</>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Payment Summary */}
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border-2 border-green-300">
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="text-center">
                  <p className="text-xs text-slate-600 mb-1">Current Payment</p>
                  <p className="text-xl font-bold text-slate-700">
                    {formatCurrency(impactAnalysis.aiAnalysis.payment_summary?.original_payment)}
                  </p>
                </div>
                <div className="flex items-center justify-center">
                  <ArrowRight className="w-6 h-6 text-green-600" />
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-600 mb-1">Optimized Payment</p>
                  <p className="text-xl font-bold text-green-700">
                    {formatCurrency(impactAnalysis.aiAnalysis.payment_summary?.optimized_payment)}
                  </p>
                </div>
              </div>
              <div className="text-center bg-white p-3 rounded border border-green-200">
                <p className="text-sm text-slate-600">Total Increase</p>
                <p className="text-2xl font-bold text-green-700">
                  +{formatCurrency(impactAnalysis.aiAnalysis.payment_summary?.total_increase)}
                  <span className="text-sm ml-2">
                    (+{impactAnalysis.aiAnalysis.payment_summary?.percentage_increase}%)
                  </span>
                </p>
                {impactAnalysis.aiAnalysis.payment_summary?.annual_impact && (
                  <p className="text-xs text-slate-600 mt-1">
                    Annual Impact: {formatCurrency(impactAnalysis.aiAnalysis.payment_summary.annual_impact)}
                  </p>
                )}
              </div>
            </div>

            {/* Case-Mix Component Breakdown */}
            <div className="space-y-3">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Case-Mix Component Breakdown
              </h3>

              {/* Clinical Weight */}
              {impactAnalysis.aiAnalysis.case_mix_breakdown?.clinical_weight_impact && (
                <div className="bg-blue-50 p-3 rounded border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-blue-900">Clinical Group Weight</p>
                    <Badge className="bg-blue-600 text-white">
                      +{formatCurrency(impactAnalysis.aiAnalysis.case_mix_breakdown.clinical_weight_impact.dollar_impact)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs mb-2">
                    <span className="text-blue-700">
                      {impactAnalysis.aiAnalysis.case_mix_breakdown.clinical_weight_impact.original}
                    </span>
                    <ArrowRight className="w-3 h-3 text-blue-500" />
                    <span className="text-blue-900 font-bold">
                      {impactAnalysis.aiAnalysis.case_mix_breakdown.clinical_weight_impact.new}
                    </span>
                  </div>
                  <p className="text-xs text-blue-800">
                    {impactAnalysis.aiAnalysis.case_mix_breakdown.clinical_weight_impact.explanation}
                  </p>
                </div>
              )}

              {/* Functional Impact */}
              {impactAnalysis.aiAnalysis.case_mix_breakdown?.functional_impact && (
                <div className="bg-navy-50 p-3 rounded border border-navy-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-navy-900">Functional Impairment Level</p>
                    <Badge className="bg-navy-600 text-white">
                      +{formatCurrency(impactAnalysis.aiAnalysis.case_mix_breakdown.functional_impact.dollar_impact)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs mb-2">
                    <Badge variant="outline" className="text-navy-700">
                      {impactAnalysis.aiAnalysis.case_mix_breakdown.functional_impact.original_level}
                    </Badge>
                    <ArrowRight className="w-3 h-3 text-navy-500" />
                    <Badge className="bg-navy-600 text-white">
                      {impactAnalysis.aiAnalysis.case_mix_breakdown.functional_impact.new_level}
                    </Badge>
                  </div>
                  {impactAnalysis.aiAnalysis.case_mix_breakdown.functional_impact.driving_m_items?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-semibold text-navy-800">Key M-Item Changes:</p>
                      {impactAnalysis.aiAnalysis.case_mix_breakdown.functional_impact.driving_m_items.map((item, idx) => (
                        <div key={idx} className="bg-white p-2 rounded text-xs border border-navy-100">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-navy-900">{item.m_item}</span>
                            <span className="text-green-700 font-bold">+{item.points_added} pts</span>
                          </div>
                          <div className="flex items-center gap-2 text-navy-700 mb-1">
                            <span>Score: {item.original_score}</span>
                            <ArrowRight className="w-3 h-3" />
                            <span className="font-bold">{item.new_score}</span>
                          </div>
                          <p className="text-navy-600 italic">{item.clinical_justification}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Comorbidity Impact */}
              {impactAnalysis.aiAnalysis.case_mix_breakdown?.comorbidity_impact && (
                <div className="bg-orange-50 p-3 rounded border border-orange-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-orange-900">Comorbidity Adjustment</p>
                    <Badge className="bg-orange-600 text-white">
                      +{formatCurrency(impactAnalysis.aiAnalysis.case_mix_breakdown.comorbidity_impact.dollar_impact)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs mb-2">
                    <Badge variant="outline" className="text-orange-700">
                      {impactAnalysis.aiAnalysis.case_mix_breakdown.comorbidity_impact.original_tier}
                    </Badge>
                    <ArrowRight className="w-3 h-3 text-orange-500" />
                    <Badge className="bg-orange-600 text-white">
                      {impactAnalysis.aiAnalysis.case_mix_breakdown.comorbidity_impact.new_tier}
                    </Badge>
                  </div>
                  {impactAnalysis.aiAnalysis.case_mix_breakdown.comorbidity_impact.new_comorbidities?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-semibold text-orange-800">New Comorbidities:</p>
                      {impactAnalysis.aiAnalysis.case_mix_breakdown.comorbidity_impact.new_comorbidities.map((comorbidity, idx) => (
                        <div key={idx} className="bg-white p-2 rounded text-xs border border-orange-100">
                          <p className="font-medium text-orange-900">{comorbidity.comorbidity}</p>
                          <p className="text-orange-700">ICD-10: {comorbidity.icd10_codes?.join(', ')}</p>
                          <p className="text-orange-600 italic text-[10px] mt-1">
                            Required: {comorbidity.documentation_required}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Optimization Strategy */}
            {impactAnalysis.aiAnalysis.optimization_strategy?.priority_changes && (
              <div className="bg-gradient-to-r from-indigo-50 to-navy-50 p-4 rounded-lg border border-indigo-200">
                <h3 className="font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Priority Optimization Strategy
                </h3>
                <div className="space-y-2">
                  {impactAnalysis.aiAnalysis.optimization_strategy.priority_changes
                    .sort((a, b) => a.priority_rank - b.priority_rank)
                    .map((change, idx) => (
                      <div key={idx} className="bg-white p-3 rounded border">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-indigo-600 text-white">#{change.priority_rank}</Badge>
                            <span className="text-sm font-medium text-slate-900">{change.change}</span>
                          </div>
                          <Badge className="bg-green-600 text-white">
                            +{formatCurrency(change.payment_impact)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={getEffortColor(change.implementation_effort)}>
                            {change.implementation_effort} effort
                          </Badge>
                          <span className="text-xs text-slate-600">
                            ROI Score: <strong>{change.roi_score}/10</strong>
                          </span>
                        </div>
                      </div>
                    ))}
                </div>

                {impactAnalysis.aiAnalysis.optimization_strategy.immediate_actions?.length > 0 && (
                  <div className="mt-3 bg-green-50 p-3 rounded border border-green-200">
                    <p className="text-xs font-semibold text-green-800 mb-2">🚀 Immediate Actions:</p>
                    <ul className="text-xs text-green-700 space-y-1">
                      {impactAnalysis.aiAnalysis.optimization_strategy.immediate_actions.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-1">
                          <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Compliance Safeguards */}
            {impactAnalysis.aiAnalysis.compliance_safeguards && (
              <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                <h3 className="font-semibold text-yellow-900 mb-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Compliance Safeguards
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-yellow-800">Audit Risk Level:</span>
                    <Badge className={getRiskColor(impactAnalysis.aiAnalysis.compliance_safeguards.audit_risk_level)}>
                      {impactAnalysis.aiAnalysis.compliance_safeguards.audit_risk_level}
                    </Badge>
                  </div>

                  {impactAnalysis.aiAnalysis.compliance_safeguards.high_risk_changes?.length > 0 && (
                    <Alert className="bg-red-50 border-red-200">
                      <AlertDescription className="text-xs text-red-800">
                        <p className="font-semibold mb-1">⚠️ High-Risk Changes:</p>
                        <ul className="space-y-0.5">
                          {impactAnalysis.aiAnalysis.compliance_safeguards.high_risk_changes.map((risk, idx) => (
                            <li key={idx}>• {risk}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  {impactAnalysis.aiAnalysis.compliance_safeguards.additional_evidence_required?.length > 0 && (
                    <div className="bg-white p-2 rounded border">
                      <p className="text-xs font-semibold text-yellow-800 mb-1">📋 Additional Evidence Required:</p>
                      <ul className="text-xs text-yellow-700 space-y-0.5">
                        {impactAnalysis.aiAnalysis.compliance_safeguards.additional_evidence_required.map((evidence, idx) => (
                          <li key={idx}>• {evidence}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Implementation Roadmap */}
            {impactAnalysis.aiAnalysis.implementation_roadmap?.length > 0 && (
              <div className="bg-gradient-to-r from-navy-50 to-blue-50 p-4 rounded-lg border border-navy-200">
                <h3 className="font-semibold text-navy-900 mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Implementation Roadmap
                </h3>
                <div className="space-y-3">
                  {impactAnalysis.aiAnalysis.implementation_roadmap.map((phase, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{phase.phase}</p>
                          <p className="text-xs text-slate-600">{phase.timeline}</p>
                        </div>
                        <Badge className="bg-navy-600 text-white">
                          +{formatCurrency(phase.expected_payment_gain)}
                        </Badge>
                      </div>
                      <ul className="text-xs text-slate-700 space-y-1">
                        {phase.actions?.map((action, aIdx) => (
                          <li key={aIdx} className="flex items-start gap-1">
                            <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0 text-navy-600" />
                            {action}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button
              onClick={analyzePDGMImpact}
              variant="outline"
              size="sm"
              className="w-full"
            >
              Re-analyze Impact
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}