import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Brain, 
  Loader2, 
  AlertTriangle, 
  CheckCircle2, 
  FileText, 
  TrendingUp,
  Calendar,
  Target,
  Activity,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { formatEastern } from "../utils/timezone";

export default function AIPatientHistoryAnalyzer({ 
  patient, 
  visits = [], 
  carePlans = [], 
  oasisData = [],
  incidents = []
}) {
  const [analysis, setAnalysis] = useState(null);
  const ai = useAICall();
  const [showDetails, setShowDetails] = useState(false);
  const [autoAnalyzed, setAutoAnalyzed] = useState(false);

  const analyzePatientHistory = useCallback(async () => {
    if (!patient) return;
    
    try {
      const prompt = `You are a clinical analysis AI assistant. Analyze this patient's complete medical history and provide a comprehensive summary with gap detection.

PATIENT INFORMATION:
Name: ${patient.first_name} ${patient.last_name}
Date of Birth: ${patient.date_of_birth || 'Not provided'}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not documented'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None documented'}
Allergies: ${patient.allergies || 'None documented'}
Admission Date: ${patient.admission_date ? formatEastern(patient.admission_date, 'MMM d, yyyy') : 'Not provided'}
Status: ${patient.status || 'Unknown'}
Care Type: ${patient.care_type || 'home_health'}

VISIT HISTORY (${visits.length} total visits):
${visits.slice(0, 10).map((v, i) => `
Visit ${i + 1} - ${formatEastern(v.visit_date, 'MMM d, yyyy')}:
  Type: ${v.visit_type}
  Status: ${v.status}
  Vitals: ${v.vital_signs ? `BP: ${v.vital_signs.blood_pressure_systolic}/${v.vital_signs.blood_pressure_diastolic}, HR: ${v.vital_signs.heart_rate}, O2: ${v.vital_signs.oxygen_saturation}%` : 'Not recorded'}
  Notes: ${v.nurse_notes?.substring(0, 200) || 'No notes'}...
`).join('\n') || 'No visit history'}

ACTIVE CARE PLANS (${carePlans.filter(cp => cp.status === 'active').length} active):
${carePlans.filter(cp => cp.status === 'active').map((cp, i) => `
${i + 1}. Problem: ${cp.problem}
   Goal: ${cp.goal}
   Interventions: ${cp.interventions?.join(', ') || 'Not specified'}
   Status: ${cp.status}
   Target Date: ${cp.target_date ? formatEastern(cp.target_date, 'MMM d, yyyy') : 'Not set'}
`).join('\n') || 'No active care plans'}

OASIS ASSESSMENTS (${oasisData.length} assessments):
${oasisData.slice(0, 3).map((o, i) => `
Assessment ${i + 1} - ${formatEastern(o.created_date, 'MMM d, yyyy')}:
  Clinical Group: ${o.pdgm_data?.clinical_grouping || 'Not specified'}
  Functional Level: ${o.pdgm_data?.functional_impairment_level || 'Not specified'}
  Admission Source: ${o.pdgm_data?.admission_source || 'Not specified'}
  Primary Diagnosis: ${o.extracted_data?.primary_diagnosis || 'Not specified'}
`).join('\n') || 'No OASIS assessments'}

RECENT INCIDENTS (${incidents.length} incidents):
${incidents.slice(0, 5).map((inc, i) => `
${i + 1}. ${inc.incident_type} - ${formatEastern(inc.incident_date, 'MMM d, yyyy')}
   Severity: ${inc.severity}
   Status: ${inc.status}
`).join('\n') || 'No recorded incidents'}

CURRENT MEDICATIONS:
${patient.current_medications?.slice(0, 10).map((med, i) => `${i + 1}. ${med.name} - ${med.dosage} ${med.frequency}`).join('\n') || 'No medications documented'}

Please provide a comprehensive analysis with the following structure:

1. **Executive Summary**: 2-3 sentence overview of patient's current status and trajectory
2. **Clinical Trajectory**: Describe how the patient's condition has evolved over time
3. **Key Findings**: List 3-5 most important clinical observations
4. **Care Plan Effectiveness**: Assess progress toward care plan goals
5. **Data Gaps & Inconsistencies**: Identify missing or contradictory information that could impact care
6. **Risk Factors**: Highlight any concerning patterns or risks
7. **Recommendations**: Provide 3-5 actionable clinical recommendations

Return as JSON with the following structure:
{
  "executive_summary": "string",
  "clinical_trajectory": "string",
  "key_findings": ["string", "string", ...],
  "care_plan_effectiveness": {
    "overall_assessment": "string",
    "progress_indicators": ["string", ...]
  },
  "data_gaps": [
    {
      "category": "string (e.g., 'vital_signs', 'medications', 'functional_status')",
      "description": "string",
      "severity": "low|medium|high",
      "recommendation": "string"
    }
  ],
  "risk_factors": [
    {
      "risk": "string",
      "severity": "low|medium|high",
      "evidence": "string",
      "mitigation": "string"
    }
  ],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "category": "string",
      "action": "string",
      "rationale": "string"
    }
  ],
  "confidence_score": 0-100
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            clinical_trajectory: { type: "string" },
            key_findings: { type: "array", items: { type: "string" } },
            care_plan_effectiveness: {
              type: "object",
              properties: {
                overall_assessment: { type: "string" },
                progress_indicators: { type: "array", items: { type: "string" } }
              }
            },
            data_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  description: { type: "string" },
                  severity: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            },
            risk_factors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk: { type: "string" },
                  severity: { type: "string" },
                  evidence: { type: "string" },
                  mitigation: { type: "string" }
                }
              }
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  priority: { type: "string" },
                  category: { type: "string" },
                  action: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            },
            confidence_score: { type: "number" }
          }
        }
      });

      setAnalysis(result);
    } catch (error) {
      console.error("Error analyzing patient history:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patient, visits, carePlans, oasisData, incidents]);

  // Auto-analyze on component mount
  useEffect(() => {
    if (patient && !autoAnalyzed && !analysis) {
      analyzePatientHistory();
      setAutoAnalyzed(true);
    }
  }, [patient, autoAnalyzed, analysis, analyzePatientHistory]);

  const getSeverityColor = (severity) => {
    const colors = {
      high: "bg-red-100 text-red-800 border-red-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      low: "bg-blue-100 text-blue-800 border-blue-300"
    };
    return colors[severity] || colors.low;
  };

  const getPriorityColor = (priority) => {
    const colors = {
      high: "bg-red-600 text-white",
      medium: "bg-yellow-600 text-white",
      low: "bg-blue-600 text-white"
    };
    return colors[priority] || colors.low;
  };

  if (!patient) return null;

  return (
    <Card className="border-2 border-navy-200 bg-gradient-to-br from-navy-50 to-indigo-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            AI Patient History Analysis
          </CardTitle>
          {analysis && (
            <Badge variant="outline" className="bg-white">
              {analysis.confidence_score}% Confidence
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {ai.loading ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-navy-600 mx-auto mb-3" />
            <p className="text-sm text-slate-600">Analyzing {visits.length} visits, {carePlans.length} care plans, and {oasisData.length} assessments...</p>
          </div>
        ) : !analysis ? (
          <div className="text-center py-6">
            <Button 
              onClick={analyzePatientHistory}
              className="bg-navy-600 hover:bg-navy-700"
            >
              <Brain className="w-4 h-4 mr-2" />
              Analyze Patient History
            </Button>
          </div>
        ) : (
          <>
            {/* Executive Summary */}
            <Alert className="bg-navy-100 border-navy-300">
              <FileText className="w-4 h-4 text-navy-600" />
              <AlertDescription className="text-navy-900">
                <strong>Executive Summary:</strong> {analysis.executive_summary}
              </AlertDescription>
            </Alert>

            {/* Clinical Trajectory */}
            <div className="bg-white rounded-lg p-4 border border-navy-200">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-navy-600" />
                <h3 className="font-semibold text-slate-900">Clinical Trajectory</h3>
              </div>
              <p className="text-sm text-slate-700">{analysis.clinical_trajectory}</p>
            </div>

            {/* Key Findings */}
            {analysis.key_findings?.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-navy-200">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <h3 className="font-semibold text-slate-900">Key Findings</h3>
                </div>
                <ul className="space-y-2">
                  {analysis.key_findings.map((finding, idx) => (
                    <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                      <span className="text-navy-600 font-bold">•</span>
                      {finding}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Data Gaps & Inconsistencies */}
            {analysis.data_gaps?.length > 0 && (
              <div className="bg-white rounded-lg p-4 border-2 border-orange-300">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600" />
                    <h3 className="font-semibold text-slate-900">Data Gaps & Inconsistencies</h3>
                  </div>
                  <Badge className="bg-orange-600 text-white">
                    {analysis.data_gaps.length} Found
                  </Badge>
                </div>
                <div className="space-y-3">
                  {analysis.data_gaps.map((gap, idx) => (
                    <div key={idx} className={`p-3 rounded-lg border ${getSeverityColor(gap.severity)}`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="font-semibold text-sm capitalize">{(gap.category || '').replace(/_/g, ' ')}</span>
                        <Badge variant="outline" className="text-xs">
                          {gap.severity}
                        </Badge>
                      </div>
                      <p className="text-sm mb-2">{gap.description}</p>
                      <p className="text-xs italic">💡 {gap.recommendation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk Factors */}
            {analysis.risk_factors?.length > 0 && (
              <div className="bg-white rounded-lg p-4 border-2 border-red-300">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-red-600" />
                    <h3 className="font-semibold text-slate-900">Risk Factors</h3>
                  </div>
                  <Badge className="bg-red-600 text-white">
                    {analysis.risk_factors.filter(r => r.severity === 'high').length} High Priority
                  </Badge>
                </div>
                <div className="space-y-3">
                  {analysis.risk_factors.map((risk, idx) => (
                    <div key={idx} className={`p-3 rounded-lg border ${getSeverityColor(risk.severity)}`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="font-semibold text-sm">{risk.risk}</span>
                        <Badge variant="outline" className="text-xs">
                          {risk.severity}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-600 mb-2"><strong>Evidence:</strong> {risk.evidence}</p>
                      <p className="text-xs italic"><strong>Mitigation:</strong> {risk.mitigation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Expandable Details Section */}
            <div className="border-t border-navy-200 pt-4">
              <Button
                variant="ghost"
                onClick={() => setShowDetails(!showDetails)}
                className="w-full justify-between text-navy-700 hover:text-navy-900"
              >
                <span className="flex items-center gap-2">
                  {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {showDetails ? 'Hide' : 'Show'} Detailed Analysis
                </span>
              </Button>

              {showDetails && (
                <div className="mt-4 space-y-4">
                  {/* Care Plan Effectiveness */}
                  {analysis.care_plan_effectiveness && (
                    <div className="bg-white rounded-lg p-4 border border-navy-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="w-4 h-4 text-navy-600" />
                        <h3 className="font-semibold text-slate-900">Care Plan Effectiveness</h3>
                      </div>
                      <p className="text-sm text-slate-700 mb-3">{analysis.care_plan_effectiveness.overall_assessment}</p>
                      {analysis.care_plan_effectiveness.progress_indicators?.length > 0 && (
                        <ul className="space-y-1">
                          {analysis.care_plan_effectiveness.progress_indicators.map((indicator, idx) => (
                            <li key={idx} className="text-xs text-slate-600 flex items-start gap-2">
                              <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
                              {indicator}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Recommendations */}
                  {analysis.recommendations?.length > 0 && (
                    <div className="bg-white rounded-lg p-4 border border-navy-200">
                      <div className="flex items-center gap-2 mb-3">
                        <Calendar className="w-4 h-4 text-navy-600" />
                        <h3 className="font-semibold text-slate-900">Clinical Recommendations</h3>
                      </div>
                      <div className="space-y-3">
                        {analysis.recommendations.map((rec, idx) => (
                          <div key={idx} className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge className={getPriorityColor(rec.priority)}>
                                    {rec.priority}
                                  </Badge>
                                  <span className="text-xs text-slate-500 capitalize">{rec.category}</span>
                                </div>
                                <p className="font-semibold text-sm text-slate-900">{rec.action}</p>
                              </div>
                            </div>
                            <p className="text-xs text-slate-600 italic">{rec.rationale}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Refresh Button */}
            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={analyzePatientHistory}
                disabled={ai.loading}
                className="text-navy-600 border-navy-300 hover:bg-navy-50"
              >
                {ai.loading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Brain className="w-3 h-3 mr-2" />
                    Refresh Analysis
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}