import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Brain, AlertTriangle, TrendingUp, Users, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function PredictiveInsightsPanel({ patients, carePlans, visits, users }) {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);

  const generateInsights = async () => {
    setLoading(true);
    try {
      const activePatients = patients.filter(p => p.status === "active");
      const activePlans = carePlans.filter(cp => cp.status === "active");

      // Build concise summary for AI
      const patientSummaries = activePatients.slice(0, 40).map(p => ({
        id: p.id,
        name: `${p.first_name} ${p.last_name}`,
        diagnosis: p.primary_diagnosis,
        risk_level: p.risk_assessment?.level || "unknown",
        risk_score: p.risk_assessment?.score || null,
        readmission_risk: p.risk_assessment?.category_scores?.readmission_risk || null,
        functional_status: p.functional_status?.adl_independence || "unknown",
        fall_risk: p.functional_status?.fall_risk || "unknown",
        hospitalization_count: p.past_hospitalizations?.length || 0,
        care_type: p.care_type,
        admission_date: p.admission_date,
        chronic_count: (p.chronic_conditions?.length || 0) + (p.secondary_diagnoses?.length || 0),
        living_situation: p.social_history?.living_situation,
        social_isolation: p.social_determinants?.social_isolation,
      }));

      const planSummaries = activePlans.slice(0, 60).map(cp => ({
        patient_id: cp.patient_id,
        problem: cp.problem,
        goal: cp.goal,
        progress: cp.progress_percentage || 0,
        target_date: cp.target_date,
        status: cp.status,
        days_remaining: cp.target_date ? Math.ceil((new Date(cp.target_date) - new Date()) / (1000 * 60 * 60 * 24)) : null,
      }));

      const visitCounts = {};
      visits.forEach(v => {
        visitCounts[v.patient_id] = (visitCounts[v.patient_id] || 0) + 1;
      });

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a home health and hospice analytics AI. Analyze this agency data and produce predictive insights.

PATIENTS (${activePatients.length} active):
${JSON.stringify(patientSummaries, null, 1)}

ACTIVE CARE PLANS (${activePlans.length}):
${JSON.stringify(planSummaries, null, 1)}

VISIT COUNTS PER PATIENT: ${JSON.stringify(visitCounts)}

STAFF COUNT: ${users.length}

Generate the following predictive analytics:

1. READMISSION RISK: Identify the top 5 patients most at risk for hospital readmission. Consider diagnosis, risk scores, hospitalization history, functional status, social factors, and chronic conditions. Give each a risk_percentage (0-100) and specific risk_factors.

2. CARE PLAN FORECASTS: For the active care plans, predict which ones are on track vs at risk of not meeting their goals. Look at progress_percentage vs days remaining. Give top 5 at-risk plans with predicted_outcome and recommended_action.

3. RESOURCE ALLOCATION: Based on patient acuity, visit patterns, and staff count, identify resource gaps. Suggest staffing adjustments, which patients need more frequent visits, and which diagnoses are underserved.

4. TREND PREDICTIONS: Predict upcoming trends for the next 30 days — expected new admissions surge, discharge readiness, seasonal illness patterns, etc.

5. KEY METRICS: Calculate overall agency health metrics — avg risk score, % patients high risk, care plan success rate prediction, staff-to-patient ratio assessment.`,
        response_json_schema: {
          type: "object",
          properties: {
            readmission_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  patient_name: { type: "string" },
                  patient_id: { type: "string" },
                  risk_percentage: { type: "number" },
                  risk_level: { type: "string" },
                  risk_factors: { type: "array", items: { type: "string" } },
                  recommended_actions: { type: "array", items: { type: "string" } },
                },
              },
            },
            care_plan_forecasts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  patient_name: { type: "string" },
                  problem: { type: "string" },
                  current_progress: { type: "number" },
                  predicted_outcome: { type: "string" },
                  on_track: { type: "boolean" },
                  days_remaining: { type: "number" },
                  recommended_action: { type: "string" },
                },
              },
            },
            resource_allocation: {
              type: "object",
              properties: {
                staff_to_patient_ratio: { type: "string" },
                ratio_assessment: { type: "string" },
                understaffed_areas: { type: "array", items: { type: "string" } },
                patients_needing_more_visits: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      patient_name: { type: "string" },
                      reason: { type: "string" },
                      recommended_frequency: { type: "string" },
                    },
                  },
                },
                recommendations: { type: "array", items: { type: "string" } },
              },
            },
            trend_predictions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  trend: { type: "string" },
                  impact: { type: "string" },
                  confidence: { type: "number" },
                  timeframe: { type: "string" },
                },
              },
            },
            agency_metrics: {
              type: "object",
              properties: {
                avg_risk_score: { type: "number" },
                high_risk_percentage: { type: "number" },
                care_plan_success_prediction: { type: "number" },
                overall_agency_health: { type: "string" },
                summary: { type: "string" },
              },
            },
          },
        },
      });

      setInsights(result);
      toast.success("Predictive insights generated");
    } catch (err) {
      console.error("AI insights error:", err);
      toast.error("Failed to generate insights");
    } finally {
      setLoading(false);
    }
  };

  if (!insights && !loading) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Brain className="w-10 h-10 text-indigo-400 mx-auto mb-3" />
          <h3 className="font-semibold text-slate-800 mb-1">AI Predictive Analytics</h3>
          <p className="text-xs text-slate-600 mb-4 max-w-md mx-auto">
            Analyze patient data, care plans, and visit patterns to predict readmission risks, forecast care plan outcomes, and identify resource gaps.
          </p>
          <Button onClick={generateInsights} className="bg-indigo-600 hover:bg-indigo-700">
            <Brain className="w-4 h-4 mr-2" /> Generate Predictions
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="border-indigo-200">
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-3" />
          <p className="text-sm text-slate-600">Analyzing {patients.length} patients, {carePlans.length} care plans, and {visits.length} visits...</p>
          <p className="text-xs text-slate-400 mt-1">This may take a moment</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Brain className="w-4 h-4 text-indigo-600" /> AI Predictive Insights
        </h3>
        <Button variant="outline" size="sm" onClick={generateInsights} disabled={loading} className="text-xs h-7">
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>

      {/* Agency Health Summary */}
      {insights?.agency_metrics && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-indigo-800 mb-2">Agency Health: {insights.agency_metrics.overall_agency_health}</p>
            <p className="text-xs text-slate-700 mb-3">{insights.agency_metrics.summary}</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 bg-gradient-to-br from-blue-100/50 to-slate-100/60 rounded-lg border border-blue-200/30">
                <p className="text-lg font-bold text-blue-700">{insights.agency_metrics.avg_risk_score?.toFixed(0) || "—"}</p>
                <p className="text-[9px] text-slate-500">Avg Risk Score</p>
              </div>
              <div className="text-center p-2 bg-gradient-to-br from-blue-100/50 to-slate-100/60 rounded-lg border border-blue-200/30">
                <p className="text-lg font-bold text-blue-700">{insights.agency_metrics.high_risk_percentage?.toFixed(0) || "—"}%</p>
                <p className="text-[9px] text-slate-500">High Risk</p>
              </div>
              <div className="text-center p-2 bg-gradient-to-br from-blue-100/50 to-slate-100/60 rounded-lg border border-blue-200/30">
                <p className="text-lg font-bold text-blue-700">{insights.agency_metrics.care_plan_success_prediction?.toFixed(0) || "—"}%</p>
                <p className="text-[9px] text-slate-500">Goal Achievement</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Readmission Risks */}
      {insights?.readmission_risks?.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" /> Readmission Risk Predictions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {insights.readmission_risks.map((r, i) => (
              <div key={i} className={`p-2.5 rounded-lg border ${r.risk_percentage >= 70 ? "bg-red-50 border-red-200" : r.risk_percentage >= 40 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-xs text-slate-800">{r.patient_name}</span>
                  <Badge className={`text-[10px] ${r.risk_percentage >= 70 ? "bg-red-600" : r.risk_percentage >= 40 ? "bg-amber-600" : "bg-green-600"} text-white`}>
                    {r.risk_percentage}% risk
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {r.risk_factors?.slice(0, 3).map((f, j) => (
                    <Badge key={j} variant="outline" className="text-[9px] px-1.5 py-0">{f}</Badge>
                  ))}
                </div>
                {r.recommended_actions?.[0] && (
                  <p className="text-[10px] text-slate-600 italic">→ {r.recommended_actions[0]}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Care Plan Forecasts */}
      {insights?.care_plan_forecasts?.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" /> Care Plan Goal Forecasts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {insights.care_plan_forecasts.map((cp, i) => (
              <div key={i} className={`p-2.5 rounded-lg border ${cp.on_track ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs text-slate-800">{cp.patient_name}</p>
                    <p className="text-[10px] text-slate-600 truncate">{cp.problem}</p>
                  </div>
                  <Badge className={`text-[10px] flex-shrink-0 ${cp.on_track ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                    {cp.on_track ? "On Track" : "At Risk"}
                  </Badge>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-slate-200 rounded-full h-1.5 mb-1.5">
                  <div className={`h-full rounded-full ${cp.on_track ? "bg-green-500" : "bg-amber-500"}`} style={{ width: `${Math.min(cp.current_progress, 100)}%` }} />
                </div>
                <div className="flex justify-between text-[9px] text-slate-500">
                  <span>{cp.current_progress}% complete</span>
                  <span>{cp.days_remaining > 0 ? `${cp.days_remaining} days left` : "Overdue"}</span>
                </div>
                <p className="text-[10px] text-slate-600 mt-1 italic">→ {cp.recommended_action}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Resource Allocation */}
      {insights?.resource_allocation && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-500" /> Resource Allocation Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-3">
            <div className="flex items-center gap-3 p-2.5 bg-gradient-to-br from-blue-100/50 to-slate-100/60 rounded-lg border border-blue-200/30">
              <div>
                <p className="text-xs font-medium text-slate-800">Staff-to-Patient: {insights.resource_allocation.staff_to_patient_ratio}</p>
                <p className="text-[10px] text-slate-600">{insights.resource_allocation.ratio_assessment}</p>
              </div>
            </div>

            {insights.resource_allocation.understaffed_areas?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-700 mb-1">Understaffed Areas:</p>
                <div className="flex flex-wrap gap-1">
                  {insights.resource_allocation.understaffed_areas.map((a, i) => (
                    <Badge key={i} className="bg-red-100 text-red-700 text-[9px]">{a}</Badge>
                  ))}
                </div>
              </div>
            )}

            {insights.resource_allocation.patients_needing_more_visits?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-700 mb-1">Need More Visits:</p>
                {insights.resource_allocation.patients_needing_more_visits.slice(0, 3).map((p, i) => (
                  <div key={i} className="text-[10px] text-slate-600 ml-2 mb-0.5">
                    • <strong>{p.patient_name}</strong> — {p.reason} ({p.recommended_frequency})
                  </div>
                ))}
              </div>
            )}

            {insights.resource_allocation.recommendations?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-700 mb-1">Recommendations:</p>
                {insights.resource_allocation.recommendations.map((r, i) => (
                  <p key={i} className="text-[10px] text-slate-600 ml-2 mb-0.5">• {r}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Trend Predictions */}
      {insights?.trend_predictions?.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" /> 30-Day Trend Predictions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {insights.trend_predictions.map((t, i) => (
              <div key={i} className="p-2.5 rounded-lg border bg-white">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-xs font-medium text-slate-800">{t.trend}</p>
                  <Badge variant="outline" className="text-[9px] flex-shrink-0">{t.confidence}% conf</Badge>
                </div>
                <p className="text-[10px] text-slate-600">{t.impact}</p>
                <p className="text-[9px] text-slate-400 mt-0.5">Timeframe: {t.timeframe}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}