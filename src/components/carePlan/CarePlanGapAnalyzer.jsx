import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Target, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2,
  Brain,
  BookOpen,
  TrendingUp
} from "lucide-react";

export default function CarePlanGapAnalyzer({ 
  patientId,
  diagnosis, 
  carePlans, 
  recentVisits,
  patientData,
  autoAnalyze = false 
}) {
  const ai = useAICall();
  const [analysis, setAnalysis] = useState(null);

  const analyzeCarePlanGaps = useCallback(async () => {
    if (!diagnosis) return;

    try {
      const activePlans = carePlans?.filter(cp => cp.status === 'active') || [];
      const recentProgress = recentVisits?.slice(0, 3).map(v => ({
        date: v.visit_date,
        notes: v.nurse_notes?.substring(0, 300)
      })) || [];

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a clinical care planning expert. Analyze this patient's care plan for gaps, deviations from best practices, and evidence-based recommendations.

PRIMARY DIAGNOSIS: ${diagnosis}
SECONDARY DIAGNOSES: ${patientData?.secondary_diagnoses?.join(', ') || 'None'}
AGE: ${patientData?.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}

CURRENT ACTIVE CARE PLANS (${activePlans.length}):
${activePlans.map(cp => `
- Problem: ${cp.problem}
- Goal: ${cp.goal}
- Interventions: ${cp.interventions?.join(', ')}
`).join('\n')}

RECENT VISIT NOTES:
${recentProgress.map(v => `[${v.date}] ${v.notes}`).join('\n---\n')}

PATIENT PROFILE:
- Functional Status: ${JSON.stringify(patientData?.functional_status || {})}
- Allergies: ${patientData?.allergies || 'None'}
- Care Type: ${patientData?.care_type || 'home_health'}

Compare against evidence-based guidelines and identify:
1. Missing care plan elements for this diagnosis
2. Goals that aren't SMART (Specific, Measurable, Achievable, Relevant, Time-bound)
3. Interventions that don't align with current clinical guidelines
4. Best practice recommendations not being followed
5. Potential quality improvement opportunities
6. Missing preventive care measures
7. Documentation gaps affecting care coordination

Return comprehensive analysis including:
- overall_compliance: 0-100 score
- missing_elements: critical care plan components missing
- guideline_deviations: areas not following best practices with references
- improvement_opportunities: actionable recommendations
- recommended_goals: new SMART goals to add
- recommended_interventions: evidence-based interventions to consider`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_compliance: { type: "number" },
            total_gaps: { type: "number" },
            missing_elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  priority: { type: "string" },
                  rationale: { type: "string" },
                  guideline_reference: { type: "string" }
                }
              }
            },
            guideline_deviations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  current_approach: { type: "string" },
                  guideline_recommendation: { type: "string" },
                  evidence_level: { type: "string" },
                  source: { type: "string" }
                }
              }
            },
            improvement_opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  current_gap: { type: "string" },
                  recommendation: { type: "string" },
                  expected_outcome: { type: "string" }
                }
              }
            },
            recommended_goals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  smart_goal: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            },
            recommended_interventions: {
              type: "array",
              items: { type: "string" }
            },
            preventive_care_gaps: {
              type: "array",
              items: { type: "string" }
            },
            summary: { type: "string" }
          }
        }
      });

      setAnalysis(result);
    } catch (error) {
      console.error('Care plan analysis error:', error);
      setAnalysis({ error: error.message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [carePlans, diagnosis, patientData, recentVisits]);

  useEffect(() => {
    if (autoAnalyze && diagnosis) {
      analyzeCarePlanGaps();
    }
  }, [autoAnalyze, patientId, analyzeCarePlanGaps, diagnosis]);

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-navy-50 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="w-5 h-5 text-blue-600" />
          AI Care Plan Gap Analysis
          {analysis && !analysis.error && (
            <Badge className={`ml-auto ${
              analysis.overall_compliance >= 80 ? 'bg-green-600' :
              analysis.overall_compliance >= 60 ? 'bg-yellow-600' :
              'bg-orange-600'
            }`}>
              {analysis.overall_compliance}% Compliant
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {!analysis && !ai.loading && (
          <Button
            onClick={analyzeCarePlanGaps}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            <Brain className="w-4 h-4 mr-2" />
            Analyze Care Plan vs. Best Practices
          </Button>
        )}

        {ai.loading && (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" />
            <p className="text-sm text-slate-600">Comparing against clinical guidelines...</p>
          </div>
        )}

        {analysis && !analysis.error && (
          <>
            {/* Summary */}
            {analysis.summary && (
              <Alert className="bg-blue-50 border-blue-300">
                <BookOpen className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-900">
                  {analysis.summary}
                </AlertDescription>
              </Alert>
            )}

            {/* Missing Elements */}
            {analysis.missing_elements?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-red-900 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Missing Critical Elements ({analysis.missing_elements.length})
                </p>
                <div className="space-y-2">
                  {analysis.missing_elements.map((elem, idx) => (
                    <div key={idx} className={`p-3 rounded-lg border ${
                      elem.priority === 'high' ? 'bg-red-50 border-red-300' :
                      elem.priority === 'medium' ? 'bg-yellow-50 border-yellow-300' :
                      'bg-blue-50 border-blue-200'
                    }`}>
                      <p className="text-sm font-medium">{elem.element}</p>
                      <p className="text-xs mt-1">{elem.rationale}</p>
                      {elem.guideline_reference && (
                        <p className="text-xs text-slate-600 mt-1">
                          <BookOpen className="w-3 h-3 inline mr-1" />
                          {elem.guideline_reference}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Guideline Deviations */}
            {analysis.guideline_deviations?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-orange-900 mb-2">
                  Best Practice Deviations ({analysis.guideline_deviations.length})
                </p>
                <div className="space-y-2">
                  {analysis.guideline_deviations.map((dev, idx) => (
                    <div key={idx} className="p-3 bg-orange-50 border border-orange-300 rounded-lg">
                      <p className="text-xs font-medium text-orange-900">Current: {dev.current_approach}</p>
                      <p className="text-xs text-orange-800 mt-1">
                        <strong>Guideline:</strong> {dev.guideline_recommendation}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-xs">{dev.evidence_level}</Badge>
                        <span className="text-xs text-slate-600">{dev.source}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Improvement Opportunities */}
            {analysis.improvement_opportunities?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Quality Improvement Opportunities ({analysis.improvement_opportunities.length})
                </p>
                <div className="space-y-2">
                  {analysis.improvement_opportunities.map((opp, idx) => (
                    <div key={idx} className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm font-medium text-blue-900">{opp.area}</p>
                      <p className="text-xs text-blue-800 mt-1">
                        <strong>Gap:</strong> {opp.current_gap}
                      </p>
                      <p className="text-xs text-blue-800 mt-1">
                        <strong>Recommendation:</strong> {opp.recommendation}
                      </p>
                      {opp.expected_outcome && (
                        <p className="text-xs text-green-700 mt-2">
                          <CheckCircle2 className="w-3 h-3 inline mr-1" />
                          {opp.expected_outcome}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommended Goals */}
            {analysis.recommended_goals?.length > 0 && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-semibold text-green-900 mb-2">Recommended SMART Goals</p>
                <div className="space-y-2">
                  {analysis.recommended_goals.map((goal, idx) => (
                    <div key={idx} className="text-xs">
                      <p className="font-medium text-green-900">{goal.problem}</p>
                      <p className="text-green-800 mt-1"><strong>Goal:</strong> {goal.smart_goal}</p>
                      <p className="text-green-700 mt-1">{goal.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Preventive Care Gaps */}
            {analysis.preventive_care_gaps?.length > 0 && (
              <Alert className="bg-yellow-50 border-yellow-300">
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                <AlertDescription>
                  <p className="text-sm font-semibold text-yellow-900 mb-1">Preventive Care Gaps</p>
                  <ul className="text-xs space-y-1 text-yellow-800">
                    {analysis.preventive_care_gaps.map((gap, idx) => (
                      <li key={idx}>• {gap}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* All Compliant */}
            {analysis.total_gaps === 0 && (
              <Alert className="bg-green-50 border-green-300">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-sm text-green-800">
                  ✅ Care plan is comprehensive and aligned with best practices
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        {analysis?.error && (
          <Alert className="bg-red-50 border-red-300">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-sm text-red-800">
              Analysis failed: {analysis.error}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}