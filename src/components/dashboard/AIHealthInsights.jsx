import { useState, useEffect, useCallback, useRef } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  Target,
  Activity
} from "lucide-react";

export default function AIHealthInsights({ patientId, patient, visits, carePlans, alerts, oasisData }) {
  const [insights, setInsights] = useState(null);
  const ai = useAICall();

  const generateInsights = useCallback(async () => {
    try {
      const completedVisits = visits.filter(v => v.status === 'completed').slice(0, 10);
      
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a clinical AI analyst specializing in home health patient care. Analyze this patient's health trends and provide actionable insights.

PATIENT INFORMATION:
- Name: ${patient?.first_name} ${patient?.last_name}
- Age: ${patient?.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}
- Primary Diagnosis: ${patient?.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient?.secondary_diagnoses?.join(', ') || 'None'}
- Care Type: ${patient?.care_type || 'home_health'}
- Status: ${patient?.status || 'unknown'}
- Functional Status: ${patient?.functional_status?.ambulation || 'Not assessed'}, ADL: ${patient?.functional_status?.adl_independence || 'Not assessed'}

RECENT VISIT HISTORY (Last ${completedVisits.length} visits):
${completedVisits.map((v, idx) => `
Visit ${idx + 1} (${v.visit_date}):
- Type: ${v.visit_type}
- Vitals: BP ${v.vital_signs?.blood_pressure_systolic || '?'}/${v.vital_signs?.blood_pressure_diastolic || '?'}, HR ${v.vital_signs?.heart_rate || '?'}, O2 ${v.vital_signs?.oxygen_saturation || '?'}%, Temp ${v.vital_signs?.temperature || '?'}°F, Weight ${v.vital_signs?.weight || '?'} lbs
- Pain Level: ${v.vital_signs?.pain_level || 'Not recorded'}
- Notes Summary: ${v.nurse_notes?.substring(0, 200) || 'No notes'}...
`).join('\n')}

ACTIVE CARE PLANS (${carePlans.filter(cp => cp.status === 'active').length}):
${carePlans.filter(cp => cp.status === 'active').map(cp => `
- Problem: ${cp.problem}
- Goal: ${cp.goal}
- Target Date: ${cp.target_date || 'Not set'}
- Status: ${cp.status}
`).join('\n')}

ACTIVE ALERTS (${alerts.filter(a => a.status === 'active').length}):
${alerts.filter(a => a.status === 'active').slice(0, 5).map(alert => `
- ${alert.title} (${alert.severity})
- ${alert.message}
`).join('\n')}

OASIS DATA:
${oasisData.length > 0 ? `
- Most Recent Assessment: ${oasisData[0]?.created_date}
- Clinical Group: ${oasisData[0]?.pdgm_data?.clinical_grouping || 'Not specified'}
- Functional Level: ${oasisData[0]?.pdgm_data?.functional_impairment_level || 'Not assessed'}
` : 'No OASIS data on file'}

Provide comprehensive health trend analysis:

{
  "overall_health_trend": "improving" | "stable" | "declining" | "concerning",
  "trend_summary": "brief overall assessment",
  "key_insights": [
    {
      "category": "vital_signs" | "functional_status" | "symptoms" | "medication" | "care_plan_progress" | "risk_factors",
      "finding": "specific observation",
      "trend": "improving" | "stable" | "declining",
      "clinical_significance": "why this matters",
      "recommendation": "actionable recommendation"
    }
  ],
  "vital_signs_analysis": {
    "blood_pressure_trend": "improving | stable | concerning | critical",
    "heart_rate_trend": "normal | elevated | low",
    "weight_trend": "stable | gaining | losing",
    "oxygen_trend": "adequate | declining | concerning",
    "pain_trend": "improving | stable | worsening",
    "narrative": "detailed explanation of vital trends"
  },
  "functional_trajectory": {
    "current_level": "independent | minimal_assist | moderate_assist | total_assist",
    "trend": "improving | stable | declining",
    "predicted_outcome": "short-term prediction",
    "interventions_needed": ["list of recommendations"]
  },
  "red_flags": [
    {
      "concern": "specific warning sign",
      "urgency": "immediate" | "high" | "moderate",
      "action_required": "what to do",
      "timeframe": "when to act"
    }
  ],
  "care_plan_effectiveness": {
    "overall_progress": "excellent | good | fair | poor",
    "goals_on_track": number,
    "goals_at_risk": number,
    "recommendations": ["specific care plan adjustments"]
  },
  "predictive_insights": [
    {
      "prediction": "anticipated change or event",
      "likelihood": "high" | "moderate" | "low",
      "timeframe": "when this might occur",
      "preventive_measures": ["what can be done"]
    }
  ],
  "priority_actions": [
    {
      "action": "specific action to take",
      "urgency": "immediate" | "this_week" | "next_visit",
      "rationale": "why this is important",
      "expected_impact": "anticipated benefit"
    }
  ],
  "positive_developments": [
    "list of improvements or good news"
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_health_trend: { type: "string" },
            trend_summary: { type: "string" },
            key_insights: { type: "array", items: { type: "object" } },
            vital_signs_analysis: { type: "object" },
            functional_trajectory: { type: "object" },
            red_flags: { type: "array", items: { type: "object" } },
            care_plan_effectiveness: { type: "object" },
            predictive_insights: { type: "array", items: { type: "object" } },
            priority_actions: { type: "array", items: { type: "object" } },
            positive_developments: { type: "array", items: { type: "string" } }
          }
        }
      });

      setInsights(result);
    } catch (error) {
      console.error("Error generating health insights:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [visits, patient, carePlans, alerts, oasisData]);

  // Auto-run once per patient. generateInsights' identity changes whenever a query
  // dependency array (visits/carePlans/alerts/…) is refetched, so without this gate
  // the effect would re-fire an expensive LLM call on every such churn.
  const autoRunForRef = useRef(null);
  useEffect(() => {
    if (patientId && visits.length > 0 && autoRunForRef.current !== patientId) {
      autoRunForRef.current = patientId;
      generateInsights();
    }
  }, [patientId, visits.length, generateInsights]);

  const getTrendIcon = (trend) => {
    switch (trend) {
      case 'improving': return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'declining': return <TrendingDown className="w-4 h-4 text-red-600" />;
      case 'concerning': return <AlertTriangle className="w-4 h-4 text-orange-600" />;
      default: return <Activity className="w-4 h-4 text-blue-600" />;
    }
  };

  const getTrendColor = (trend) => {
    switch (trend) {
      case 'improving': return 'bg-green-50 border-green-200';
      case 'stable': return 'bg-blue-50 border-blue-200';
      case 'declining': return 'bg-orange-50 border-orange-200';
      case 'concerning': return 'bg-red-50 border-red-200';
      default: return 'bg-slate-50 border-slate-200';
    }
  };

  return (
    <Card className="border-2 border-navy-200 bg-gradient-to-br from-navy-50 via-white to-indigo-50 mb-6">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-navy-600" />
            AI Health Insights & Trends
          </CardTitle>
          <Button
            onClick={generateInsights}
            disabled={ai.loading}
            size="sm"
            className="bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Refresh Insights</>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {ai.loading ? (
          <div className="text-center py-12">
            <Brain className="w-12 h-12 text-navy-400 mx-auto mb-4 animate-pulse" />
            <p className="text-slate-600">AI analyzing patient health trends...</p>
          </div>
        ) : insights ? (
          <div className="space-y-6">
            {/* Overall Trend */}
            <Alert className={getTrendColor(insights.overall_health_trend)}>
              {getTrendIcon(insights.overall_health_trend)}
              <AlertDescription>
                <p className="font-semibold text-slate-900 mb-1">
                  Health Status: {insights.overall_health_trend?.toUpperCase()}
                </p>
                <p className="text-sm text-slate-700">{insights.trend_summary}</p>
              </AlertDescription>
            </Alert>

            {/* Red Flags - Most Important */}
            {insights.red_flags?.length > 0 && (
              <Card className="border-red-300 bg-red-50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2 text-red-900">
                    <AlertTriangle className="w-5 h-5" />
                    Critical Attention Needed
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {insights.red_flags.map((flag, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-lg border border-red-200">
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-semibold text-red-900">{flag.concern}</p>
                        <Badge className={`${
                          flag.urgency === 'immediate' ? 'bg-red-600' : 
                          flag.urgency === 'high' ? 'bg-orange-600' : 
                          'bg-yellow-600'
                        } text-white`}>
                          {flag.urgency}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-700 mb-2">{flag.action_required}</p>
                      <p className="text-xs text-slate-600">Timeframe: {flag.timeframe}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Priority Actions */}
            {insights.priority_actions?.length > 0 && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2 text-orange-900">
                    <Target className="w-5 h-5" />
                    Priority Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {insights.priority_actions.slice(0, 3).map((action, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border border-orange-200">
                      <div className="flex items-start justify-between mb-1">
                        <p className="font-semibold text-sm text-slate-900">{action.action}</p>
                        <Badge variant="outline">{action.urgency?.replace(/_/g, ' ')}</Badge>
                      </div>
                      <p className="text-xs text-slate-600 mb-2">{action.rationale}</p>
                      <p className="text-xs text-green-700">
                        <strong>Impact:</strong> {action.expected_impact}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Key Insights Grid */}
            <div className="grid md:grid-cols-2 gap-4">
              {insights.key_insights?.slice(0, 4).map((insight, idx) => (
                <Card key={idx} className="border-indigo-200">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {getTrendIcon(insight.trend)}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-semibold text-sm text-slate-900">{insight.category?.replace(/_/g, ' ').toUpperCase()}</p>
                          <Badge className={
                            insight.trend === 'improving' ? 'bg-green-500' :
                            insight.trend === 'stable' ? 'bg-blue-500' :
                            'bg-orange-500'
                          }>
                            {insight.trend}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-700 mb-2">{insight.finding}</p>
                        <p className="text-xs text-slate-600 mb-2">{insight.clinical_significance}</p>
                        <p className="text-xs text-indigo-700 font-medium">
                          → {insight.recommendation}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Vital Signs Analysis */}
            {insights.vital_signs_analysis && (
              <Card className="border-blue-200 bg-blue-50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2 text-blue-900">
                    <Activity className="w-5 h-5" />
                    Vital Signs Trends
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-700 mb-3">{insights.vital_signs_analysis.narrative}</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="bg-white p-2 rounded border">
                      <p className="text-xs text-slate-600">Blood Pressure</p>
                      <p className="font-semibold text-sm">{insights.vital_signs_analysis.blood_pressure_trend}</p>
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <p className="text-xs text-slate-600">Heart Rate</p>
                      <p className="font-semibold text-sm">{insights.vital_signs_analysis.heart_rate_trend}</p>
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <p className="text-xs text-slate-600">Weight</p>
                      <p className="font-semibold text-sm">{insights.vital_signs_analysis.weight_trend}</p>
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <p className="text-xs text-slate-600">O2 Saturation</p>
                      <p className="font-semibold text-sm">{insights.vital_signs_analysis.oxygen_trend}</p>
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <p className="text-xs text-slate-600">Pain Level</p>
                      <p className="font-semibold text-sm">{insights.vital_signs_analysis.pain_trend}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Positive Developments */}
            {insights.positive_developments?.length > 0 && (
              <Card className="border-green-200 bg-green-50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2 text-green-900">
                    <CheckCircle2 className="w-5 h-5" />
                    Positive Developments
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {insights.positive_developments.map((dev, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-green-800">
                        <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>{dev}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Predictive Insights */}
            {insights.predictive_insights?.length > 0 && (
              <Card className="border-navy-200 bg-navy-50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2 text-navy-900">
                    <Brain className="w-5 h-5" />
                    Predictive Insights
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {insights.predictive_insights.map((pred, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border border-navy-200">
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-semibold text-sm text-slate-900">{pred.prediction}</p>
                        <Badge className={
                          pred.likelihood === 'high' ? 'bg-red-100 text-red-800' :
                          pred.likelihood === 'moderate' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }>
                          {pred.likelihood} likelihood
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-600 mb-2">Expected: {pred.timeframe}</p>
                      {pred.preventive_measures?.length > 0 && (
                        <div className="bg-navy-50 p-2 rounded mt-2">
                          <p className="text-xs font-semibold text-navy-900 mb-1">Prevention:</p>
                          <ul className="space-y-1">
                            {pred.preventive_measures.map((measure, i) => (
                              <li key={i} className="text-xs text-navy-800">• {measure}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <Brain className="w-16 h-16 text-navy-300 mx-auto mb-4" />
            <p className="text-slate-600 mb-4">Generate AI-powered health insights for this patient</p>
            <Button
              onClick={generateInsights}
              className="bg-navy-600 hover:bg-navy-700"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Health Insights
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}