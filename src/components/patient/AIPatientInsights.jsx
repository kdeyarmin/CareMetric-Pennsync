import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { isSafeExternalUrl } from "@/components/utils/security";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp,
  AlertTriangle,
  Heart,
  Activity,
  Brain,
  Sparkles,
  ExternalLink,
  Shield,
  Loader2
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function AIPatientInsights({ patient, visits, carePlans, incidents }) {
  const ai = useAICall();
  const [insights, setInsights] = useState(null);

  const analyzePatient = useCallback(async () => {
    try {
      const recentVisits = visits.slice(0, 10);
      const recentIncidents = incidents.slice(0, 5);
      
      const visitHistory = recentVisits.map(v => ({
        date: v.visit_date,
        type: v.visit_type,
        vitals: v.vital_signs,
        notes_summary: v.nurse_notes?.substring(0, 200)
      }));

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a predictive healthcare AI analyzing patient data to identify future health risks and care needs.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}
- Allergies: ${patient.allergies || 'None'}
- Care Type: ${patient.care_type}
- Functional Status: Ambulation=${patient.functional_status?.ambulation}, ADL=${patient.functional_status?.adl_independence}, Cognitive=${patient.functional_status?.cognitive_status}
- Fall Risk: ${patient.functional_status?.fall_risk}

RECENT VISIT HISTORY (Last 10 visits):
${visitHistory.map(v => `- ${v.date} (${v.type}): BP ${v.vitals?.blood_pressure_systolic}/${v.vitals?.blood_pressure_diastolic}, HR ${v.vitals?.heart_rate}, O2 ${v.vitals?.oxygen_saturation}%`).join('\n')}

RECENT INCIDENTS:
${recentIncidents.map(i => `- ${i.incident_date}: ${i.incident_type} (${i.severity})`).join('\n')}

ACTIVE CARE PLANS:
${carePlans.filter(cp => cp.status === 'active').map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n')}

PAST HOSPITALIZATIONS:
${patient.past_hospitalizations?.map(h => `- ${h.date}: ${h.reason} (${h.length_of_stay} days)`).join('\n') || 'None'}

Analyze this data and predict:

1. HIGH-RISK CONDITIONS: What health conditions is this patient at elevated risk for in the next 3-6 months?
2. EARLY WARNING SIGNS: What specific symptoms or vital sign changes should we monitor?
3. PREVENTATIVE MEASURES: What interventions could reduce these risks?
4. CARE NEEDS PREDICTION: What additional care services or resources might this patient need soon?
5. READMISSION RISK: What's the likelihood of hospital readmission and why?
6. MEDICATION CONCERNS: Any potential medication-related risks or interactions?
7. FALL/SAFETY RISKS: Specific fall or safety concerns based on trends?
8. FUNCTIONAL DECLINE: Is the patient at risk of functional decline?

For each prediction, provide:
- Risk level (critical, high, medium, low)
- Confidence score (0-100)
- Timeline (immediate, 1-3 months, 3-6 months)
- Evidence from patient data
- Specific preventative actions
- Relevant clinical guidelines or resources

Be specific and actionable. Use actual data trends.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_score: { type: "number" },
            risk_summary: { type: "string" },
            predictions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  risk_name: { type: "string" },
                  risk_level: { type: "string" },
                  confidence: { type: "number" },
                  timeline: { type: "string" },
                  evidence: { type: "array", items: { type: "string" } },
                  warning_signs: { type: "array", items: { type: "string" } },
                  preventative_actions: { type: "array", items: { type: "string" } },
                  clinical_guidelines: { type: "string" },
                  guideline_link: { type: "string" }
                }
              }
            },
            care_recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  recommendation: { type: "string" },
                  rationale: { type: "string" },
                  priority: { type: "string" }
                }
              }
            }
          }
        }
      });

      setInsights(result);
    } catch (error) {
      console.error('Patient insights analysis error:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patient, visits, incidents, carePlans]);

  useEffect(() => {
    if (patient && visits?.length > 0) {
      analyzePatient();
    }
  }, [patient?.id, patient, visits?.length, analyzePatient]);

  const getRiskColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'critical': return 'bg-red-100 border-red-400 text-red-900';
      case 'high': return 'bg-orange-100 border-orange-400 text-orange-900';
      case 'medium': return 'bg-yellow-100 border-yellow-400 text-yellow-900';
      case 'low': return 'bg-blue-100 border-blue-400 text-blue-900';
      default: return 'bg-slate-100 border-slate-400 text-slate-900';
    }
  };

  const getRiskIcon = (category) => {
    switch (category?.toLowerCase()) {
      case 'readmission': return <Activity className="w-5 h-5" />;
      case 'fall': return <AlertTriangle className="w-5 h-5" />;
      case 'medication': return <Heart className="w-5 h-5" />;
      case 'functional decline': return <TrendingUp className="w-5 h-5" />;
      default: return <Brain className="w-5 h-5" />;
    }
  };

  const getTimelineIcon = (timeline) => {
    if (timeline?.includes('immediate')) return '🚨';
    if (timeline?.includes('1-3')) return '⚠️';
    return '📅';
  };

  if (ai.loading) {
    return (
      <Card className="border-2 border-navy-300">
        <CardContent className="p-6 text-center">
          <Loader2 className="h-12 w-12 animate-spin text-navy-600 mx-auto mb-4" />
          <p className="text-sm text-slate-900 font-semibold">Analyzing Patient Data...</p>
          <p className="text-xs text-slate-600 mt-2">🧠 Reviewing {visits?.length} visits, {incidents?.length} incidents, and clinical history</p>
        </CardContent>
      </Card>
    );
  }

  if (!insights) {
    return (
      <Card className="border-2 border-navy-300">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            AI Patient Insights & Risk Prediction
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={analyzePatient} className="bg-navy-600 hover:bg-navy-700">
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Insights
          </Button>
        </CardContent>
      </Card>
    );
  }

  const criticalPredictions = insights.predictions?.filter(p => p.risk_level?.toLowerCase() === 'critical') || [];
  const highPredictions = insights.predictions?.filter(p => p.risk_level?.toLowerCase() === 'high') || [];

  return (
    <div className="space-y-4">
      {/* Overall Risk Summary */}
      <Card className={`border-2 ${
        insights.overall_risk_score >= 75 ? 'border-red-400 bg-red-50' :
        insights.overall_risk_score >= 50 ? 'border-orange-400 bg-orange-50' :
        'border-green-400 bg-green-50'
      }`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Brain className="w-5 h-5" />
              Predictive Risk Assessment
            </span>
            <Badge className={`text-lg ${
              insights.overall_risk_score >= 75 ? 'bg-red-600' :
              insights.overall_risk_score >= 50 ? 'bg-orange-600' :
              'bg-green-600'
            }`}>
              Risk: {insights.overall_risk_score}/100
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={insights.overall_risk_score} className="h-3" />
          <p className="text-sm text-slate-700 bg-white p-3 rounded border">{insights.risk_summary}</p>
          
          {(criticalPredictions.length > 0 || highPredictions.length > 0) && (
            <Alert className="border-red-400 bg-red-50">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-sm text-red-900">
                <strong>{criticalPredictions.length} Critical</strong> and <strong>{highPredictions.length} High</strong> priority risks identified
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Detailed Predictions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Predicted Health Risks & Care Needs</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="space-y-2">
            {insights.predictions?.map((prediction, idx) => (
              <AccordionItem
                key={idx}
                value={`prediction-${idx}`}
                className={`border-2 rounded-lg ${getRiskColor(prediction.risk_level)}`}
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex items-center gap-3 text-left">
                      {getRiskIcon(prediction.category)}
                      <div>
                        <p className="font-semibold text-sm">{prediction.risk_name}</p>
                        <p className="text-xs text-slate-600">{prediction.category}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={
                        prediction.risk_level?.toLowerCase() === 'critical' ? 'bg-red-600' :
                        prediction.risk_level?.toLowerCase() === 'high' ? 'bg-orange-600' :
                        prediction.risk_level?.toLowerCase() === 'medium' ? 'bg-yellow-600' :
                        'bg-blue-600'
                      }>
                        {prediction.risk_level}
                      </Badge>
                      <Badge variant="outline">
                        {getTimelineIcon(prediction.timeline)} {prediction.timeline}
                      </Badge>
                      <Badge variant="outline">
                        {prediction.confidence}% confidence
                      </Badge>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-3">
                  {/* Evidence */}
                  {prediction.evidence?.length > 0 && (
                    <div className="bg-white p-3 rounded border">
                      <p className="text-xs font-semibold text-slate-700 mb-2">📊 Evidence from Patient Data:</p>
                      <ul className="space-y-1">
                        {prediction.evidence.map((item, i) => (
                          <li key={i} className="text-xs text-slate-600">• {item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Warning Signs */}
                  {prediction.warning_signs?.length > 0 && (
                    <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                      <p className="text-xs font-semibold text-yellow-900 mb-2">⚠️ Monitor For:</p>
                      <ul className="space-y-1">
                        {prediction.warning_signs.map((sign, i) => (
                          <li key={i} className="text-xs text-yellow-800">• {sign}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Preventative Actions */}
                  {prediction.preventative_actions?.length > 0 && (
                    <div className="bg-green-50 p-3 rounded border border-green-200">
                      <p className="text-xs font-semibold text-green-900 mb-2">✓ Preventative Actions:</p>
                      <ul className="space-y-1">
                        {prediction.preventative_actions.map((action, i) => (
                          <li key={i} className="text-xs text-green-800">• {action}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Clinical Guidelines */}
                  {prediction.clinical_guidelines && (
                    <div className="bg-blue-50 p-3 rounded border border-blue-200">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-blue-900 mb-1">📚 Clinical Guidelines:</p>
                          <p className="text-xs text-blue-800">{prediction.clinical_guidelines}</p>
                        </div>
                        {prediction.guideline_link && (
                          <a
                            href={isSafeExternalUrl(prediction.guideline_link) ? prediction.guideline_link : undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-blue-600 hover:text-blue-800"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* Care Recommendations */}
      {insights.care_recommendations?.length > 0 && (
        <Card className="border-2 border-blue-300">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600" />
              Recommended Care Interventions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {insights.care_recommendations.map((rec, idx) => (
              <div
                key={idx}
                className={`p-3 rounded border-l-4 ${
                  rec.priority === 'high' ? 'border-red-500 bg-red-50' :
                  rec.priority === 'medium' ? 'border-yellow-500 bg-yellow-50' :
                  'border-blue-500 bg-blue-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">{rec.recommendation}</p>
                    <p className="text-xs text-slate-600 mt-1">{rec.rationale}</p>
                  </div>
                  <Badge className={
                    rec.priority === 'high' ? 'bg-red-600' :
                    rec.priority === 'medium' ? 'bg-yellow-600' :
                    'bg-blue-600'
                  }>
                    {rec.priority}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}