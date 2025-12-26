import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  BarChart3,
  LineChart,
  Target,
  Sparkles,
  Calendar,
  ArrowRight,
  Brain
} from "lucide-react";
import { LineChart as RechartsLine, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from "recharts";

export default function PatientOutcomesTracker({ patientId, timeframe = "90_days" }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  // Fetch patient data
  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.filter({ id: patientId }).then(r => r[0]),
    enabled: !!patientId
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date'),
    enabled: !!patientId
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidents', patientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }),
    enabled: !!patientId
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['patientAlerts', patientId],
    queryFn: () => base44.entities.PatientAlert.filter({ patient_id: patientId }),
    enabled: !!patientId
  });

  // Auto-analyze on load
  useEffect(() => {
    if (patient && visits.length > 0) {
      analyzeOutcomes();
    }
  }, [patient?.id, visits.length]);

  const analyzeOutcomes = async () => {
    if (!patient || visits.length === 0) return;

    setIsAnalyzing(true);
    try {
      // Calculate timeframe
      const days = timeframe === "30_days" ? 30 : timeframe === "90_days" ? 90 : 180;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Filter data by timeframe
      const recentVisits = visits.filter(v => new Date(v.visit_date) >= startDate);
      const recentIncidents = incidents.filter(i => new Date(i.incident_date) >= startDate);
      const recentAlerts = alerts.filter(a => new Date(a.created_date) >= startDate);

      // Prepare comprehensive data for AI analysis
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical outcomes analyst. Analyze this patient's data over the past ${days} days to identify outcome trends, contributing factors, and predict future trajectory.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${calculateAge(patient.date_of_birth)}
- Primary Diagnosis: ${patient.primary_diagnosis}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Admission Date: ${patient.admission_date || 'Unknown'}
- Care Type: ${patient.care_type || 'home_health'}

BASELINE STATUS (at admission):
- Functional Status: ${JSON.stringify(patient.functional_status || {})}
- Baseline Vitals: ${JSON.stringify(patient.baseline_vitals || {})}

VISIT DATA (Last ${days} days):
- Total Visits: ${recentVisits.length}
- Visit Types: ${recentVisits.map(v => v.visit_type).join(', ')}
- Vital Signs Trends:
${recentVisits.slice(0, 10).map(v => `  ${v.visit_date}: BP ${v.vital_signs?.blood_pressure_systolic}/${v.vital_signs?.blood_pressure_diastolic}, HR ${v.vital_signs?.heart_rate}, O2 ${v.vital_signs?.oxygen_saturation}%`).join('\n')}

INCIDENTS (Last ${days} days):
- Total Incidents: ${recentIncidents.length}
- Types: ${recentIncidents.map(i => i.incident_type).join(', ') || 'None'}
- Hospitalizations: ${recentIncidents.filter(i => i.incident_type === 'hospitalized').length}
- Falls: ${recentIncidents.filter(i => i.incident_type === 'fall').length}
- Medication Errors: ${recentIncidents.filter(i => i.incident_type === 'medication_error').length}

CARE PLAN PROGRESS:
${carePlans.map(cp => `- ${cp.problem}: ${cp.goal} (Status: ${cp.status})`).join('\n') || 'No care plans'}

CLINICAL ALERTS (Last ${days} days):
- Total Alerts: ${recentAlerts.length}
- Critical Alerts: ${recentAlerts.filter(a => a.severity === 'critical').length}
- Alert Types: ${recentAlerts.map(a => a.alert_type).join(', ') || 'None'}

MEDICATION COMPLIANCE (from notes):
${recentVisits.slice(0, 5).map(v => {
  const noteText = v.nurse_notes?.toLowerCase() || '';
  const hasAdherence = noteText.includes('adherent') || noteText.includes('compliant') || noteText.includes('taking medication');
  const hasNonAdherence = noteText.includes('non-adherent') || noteText.includes('not taking') || noteText.includes('missed dose');
  return `  ${v.visit_date}: ${hasAdherence ? 'Adherent' : hasNonAdherence ? 'Non-adherent' : 'Not documented'}`;
}).join('\n')}

ANALYZE AND PROVIDE:

1. **Key Outcome Metrics**:
   - Hospital Readmission Risk (0-100 score with trend)
   - Medication Adherence Score (0-100 with trend)
   - Fall Risk Score (0-100 with trend)
   - Overall Stability Score (0-100)
   - Care Plan Progress Score (0-100)

2. **Positive Outcomes Identified**:
   - List specific improvements (functional, clinical, behavioral)
   - Quantify improvements where possible
   - Contributing factors to success

3. **Negative Outcomes or Concerns**:
   - Declining metrics or worsening conditions
   - Missed goals or setbacks
   - Contributing factors

4. **Trend Analysis**:
   - Vital signs trends (improving/stable/declining)
   - Incident frequency trends
   - Functional status changes over time
   - Care plan goal achievement rate

5. **Predictive Insights** (next 30-60 days):
   - Likelihood of hospital readmission (percentage)
   - Predicted trajectory (improving/stable/declining)
   - Anticipated challenges
   - Proactive interventions needed

6. **Contributing Factors**:
   - Key factors driving positive outcomes
   - Key factors driving negative outcomes
   - Modifiable vs non-modifiable factors

7. **Recommendations**:
   - Specific interventions to maintain positive trajectory
   - Actions to prevent negative outcomes
   - Care plan adjustments needed
   - Monitoring priorities

Return detailed, data-driven analysis.`,
        response_json_schema: {
          type: "object",
          properties: {
            outcome_metrics: {
              type: "object",
              properties: {
                readmission_risk_score: { type: "number", minimum: 0, maximum: 100 },
                readmission_trend: { type: "string", enum: ["improving", "stable", "worsening"] },
                medication_adherence_score: { type: "number", minimum: 0, maximum: 100 },
                adherence_trend: { type: "string", enum: ["improving", "stable", "worsening"] },
                fall_risk_score: { type: "number", minimum: 0, maximum: 100 },
                fall_risk_trend: { type: "string", enum: ["improving", "stable", "worsening"] },
                overall_stability_score: { type: "number", minimum: 0, maximum: 100 },
                care_plan_progress_score: { type: "number", minimum: 0, maximum: 100 }
              }
            },
            positive_outcomes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  outcome: { type: "string" },
                  quantified_improvement: { type: "string" },
                  contributing_factors: { type: "array", items: { type: "string" } }
                }
              }
            },
            negative_outcomes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  concern: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "moderate", "low"] },
                  contributing_factors: { type: "array", items: { type: "string" } }
                }
              }
            },
            trend_analysis: {
              type: "object",
              properties: {
                vital_signs_trend: { type: "string" },
                incident_frequency_trend: { type: "string" },
                functional_status_change: { type: "string" },
                care_plan_achievement_rate: { type: "string" },
                detailed_trends: { type: "array", items: { type: "string" } }
              }
            },
            predictive_insights: {
              type: "object",
              properties: {
                readmission_probability_30_days: { type: "number", minimum: 0, maximum: 100 },
                readmission_probability_60_days: { type: "number", minimum: 0, maximum: 100 },
                predicted_trajectory: { type: "string", enum: ["improving", "stable", "declining", "critical"] },
                anticipated_challenges: { type: "array", items: { type: "string" } },
                proactive_interventions: { type: "array", items: { type: "string" } },
                confidence_level: { type: "string", enum: ["high", "medium", "low"] }
              }
            },
            contributing_factors: {
              type: "object",
              properties: {
                positive_drivers: { type: "array", items: { type: "string" } },
                negative_drivers: { type: "array", items: { type: "string" } },
                modifiable_factors: { type: "array", items: { type: "string" } },
                non_modifiable_factors: { type: "array", items: { type: "string" } }
              }
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  recommendation: { type: "string" },
                  priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  expected_impact: { type: "string" },
                  timeframe: { type: "string" }
                }
              }
            },
            summary: { type: "string" }
          }
        }
      });

      // Generate trend data for charts
      const trendData = generateTrendData(recentVisits, recentIncidents);
      
      setAnalysis({ ...result, trendData, timeframe: days });
    } catch (error) {
      console.error('Outcomes analysis error:', error);
      alert('Failed to analyze outcomes. Please try again.');
    }
    setIsAnalyzing(false);
  };

  const generateTrendData = (visits, incidents) => {
    // Generate vital signs trend
    const vitalsTrend = visits.slice(0, 20).reverse().map(v => ({
      date: new Date(v.visit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      bp_systolic: v.vital_signs?.blood_pressure_systolic || null,
      bp_diastolic: v.vital_signs?.blood_pressure_diastolic || null,
      heart_rate: v.vital_signs?.heart_rate || null,
      o2_sat: v.vital_signs?.oxygen_saturation || null
    }));

    // Generate incident frequency by week
    const incidentsByWeek = {};
    incidents.forEach(inc => {
      const date = new Date(inc.incident_date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      incidentsByWeek[weekKey] = (incidentsByWeek[weekKey] || 0) + 1;
    });

    const incidentTrend = Object.entries(incidentsByWeek).map(([week, count]) => ({
      week,
      incidents: count
    }));

    return { vitalsTrend, incidentTrend };
  };

  const getTrendIcon = (trend) => {
    if (trend === 'improving') return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (trend === 'worsening') return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Activity className="w-4 h-4 text-gray-600" />;
  };

  const getTrendColor = (trend) => {
    if (trend === 'improving') return 'text-green-600';
    if (trend === 'worsening') return 'text-red-600';
    return 'text-gray-600';
  };

  const getScoreColor = (score) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-red-600';
  };

  const getTrajectoryColor = (trajectory) => {
    if (trajectory === 'improving') return 'bg-green-600';
    if (trajectory === 'declining') return 'bg-red-600';
    if (trajectory === 'critical') return 'bg-red-800';
    return 'bg-blue-600';
  };

  if (!patient) {
    return (
      <Alert>
        <Activity className="w-4 h-4" />
        <AlertDescription>Select a patient to view outcomes analysis</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-2 border-purple-300 bg-gradient-to-r from-purple-50 to-indigo-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-purple-600" />
                Patient Outcomes Tracker
              </CardTitle>
              <p className="text-sm text-gray-600 mt-2">
                AI-powered analysis of patient trajectory, outcomes, and predictive insights
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => analyzeOutcomes()}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Refresh Analysis</>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {analysis && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="predictions">Predictions</TabsTrigger>
            <TabsTrigger value="recommendations">Actions</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* Key Metrics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Key Outcome Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-600">Readmission Risk</p>
                      {getTrendIcon(analysis.outcome_metrics.readmission_trend)}
                    </div>
                    <p className={`text-3xl font-bold ${getScoreColor(100 - analysis.outcome_metrics.readmission_risk_score)}`}>
                      {analysis.outcome_metrics.readmission_risk_score}%
                    </p>
                    <p className={`text-xs ${getTrendColor(analysis.outcome_metrics.readmission_trend)}`}>
                      {analysis.outcome_metrics.readmission_trend}
                    </p>
                  </div>

                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-4 rounded-lg border border-green-200">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-600">Medication Adherence</p>
                      {getTrendIcon(analysis.outcome_metrics.adherence_trend)}
                    </div>
                    <p className={`text-3xl font-bold ${getScoreColor(analysis.outcome_metrics.medication_adherence_score)}`}>
                      {analysis.outcome_metrics.medication_adherence_score}%
                    </p>
                    <p className={`text-xs ${getTrendColor(analysis.outcome_metrics.adherence_trend)}`}>
                      {analysis.outcome_metrics.adherence_trend}
                    </p>
                  </div>

                  <div className="bg-gradient-to-br from-orange-50 to-red-50 p-4 rounded-lg border border-orange-200">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-600">Fall Risk</p>
                      {getTrendIcon(analysis.outcome_metrics.fall_risk_trend)}
                    </div>
                    <p className={`text-3xl font-bold ${getScoreColor(100 - analysis.outcome_metrics.fall_risk_score)}`}>
                      {analysis.outcome_metrics.fall_risk_score}%
                    </p>
                    <p className={`text-xs ${getTrendColor(analysis.outcome_metrics.fall_risk_trend)}`}>
                      {analysis.outcome_metrics.fall_risk_trend}
                    </p>
                  </div>

                  <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-4 rounded-lg border border-purple-200">
                    <p className="text-xs font-semibold text-gray-600 mb-2">Overall Stability</p>
                    <p className={`text-3xl font-bold ${getScoreColor(analysis.outcome_metrics.overall_stability_score)}`}>
                      {analysis.outcome_metrics.overall_stability_score}%
                    </p>
                  </div>

                  <div className="bg-gradient-to-br from-yellow-50 to-amber-50 p-4 rounded-lg border border-yellow-200">
                    <p className="text-xs font-semibold text-gray-600 mb-2">Care Plan Progress</p>
                    <p className={`text-3xl font-bold ${getScoreColor(analysis.outcome_metrics.care_plan_progress_score)}`}>
                      {analysis.outcome_metrics.care_plan_progress_score}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Summary */}
            {analysis.summary && (
              <Alert className="bg-blue-50 border-blue-300">
                <Brain className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  <strong>AI Summary:</strong> {analysis.summary}
                </AlertDescription>
              </Alert>
            )}

            {/* Positive Outcomes */}
            {analysis.positive_outcomes?.length > 0 && (
              <Card className="border-l-4 border-l-green-500">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2 text-green-900">
                    <CheckCircle2 className="w-5 h-5" />
                    Positive Outcomes ({analysis.positive_outcomes.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-64">
                    <div className="space-y-3">
                      {analysis.positive_outcomes.map((outcome, idx) => (
                        <div key={idx} className="bg-green-50 p-3 rounded border border-green-200">
                          <div className="flex items-start justify-between mb-2">
                            <p className="font-semibold text-green-900">{outcome.outcome}</p>
                            <Badge className="bg-green-600 text-white">
                              {outcome.quantified_improvement}
                            </Badge>
                          </div>
                          <div className="text-xs text-green-800">
                            <p className="font-semibold mb-1">Contributing Factors:</p>
                            <ul className="space-y-0.5">
                              {outcome.contributing_factors.map((factor, i) => (
                                <li key={i}>• {factor}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Negative Outcomes */}
            {analysis.negative_outcomes?.length > 0 && (
              <Card className="border-l-4 border-l-red-500">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2 text-red-900">
                    <AlertTriangle className="w-5 h-5" />
                    Areas of Concern ({analysis.negative_outcomes.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-64">
                    <div className="space-y-3">
                      {analysis.negative_outcomes.map((outcome, idx) => (
                        <div key={idx} className={`p-3 rounded border ${
                          outcome.severity === 'critical' ? 'bg-red-50 border-red-300' :
                          outcome.severity === 'high' ? 'bg-orange-50 border-orange-300' :
                          'bg-yellow-50 border-yellow-300'
                        }`}>
                          <div className="flex items-start justify-between mb-2">
                            <p className="font-semibold text-gray-900">{outcome.concern}</p>
                            <Badge variant="outline">{outcome.severity}</Badge>
                          </div>
                          <div className="text-xs text-gray-700">
                            <p className="font-semibold mb-1">Contributing Factors:</p>
                            <ul className="space-y-0.5">
                              {outcome.contributing_factors.map((factor, i) => (
                                <li key={i}>• {factor}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Trends Tab */}
          <TabsContent value="trends" className="space-y-4 mt-4">
            {/* Trend Analysis Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Trend Analysis Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-600">Vital Signs</p>
                    <p className="text-sm text-gray-900">{analysis.trend_analysis.vital_signs_trend}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-600">Incident Frequency</p>
                    <p className="text-sm text-gray-900">{analysis.trend_analysis.incident_frequency_trend}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-600">Functional Status</p>
                    <p className="text-sm text-gray-900">{analysis.trend_analysis.functional_status_change}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-600">Care Plan Achievement</p>
                    <p className="text-sm text-gray-900">{analysis.trend_analysis.care_plan_achievement_rate}</p>
                  </div>
                </div>
                
                {analysis.trend_analysis.detailed_trends?.length > 0 && (
                  <div className="bg-gray-50 p-3 rounded border">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Detailed Observations:</p>
                    <ul className="text-xs text-gray-600 space-y-1">
                      {analysis.trend_analysis.detailed_trends.map((trend, i) => (
                        <li key={i}>• {trend}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Vital Signs Chart */}
            {analysis.trendData?.vitalsTrend?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Vital Signs Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={analysis.trendData.vitalsTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="bp_systolic" stroke="#ef4444" name="BP Systolic" />
                      <Line type="monotone" dataKey="heart_rate" stroke="#3b82f6" name="Heart Rate" />
                      <Line type="monotone" dataKey="o2_sat" stroke="#22c55e" name="O2 Sat" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Incident Frequency Chart */}
            {analysis.trendData?.incidentTrend?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Incident Frequency by Week</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={analysis.trendData.incidentTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="incidents" fill="#f59e0b" name="Incidents" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Contributing Factors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-l-4 border-l-green-500">
                <CardHeader>
                  <CardTitle className="text-sm text-green-900">Positive Drivers</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-xs text-green-800 space-y-1">
                    {analysis.contributing_factors.positive_drivers.map((factor, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-red-500">
                <CardHeader>
                  <CardTitle className="text-sm text-red-900">Negative Drivers</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-xs text-red-800 space-y-1">
                    {analysis.contributing_factors.negative_drivers.map((factor, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <AlertTriangle className="w-3 h-3 text-red-600 mt-0.5 flex-shrink-0" />
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Predictions Tab */}
          <TabsContent value="predictions" className="space-y-4 mt-4">
            {/* Predicted Trajectory */}
            <Card className="border-2 border-purple-300">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-5 h-5 text-purple-600" />
                  Predicted Trajectory
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 mb-4">
                  <Badge className={`${getTrajectoryColor(analysis.predictive_insights.predicted_trajectory)} text-white text-lg px-4 py-2`}>
                    {analysis.predictive_insights.predicted_trajectory.toUpperCase()}
                  </Badge>
                  <Badge variant="outline">
                    {analysis.predictive_insights.confidence_level} confidence
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Readmission Risk */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Hospital Readmission Risk</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold">Next 30 Days</p>
                      <span className={`text-2xl font-bold ${
                        analysis.predictive_insights.readmission_probability_30_days < 20 ? 'text-green-600' :
                        analysis.predictive_insights.readmission_probability_30_days < 50 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {analysis.predictive_insights.readmission_probability_30_days}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full ${
                          analysis.predictive_insights.readmission_probability_30_days < 20 ? 'bg-green-500' :
                          analysis.predictive_insights.readmission_probability_30_days < 50 ? 'bg-yellow-500' :
                          'bg-red-500'
                        }`}
                        style={{ width: `${analysis.predictive_insights.readmission_probability_30_days}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold">Next 60 Days</p>
                      <span className={`text-2xl font-bold ${
                        analysis.predictive_insights.readmission_probability_60_days < 20 ? 'text-green-600' :
                        analysis.predictive_insights.readmission_probability_60_days < 50 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {analysis.predictive_insights.readmission_probability_60_days}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full ${
                          analysis.predictive_insights.readmission_probability_60_days < 20 ? 'bg-green-500' :
                          analysis.predictive_insights.readmission_probability_60_days < 50 ? 'bg-yellow-500' :
                          'bg-red-500'
                        }`}
                        style={{ width: `${analysis.predictive_insights.readmission_probability_60_days}%` }}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Anticipated Challenges */}
            {analysis.predictive_insights.anticipated_challenges?.length > 0 && (
              <Card className="border-l-4 border-l-orange-500">
                <CardHeader>
                  <CardTitle className="text-base text-orange-900">Anticipated Challenges</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-orange-800 space-y-2">
                    {analysis.predictive_insights.anticipated_challenges.map((challenge, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                        <span>{challenge}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Proactive Interventions */}
            {analysis.predictive_insights.proactive_interventions?.length > 0 && (
              <Card className="border-l-4 border-l-blue-500">
                <CardHeader>
                  <CardTitle className="text-base text-blue-900">Recommended Proactive Interventions</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-blue-800 space-y-2">
                    {analysis.predictive_insights.proactive_interventions.map((intervention, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <ArrowRight className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <span>{intervention}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Recommendations Tab */}
          <TabsContent value="recommendations" className="space-y-4 mt-4">
            {analysis.recommendations?.length > 0 && (
              <div className="space-y-3">
                {analysis.recommendations
                  .sort((a, b) => {
                    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                    return priorityOrder[a.priority] - priorityOrder[b.priority];
                  })
                  .map((rec, idx) => (
                    <Card key={idx} className={`border-l-4 ${
                      rec.priority === 'critical' ? 'border-l-red-500' :
                      rec.priority === 'high' ? 'border-l-orange-500' :
                      rec.priority === 'medium' ? 'border-l-blue-500' :
                      'border-l-gray-400'
                    }`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-gray-900">{rec.recommendation}</h4>
                          <Badge className={
                            rec.priority === 'critical' ? 'bg-red-600' :
                            rec.priority === 'high' ? 'bg-orange-600' :
                            rec.priority === 'medium' ? 'bg-blue-600' :
                            'bg-gray-500'
                          }>
                            {rec.priority}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs font-semibold text-gray-600">Expected Impact</p>
                            <p className="text-gray-800">{rec.expected_impact}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-600">Timeframe</p>
                            <p className="text-gray-800 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {rec.timeframe}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            )}

            {/* Modifiable Factors */}
            <Card className="bg-green-50 border-green-300">
              <CardHeader>
                <CardTitle className="text-base text-green-900">Modifiable Factors (Actionable)</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-green-800 space-y-2">
                  {analysis.contributing_factors.modifiable_factors.map((factor, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>{factor}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {!analysis && !isAnalyzing && (
        <Card>
          <CardContent className="p-12 text-center">
            <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">No outcome analysis available</p>
            <Button onClick={analyzeOutcomes} className="bg-purple-600 hover:bg-purple-700">
              <Sparkles className="w-4 h-4 mr-2" />
              Run Outcomes Analysis
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function calculateAge(dob) {
  if (!dob) return 'Unknown';
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}