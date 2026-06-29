import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  Target,
  Plus
} from "lucide-react";
import { toast } from 'sonner';

export default function AICarePlanRecommendations({
  patient,
  visits = [],
  existingCarePlans = [],
  onAcceptRecommendation
}) {
  const ai = useAICall();
  const [recommendations, setRecommendations] = useState(null);
  const [acceptedIds, setAcceptedIds] = useState(new Set());
  const [dismissedIds, setDismissedIds] = useState(new Set());

  const analyzeAndRecommend = async () => {
    if (!patient) return;

    // accepted/dismissed are keyed by array index, so a fresh result must start with
    // a clean slate or the new item at a reused index inherits the prior state.
    setAcceptedIds(new Set());
    setDismissedIds(new Set());

    try {
      // Get recent visits for context
      const recentVisits = visits.slice(0, 5);
      const visitSummary = recentVisits.map(v => ({
        date: v.visit_date,
        type: v.visit_type,
        notes: v.nurse_notes?.substring(0, 200),
        vitals: v.vital_signs
      }));

      // Analyze existing care plans
      const activeCarePlans = existingCarePlans.filter(cp => cp.status === 'active');
      const carePlanSummary = activeCarePlans.map(cp => ({
        problem: cp.problem,
        goal: cp.goal,
        status: cp.status,
        created: cp.created_date
      }));

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert clinical care coordinator analyzing patient data to recommend new care plan goals.

PATIENT PROFILE:
Name: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}
Functional Status: ${patient.functional_status?.ambulation || 'Unknown'}, ADL: ${patient.functional_status?.adl_independence || 'Unknown'}
Cognitive Status: ${patient.functional_status?.cognitive_status || 'Unknown'}
Fall Risk: ${patient.functional_status?.fall_risk || 'Unknown'}

RECENT VISIT HISTORY:
${visitSummary.map((v, i) => `Visit ${i+1} (${v.date}): ${v.type} - ${v.notes || 'No notes'}`).join('\n')}

EXISTING ACTIVE CARE PLANS (${activeCarePlans.length}):
${carePlanSummary.map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') || 'None'}

Based on this comprehensive patient data, recommend 2-4 NEW care plan goals that:

1. ADDRESS GAPS: Identify unaddressed clinical needs based on diagnosis, functional status, and visit patterns
2. ARE EVIDENCE-BASED: Use clinical best practices for the patient's conditions
3. ARE PATIENT-SPECIFIC: Consider the patient's unique situation, limitations, and progress
4. COMPLEMENT EXISTING PLANS: Don't duplicate existing care plans, but build on them
5. ARE ACTIONABLE: Provide clear, measurable goals that nurses can implement

For each recommendation, provide:
- Strong clinical rationale based on patient data
- Specific triggers that indicate this need (what you observed in the data)
- Expected outcomes and benefits
- Priority level based on clinical urgency
- Recommended interventions

Return JSON:`,
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  goal: { type: "string" },
                  rationale: { type: "string" },
                  clinical_triggers: { type: "array", items: { type: "string" } },
                  expected_outcomes: { type: "array", items: { type: "string" } },
                  interventions: { type: "array", items: { type: "string" } },
                  priority: { type: "string", enum: ["high", "medium", "low"] },
                  baseline_measurement: { type: "string" },
                  frequency: { type: "string" },
                  target_days: { type: "number" },
                  evidence_source: { type: "string" }
                }
              }
            },
            analysis_summary: { type: "string" },
            overall_assessment: { type: "string" }
          }
        }
      });

      setRecommendations(result);
    } catch (error) {
      console.error("Analysis error:", error);
      toast.error("Failed to generate recommendations. Please try again.");
    }
  };

  const handleAcceptRecommendation = async (recommendation, index) => {
    if (onAcceptRecommendation) {
      await onAcceptRecommendation(recommendation);
      setAcceptedIds(prev => new Set([...prev, index]));
    }
  };

  const getPriorityColor = (priority) => {
    const colors = {
      high: "bg-red-100 text-red-800 border-red-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      low: "bg-blue-100 text-blue-800 border-blue-300"
    };
    return colors[priority] || "bg-slate-100 text-slate-800";
  };

  return (
    <Card className="border-2 border-navy-300">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" />
          AI Care Plan Recommendations
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {!recommendations ? (
          <div className="space-y-3">
            <Alert className="bg-navy-50 border-navy-200">
              <AlertDescription className="text-sm text-navy-900">
                AI will analyze patient diagnosis, visit history, functional status, and existing care plans to recommend personalized care plan goals.
              </AlertDescription>
            </Alert>
            <Button
              onClick={analyzeAndRecommend}
              disabled={ai.loading || !patient}
              className="w-full bg-navy-600 hover:bg-navy-700"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing Patient Data...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate Recommendations</>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Analysis Summary */}
            {recommendations.analysis_summary && (
              <Alert className="bg-blue-50 border-blue-200">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-900">
                  <strong>Analysis:</strong> {recommendations.analysis_summary}
                </AlertDescription>
              </Alert>
            )}

            {/* Overall Assessment */}
            {recommendations.overall_assessment && (
              <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                <p className="text-sm text-indigo-900">
                  <strong>Clinical Assessment:</strong> {recommendations.overall_assessment}
                </p>
              </div>
            )}

            {/* Recommendations */}
            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-3">
                {recommendations.recommendations?.map((rec, idx) => {
                  const isAccepted = acceptedIds.has(idx);
                  const isDismissed = dismissedIds.has(idx);

                  return (
                    <Card
                      key={idx}
                      className={`border-2 ${isAccepted ? 'border-green-300 bg-green-50' : isDismissed ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-navy-200'}`}
                    >
                      <CardContent className="p-4 space-y-3">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge className={getPriorityColor(rec.priority)}>
                                {rec.priority} priority
                              </Badge>
                              {isAccepted && (
                                <Badge className="bg-green-600 text-white">
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Accepted
                                </Badge>
                              )}
                              {isDismissed && (
                                <Badge className="bg-slate-400 text-white">
                                  Dismissed
                                </Badge>
                              )}
                            </div>
                            <h4 className="font-semibold text-slate-900">{rec.problem}</h4>
                          </div>
                        </div>

                        {/* Goal */}
                        <div className="bg-white p-3 rounded-lg border">
                          <p className="text-xs font-medium text-slate-500 mb-1">SMART Goal:</p>
                          <p className="text-sm text-slate-900 font-medium">{rec.goal}</p>
                        </div>

                        {/* Rationale */}
                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                          <p className="text-xs font-medium text-blue-800 mb-1 flex items-center gap-1">
                            <Target className="w-3 h-3" /> Clinical Rationale:
                          </p>
                          <p className="text-sm text-blue-900">{rec.rationale}</p>
                        </div>

                        {/* Clinical Triggers */}
                        {rec.clinical_triggers?.length > 0 && (
                          <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
                            <p className="text-xs font-medium text-orange-800 mb-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Identified Triggers:
                            </p>
                            <ul className="text-xs text-orange-900 space-y-1">
                              {rec.clinical_triggers.map((trigger, i) => (
                                <li key={i} className="flex items-start gap-1">
                                  <span className="text-orange-600 mt-0.5">•</span>
                                  <span>{trigger}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Interventions */}
                        <div>
                          <p className="text-xs font-medium text-slate-600 mb-2">Recommended Interventions:</p>
                          <ul className="text-sm text-slate-700 space-y-1">
                            {rec.interventions?.map((intervention, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                                <span>{intervention}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Expected Outcomes */}
                        {rec.expected_outcomes?.length > 0 && (
                          <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                            <p className="text-xs font-medium text-green-800 mb-1 flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" /> Expected Outcomes:
                            </p>
                            <ul className="text-xs text-green-900 space-y-1">
                              {rec.expected_outcomes.map((outcome, i) => (
                                <li key={i} className="flex items-start gap-1">
                                  <span className="text-green-600 mt-0.5">✓</span>
                                  <span>{outcome}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Metadata */}
                        <div className="flex gap-3 text-xs text-slate-500 pt-2 border-t">
                          <span><strong>Baseline:</strong> {rec.baseline_measurement}</span>
                          <span><strong>Frequency:</strong> {rec.frequency}</span>
                          <span><strong>Target:</strong> {rec.target_days} days</span>
                        </div>

                        {rec.evidence_source && (
                          <p className="text-xs text-slate-500 italic">
                            Evidence: {rec.evidence_source}
                          </p>
                        )}

                        {/* Actions */}
                        {!isAccepted && !isDismissed && (
                          <div className="flex gap-2 pt-3 border-t">
                            <Button
                              size="sm"
                              className="flex-1 bg-green-600 hover:bg-green-700"
                              onClick={() => handleAcceptRecommendation(rec, idx)}
                            >
                              <Plus className="w-4 h-4 mr-1" /> Add to Care Plans
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDismissedIds(prev => new Set([...prev, idx]))}
                            >
                              Dismiss
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="flex gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setRecommendations(null);
                  setAcceptedIds(new Set());
                  setDismissedIds(new Set());
                }}
                className="flex-1"
              >
                Generate New Recommendations
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}