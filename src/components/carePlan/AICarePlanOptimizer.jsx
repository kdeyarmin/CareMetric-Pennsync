import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  Target,
  Plus,
  Edit3,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  X,
  Loader2
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export default function AICarePlanOptimizer({
  enhancedNote,
  patientData,
  existingCarePlans = [],
  recentVisits = [],
  diagnosis,
  onCreateCarePlan,
  onModifyCarePlan,
  autoAnalyze = false
}) {
  const ai = useAICall();
  const [recommendations, setRecommendations] = useState(null);
  const [dismissedIds, setDismissedIds] = useState(new Set());

  const analyzeCarePlans = useCallback(async () => {
    if (!enhancedNote) return;
    
    try {
      // Build comprehensive context
      const activeCarePlans = existingCarePlans.filter(cp => cp.status === 'active');
      const carePlansContext = activeCarePlans.map(cp => 
        `- Problem: ${cp.problem}\n  Goal: ${cp.goal}\n  Interventions: ${cp.interventions?.join(', ')}\n  Target: ${cp.target_date || 'Not set'}`
      ).join('\n');

      const visitsContext = recentVisits.slice(0, 3).map(v => 
        `- ${v.visit_date} (${v.visit_type}): ${v.nurse_notes?.substring(0, 200)}...`
      ).join('\n');

      const prompt = `You are an expert home health clinical care coordinator. Analyze this patient's current status and care plans to identify opportunities for proactive, evidence-based improvements.

PATIENT CONTEXT:
- Primary Diagnosis: ${diagnosis || patientData?.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patientData?.secondary_diagnoses?.join(', ') || 'None listed'}
- Age: ${patientData?.date_of_birth ? new Date().getFullYear() - new Date(patientData.date_of_birth).getFullYear() : 'Unknown'}
- Functional Status: ${patientData?.functional_status?.ambulation || 'Not assessed'}, ${patientData?.functional_status?.adl_independence || 'Not assessed'} ADL independence
- Cognitive Status: ${patientData?.functional_status?.cognitive_status || 'Not assessed'}
- Fall Risk: ${patientData?.functional_status?.fall_risk || 'Not assessed'}
- Current Medications: ${patientData?.current_medications?.length || 0} medications
- Allergies: ${patientData?.allergies || 'None documented'}

RECENT VISIT SUMMARY:
${visitsContext || 'No recent visits documented'}

CURRENT ENHANCED CLINICAL NOTE:
${enhancedNote}

EXISTING ACTIVE CARE PLANS (${activeCarePlans.length}):
${carePlansContext || 'No active care plans'}

ANALYSIS REQUIREMENTS:
1. **Gap Analysis**: Identify clinical needs or risks mentioned in the note that are NOT addressed by current care plans
2. **Optimization Opportunities**: Suggest modifications to existing care plans based on recent progress or new findings
3. **Proactive Interventions**: Recommend preventive care plans based on risk factors (falls, medication adherence, nutrition, etc.)
4. **Evidence-Based Goals**: Ensure all suggestions align with home health best practices and Medicare compliance

For each recommendation, provide:
- Type: "new_care_plan" or "modify_existing" or "preventive_focus"
- Severity: "high" (critical gap), "medium" (optimization), or "low" (enhancement)
- Problem statement (clinical diagnosis-based)
- SMART goal (Specific, Measurable, Achievable, Relevant, Time-bound)
- Evidence-based interventions (3-5 specific nursing actions)
- Rationale (why this is needed based on the note/context)
- If modifying existing: which care plan ID and what changes

Return JSON:
{
  "overall_assessment": "2-3 sentence summary of patient's care plan status",
  "identified_gaps": ["gap1", "gap2"],
  "recommendations": [
    {
      "type": "new_care_plan" | "modify_existing" | "preventive_focus",
      "severity": "high" | "medium" | "low",
      "problem": "string",
      "goal": "string (SMART format)",
      "interventions": ["intervention1", "intervention2", "intervention3"],
      "rationale": "string",
      "evidence_basis": "string (e.g., 'Medicare home health guidelines', 'Fall prevention best practices')",
      "existing_care_plan_id": "string (if modify_existing)",
      "suggested_changes": "string (if modify_existing)",
      "estimated_duration_weeks": number
    }
  ],
  "strengths": ["strength1", "strength2"] // What's working well in current care plans
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_assessment: { type: "string" },
            identified_gaps: { type: "array", items: { type: "string" } },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  severity: { type: "string" },
                  problem: { type: "string" },
                  goal: { type: "string" },
                  interventions: { type: "array", items: { type: "string" } },
                  rationale: { type: "string" },
                  evidence_basis: { type: "string" },
                  existing_care_plan_id: { type: "string" },
                  suggested_changes: { type: "string" },
                  estimated_duration_weeks: { type: "number" }
                }
              }
            },
            strengths: { type: "array", items: { type: "string" } }
          }
        }
      });

      setRecommendations(result);
    } catch (error) {
      console.error('Error analyzing care plans:', error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [enhancedNote, existingCarePlans, recentVisits, diagnosis, patientData]);

  useEffect(() => {
    if (autoAnalyze && enhancedNote && !recommendations) {
      analyzeCarePlans();
    }
  }, [autoAnalyze, enhancedNote, recommendations, analyzeCarePlans]);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'new_care_plan': return <Plus className="w-4 h-4" />;
      case 'modify_existing': return <Edit3 className="w-4 h-4" />;
      case 'preventive_focus': return <AlertTriangle className="w-4 h-4" />;
      default: return <Target className="w-4 h-4" />;
    }
  };

  const handleApplyRecommendation = async (rec, index) => {
    try {
      if (rec.type === 'modify_existing' && rec.existing_care_plan_id) {
        await onModifyCarePlan?.({
          id: rec.existing_care_plan_id,
          suggested_changes: rec.suggested_changes,
          new_interventions: rec.interventions
        });
      } else {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + (rec.estimated_duration_weeks || 8) * 7);
        
        await onCreateCarePlan?.({
          problem: rec.problem,
          goal: rec.goal,
          interventions: rec.interventions,
          // Local calendar date — toISOString() converts to UTC and, for a plan
          // created in the evening in any US timezone, rolls target_date a day late.
          target_date: `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`,
          frequency: 'Each visit',
          baseline_measurement: 'To be established on next visit',
          status: 'active'
        });
      }
      
      setDismissedIds(prev => new Set([...prev, `rec-${index}`]));
    } catch (error) {
      console.error('Error applying recommendation:', error);
    }
  };

  const handleDismiss = (index) => {
    setDismissedIds(prev => new Set([...prev, `rec-${index}`]));
  };

  const activeRecommendations = recommendations?.recommendations?.filter(
    (_, idx) => !dismissedIds.has(`rec-${idx}`)
  ) || [];

  if (!enhancedNote) {
    return (
      <Alert>
        <Lightbulb className="w-4 h-4" />
        <AlertDescription>
          Complete and enhance your clinical note to receive AI-powered care plan recommendations.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            AI Care Plan Optimizer
          </CardTitle>
          {!recommendations && (
            <Button
              onClick={analyzeCarePlans}
              disabled={ai.loading}
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {ai.loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Analyze Care Plans
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {ai.loading && (
          <div className="flex items-center gap-3 p-4 bg-indigo-50 rounded-lg">
            <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
            <div>
              <p className="text-sm font-medium text-indigo-900">Analyzing patient needs...</p>
              <p className="text-xs text-indigo-700">Reviewing clinical note, history, and current care plans</p>
            </div>
          </div>
        )}

        {recommendations && (
          <>
            {/* Overall Assessment */}
            <Alert className="bg-indigo-50 border-indigo-200">
              <TrendingUp className="w-4 h-4 text-indigo-600" />
              <AlertDescription className="text-indigo-900">
                <p className="font-semibold mb-1">Care Plan Assessment</p>
                <p className="text-sm">{recommendations.overall_assessment}</p>
              </AlertDescription>
            </Alert>

            {/* Strengths */}
            {recommendations.strengths?.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-green-900 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Current Strengths
                </p>
                <ul className="space-y-1">
                  {recommendations.strengths.map((strength, idx) => (
                    <li key={idx} className="text-xs text-green-800 flex items-start gap-2">
                      <span className="mt-0.5">•</span>
                      <span>{strength}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Identified Gaps */}
            {recommendations.identified_gaps?.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-orange-900 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Identified Care Gaps
                </p>
                <ul className="space-y-1">
                  {recommendations.identified_gaps.map((gap, idx) => (
                    <li key={idx} className="text-xs text-orange-800 flex items-start gap-2">
                      <span className="mt-0.5">•</span>
                      <span>{gap}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommendations */}
            {activeRecommendations.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-900">
                  Recommendations ({activeRecommendations.length})
                </p>
                
                <Accordion type="single" collapsible className="space-y-2">
                  {activeRecommendations.map((rec, _idx) => {
                    const originalIdx = recommendations.recommendations.indexOf(rec);
                    return (
                      <AccordionItem 
                        key={originalIdx} 
                        value={`rec-${originalIdx}`}
                        className={`border-2 rounded-lg ${getSeverityColor(rec.severity)}`}
                      >
                        <AccordionTrigger className="px-4 hover:no-underline">
                          <div className="flex items-center gap-3 flex-1 text-left">
                            {getTypeIcon(rec.type)}
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm">{rec.problem}</span>
                                <Badge variant="outline" className="text-xs">
                                  {(rec.type || '').replace(/_/g, ' ')}
                                </Badge>
                                <Badge className={getSeverityColor(rec.severity)}>
                                  {rec.severity}
                                </Badge>
                              </div>
                              <p className="text-xs text-slate-600">{rec.goal}</p>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 space-y-3">
                          {/* Rationale */}
                          <div>
                            <p className="text-xs font-semibold text-slate-700 mb-1">Why This Matters:</p>
                            <p className="text-xs text-slate-600">{rec.rationale}</p>
                          </div>

                          {/* Evidence Basis */}
                          {rec.evidence_basis && (
                            <div className="bg-white/50 rounded p-2">
                              <p className="text-xs font-semibold text-slate-700 mb-1">Evidence Basis:</p>
                              <p className="text-xs text-slate-600 italic">{rec.evidence_basis}</p>
                            </div>
                          )}

                          {/* Goal */}
                          <div>
                            <p className="text-xs font-semibold text-slate-700 mb-1">SMART Goal:</p>
                            <p className="text-xs text-slate-800 font-medium">{rec.goal}</p>
                          </div>

                          {/* Interventions */}
                          <div>
                            <p className="text-xs font-semibold text-slate-700 mb-1">
                              Evidence-Based Interventions:
                            </p>
                            <ul className="space-y-1">
                              {rec.interventions?.map((intervention, iIdx) => (
                                <li key={iIdx} className="text-xs text-slate-700 flex items-start gap-2">
                                  <CheckCircle2 className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                                  <span>{intervention}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Suggested Changes (for modifications) */}
                          {rec.type === 'modify_existing' && rec.suggested_changes && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
                              <p className="text-xs font-semibold text-yellow-900 mb-1">
                                Suggested Changes to Existing Plan:
                              </p>
                              <p className="text-xs text-yellow-800">{rec.suggested_changes}</p>
                            </div>
                          )}

                          {/* Duration */}
                          {rec.estimated_duration_weeks && (
                            <p className="text-xs text-slate-500">
                              Estimated Duration: {rec.estimated_duration_weeks} weeks
                            </p>
                          )}

                          {/* Actions */}
                          <div className="flex gap-2 pt-2 border-t">
                            <Button
                              size="sm"
                              onClick={() => handleApplyRecommendation(rec, originalIdx)}
                              className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              {rec.type === 'modify_existing' ? 'Apply Changes' : 'Create Care Plan'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDismiss(originalIdx)}
                            >
                              <X className="w-3 h-3 mr-1" />
                              Dismiss
                            </Button>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </div>
            )}

            {activeRecommendations.length === 0 && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  <p className="font-semibold">Care Plans Optimized</p>
                  <p className="text-sm">All recommendations have been addressed or dismissed.</p>
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}