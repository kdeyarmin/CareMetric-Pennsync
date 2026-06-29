import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ChevronRight,
  Brain,
  Shield,
  User,
  Zap
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function PredictiveRiskScoring({ patients = [], visits = [], carePlans = [], incidents = [], compact = false }) {
  // Object shape: every consumer reads riskScores.risk_assessments / .critical_alerts.
  const [riskScores, setRiskScores] = useState({});
  const ai = useAICall();
  const [lastAnalyzed, setLastAnalyzed] = useState(null);

  const calculateVitalTrends = useCallback((visits) => {
    if (visits.length < 2) return null;

    const trends = {};
    const latest = visits[0]?.vital_signs;
    const previous = visits[1]?.vital_signs;

    if (latest && previous) {
      if (latest.blood_pressure_systolic && previous.blood_pressure_systolic) {
        const bpChange = latest.blood_pressure_systolic - previous.blood_pressure_systolic;
        trends.blood_pressure = bpChange > 10 ? 'increasing' : bpChange < -10 ? 'decreasing' : 'stable';
      }
      if (latest.weight && previous.weight) {
        const weightChange = latest.weight - previous.weight;
        trends.weight = weightChange > 2 ? 'increasing' : weightChange < -2 ? 'decreasing' : 'stable';
      }
      if (latest.oxygen_saturation && previous.oxygen_saturation) {
        const o2Change = latest.oxygen_saturation - previous.oxygen_saturation;
        trends.oxygen = o2Change < -2 ? 'decreasing' : o2Change > 2 ? 'increasing' : 'stable';
      }
    }

    return trends;
  }, []);

  const analyzePatientRisks = useCallback(async () => {
    if (patients.length === 0) return;
    
    
    try {
      // Prepare patient data for analysis
      const patientDataSummaries = patients.slice(0, 20).map(patient => {
        const patientVisits = visits.filter(v => v.patient_id === patient.id);
        const patientCarePlans = carePlans.filter(cp => cp.patient_id === patient.id);
        const patientIncidents = incidents.filter(i => i.patient_id === patient.id);
        
        // Get recent vitals
        const recentVisitsWithVitals = patientVisits
          .filter(v => v.vital_signs && v.status === 'completed')
          .sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date))
          .slice(0, 5);
        
        // Calculate vital trends
        const vitalTrends = calculateVitalTrends(recentVisitsWithVitals);
        
        // Care plan adherence
        const activeCarePlans = patientCarePlans.filter(cp => cp.status === 'active');
        const metCarePlans = patientCarePlans.filter(cp => cp.status === 'met');
        const carePlanAdherence = patientCarePlans.length > 0 
          ? Math.round((metCarePlans.length / patientCarePlans.length) * 100) 
          : null;
        
        // Recent incidents
        const recentIncidents = patientIncidents.filter(i => {
          const incidentDate = new Date(i.incident_date);
          return differenceInDays(new Date(), incidentDate) <= 90;
        });
        
        // Visit frequency
        const last30DaysVisits = patientVisits.filter(v => {
          const visitDate = new Date(v.visit_date);
          return differenceInDays(new Date(), visitDate) <= 30;
        }).length;
        
        return {
          id: patient.id,
          name: `${patient.first_name} ${patient.last_name}`,
          age: patient.date_of_birth ? Math.floor(differenceInDays(new Date(), new Date(patient.date_of_birth)) / 365.25) : null,
          primary_diagnosis: patient.primary_diagnosis,
          secondary_diagnoses: patient.secondary_diagnoses,
          care_type: patient.care_type,
          total_visits: patientVisits.length,
          visits_last_30_days: last30DaysVisits,
          vital_trends: vitalTrends,
          latest_vitals: recentVisitsWithVitals[0]?.vital_signs || null,
          active_care_plans: activeCarePlans.length,
          care_plan_adherence: carePlanAdherence,
          recent_incidents: recentIncidents.map(i => ({
            type: i.incident_type,
            severity: i.severity,
            date: i.incident_date
          })),
          fall_history: recentIncidents.filter(i => i.incident_type === 'fall').length,
          hospitalization_history: recentIncidents.filter(i => i.incident_type === 'hospitalized').length
        };
      });

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a clinical risk assessment AI for home health and hospice care. Analyze each patient's data and calculate predictive risk scores.

PATIENT DATA:
${JSON.stringify(patientDataSummaries, null, 2)}

For each patient, calculate risk scores (0-100) for:
1. READMISSION RISK - Hospital readmission within 30 days
2. FALL RISK - Risk of falls based on diagnosis, age, medications, history
3. DECLINE RISK - Risk of clinical deterioration
4. CARE GAP RISK - Risk of missed care needs or non-compliance

Consider these factors:
- Vital sign trends (worsening BP, weight gain for CHF, declining O2)
- Diagnosis complexity (CHF, COPD, diabetes, multiple comorbidities)
- Care plan adherence rates
- Recent incident history
- Visit frequency patterns
- Age and functional status indicators

For HIGH RISK patients (score >= 70), provide:
- Specific risk factors identified
- Recommended proactive interventions
- Priority level (critical/high/moderate)

Return JSON array:
{
  "risk_assessments": [
    {
      "patient_id": "id",
      "patient_name": "name",
      "overall_risk_level": "critical" | "high" | "moderate" | "low",
      "readmission_risk": { "score": 0-100, "factors": ["factor1"], "trend": "increasing" | "stable" | "decreasing" },
      "fall_risk": { "score": 0-100, "factors": ["factor1"], "trend": "..." },
      "decline_risk": { "score": 0-100, "factors": ["factor1"], "trend": "..." },
      "care_gap_risk": { "score": 0-100, "factors": ["factor1"], "trend": "..." },
      "priority_interventions": ["intervention1", "intervention2"],
      "alert_summary": "Brief summary of top concerns",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "high_risk_count": number,
  "critical_alerts": ["alert1", "alert2"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            risk_assessments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  patient_id: { type: "string" },
                  patient_name: { type: "string" },
                  overall_risk_level: { type: "string" },
                  readmission_risk: { type: "object" },
                  fall_risk: { type: "object" },
                  decline_risk: { type: "object" },
                  care_gap_risk: { type: "object" },
                  priority_interventions: { type: "array", items: { type: "string" } },
                  alert_summary: { type: "string" },
                  confidence: { type: "string" }
                }
              }
            },
            high_risk_count: { type: "number" },
            critical_alerts: { type: "array", items: { type: "string" } }
          }
        }
      });

      setRiskScores(result);
      setLastAnalyzed(new Date());
    } catch (error) {
      console.error("Error analyzing risks:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patients, visits, carePlans, incidents, calculateVitalTrends]);

  useEffect(() => {
    if (patients.length > 0 && !riskScores.risk_assessments) {
      analyzePatientRisks();
    }
  }, [patients.length, riskScores.risk_assessments, analyzePatientRisks]);

  const getRiskLevelColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'moderate': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  const getRiskScoreColor = (score) => {
    if (score >= 80) return 'text-red-600';
    if (score >= 60) return 'text-orange-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getProgressColor = (score) => {
    if (score >= 80) return 'bg-red-500';
    if (score >= 60) return 'bg-orange-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getTrendIcon = (trend) => {
    switch (trend) {
      case 'increasing': return <TrendingUp className="w-3 h-3 text-red-500" />;
      case 'decreasing': return <TrendingDown className="w-3 h-3 text-green-500" />;
      default: return <Activity className="w-3 h-3 text-slate-500" />;
    }
  };

  if (compact) {
    // Compact view for dashboard widgets
    const highRiskPatients = riskScores.risk_assessments?.filter(
      r => r.overall_risk_level === 'critical' || r.overall_risk_level === 'high'
    ) || [];

    return (
      <Card className="border-red-200">
        <CardHeader className="py-3 bg-gradient-to-r from-red-50 to-orange-50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="w-4 h-4 text-red-600" />
              Predictive Risk Alerts
            </CardTitle>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={analyzePatientRisks}
              disabled={ai.loading}
              className="h-7 px-2"
            >
              <RefreshCw className={`w-3 h-3 ${ai.loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-3">
          {ai.loading ? (
            <div className="flex items-center justify-center py-4 text-sm text-slate-500">
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Analyzing patient risks...
            </div>
          ) : highRiskPatients.length > 0 ? (
            <div className="space-y-2">
              {highRiskPatients.slice(0, 3).map((patient) => (
                <div key={patient.patient_id} className="p-2 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">{patient.patient_name}</span>
                    <Badge className={getRiskLevelColor(patient.overall_risk_level)}>
                      {patient.overall_risk_level}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600">{patient.alert_summary}</p>
                </div>
              ))}
              {highRiskPatients.length > 3 && (
                <p className="text-xs text-center text-slate-500">
                  +{highRiskPatients.length - 3} more high-risk patients
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-center text-slate-500 py-4">
              No high-risk patients identified
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Brain className="w-6 h-6 text-navy-600" />
            AI Predictive Risk Scoring
          </h2>
          <p className="text-sm text-slate-600">
            Proactive identification of patients at risk for adverse events
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastAnalyzed && (
            <span className="text-xs text-slate-500">
              Last analyzed: {format(lastAnalyzed, 'MMM d, h:mm a')}
            </span>
          )}
          <Button 
            onClick={analyzePatientRisks}
            disabled={ai.loading}
            className="bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Analyze Risks
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Critical Alerts */}
      {riskScores.critical_alerts?.length > 0 && (
        <Alert className="bg-red-50 border-red-300">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <AlertDescription>
            <p className="font-semibold text-red-900 mb-2">Critical Alerts Requiring Immediate Attention</p>
            <ul className="list-disc list-inside text-sm text-red-800 space-y-1">
              {riskScores.critical_alerts.map((alert, idx) => (
                <li key={idx}>{alert}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Stats */}
      {riskScores.risk_assessments && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-700">
                    {riskScores.risk_assessments.filter(r => r.overall_risk_level === 'critical').length}
                  </p>
                  <p className="text-xs text-red-600">Critical Risk</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-orange-50 border-orange-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-orange-700">
                    {riskScores.risk_assessments.filter(r => r.overall_risk_level === 'high').length}
                  </p>
                  <p className="text-xs text-orange-600">High Risk</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-yellow-50 border-yellow-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center">
                  <Activity className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-yellow-700">
                    {riskScores.risk_assessments.filter(r => r.overall_risk_level === 'moderate').length}
                  </p>
                  <p className="text-xs text-yellow-600">Moderate Risk</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-700">
                    {riskScores.risk_assessments.filter(r => r.overall_risk_level === 'low').length}
                  </p>
                  <p className="text-xs text-green-600">Low Risk</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Patient Risk Cards */}
      {ai.loading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <RefreshCw className="w-12 h-12 mx-auto mb-4 text-navy-500 animate-spin" />
            <p className="text-lg font-medium text-slate-700">Analyzing Patient Risk Factors...</p>
            <p className="text-sm text-slate-500">This may take a moment</p>
          </CardContent>
        </Card>
      ) : riskScores.risk_assessments?.length > 0 ? (
        <div className="grid gap-4">
          {riskScores.risk_assessments
            .sort((a, b) => {
              const levelOrder = { critical: 0, high: 1, moderate: 2, low: 3 };
              return levelOrder[a.overall_risk_level] - levelOrder[b.overall_risk_level];
            })
            .map((assessment) => (
              <Card 
                key={assessment.patient_id}
                className={`border-l-4 ${
                  assessment.overall_risk_level === 'critical' ? 'border-l-red-500' :
                  assessment.overall_risk_level === 'high' ? 'border-l-orange-500' :
                  assessment.overall_risk_level === 'moderate' ? 'border-l-yellow-500' :
                  'border-l-green-500'
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                    {/* Patient Info */}
                    <div className="flex-shrink-0">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center">
                          <User className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900">{assessment.patient_name}</h3>
                          <Badge className={getRiskLevelColor(assessment.overall_risk_level)}>
                            {(assessment.overall_risk_level || '').toUpperCase()} RISK
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-slate-600 mb-3">{assessment.alert_summary}</p>
                      
                      <Link to={`${createPageUrl("PatientDetails")}?patientId=${assessment.patient_id}`}>
                        <Button size="sm" variant="outline" className="gap-1">
                          View Patient <ChevronRight className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>

                    {/* Risk Scores */}
                    <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                      {/* Readmission Risk */}
                      <div className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-slate-600">Readmission</span>
                          {getTrendIcon(assessment.readmission_risk?.trend)}
                        </div>
                        <p className={`text-xl font-bold ${getRiskScoreColor(assessment.readmission_risk?.score)}`}>
                          {assessment.readmission_risk?.score}%
                        </p>
                        <div className="mt-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${getProgressColor(assessment.readmission_risk?.score)}`}
                            style={{ width: `${assessment.readmission_risk?.score}%` }}
                          />
                        </div>
                      </div>

                      {/* Fall Risk */}
                      <div className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-slate-600">Fall Risk</span>
                          {getTrendIcon(assessment.fall_risk?.trend)}
                        </div>
                        <p className={`text-xl font-bold ${getRiskScoreColor(assessment.fall_risk?.score)}`}>
                          {assessment.fall_risk?.score}%
                        </p>
                        <div className="mt-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${getProgressColor(assessment.fall_risk?.score)}`}
                            style={{ width: `${assessment.fall_risk?.score}%` }}
                          />
                        </div>
                      </div>

                      {/* Decline Risk */}
                      <div className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-slate-600">Decline</span>
                          {getTrendIcon(assessment.decline_risk?.trend)}
                        </div>
                        <p className={`text-xl font-bold ${getRiskScoreColor(assessment.decline_risk?.score)}`}>
                          {assessment.decline_risk?.score}%
                        </p>
                        <div className="mt-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${getProgressColor(assessment.decline_risk?.score)}`}
                            style={{ width: `${assessment.decline_risk?.score}%` }}
                          />
                        </div>
                      </div>

                      {/* Care Gap Risk */}
                      <div className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-slate-600">Care Gap</span>
                          {getTrendIcon(assessment.care_gap_risk?.trend)}
                        </div>
                        <p className={`text-xl font-bold ${getRiskScoreColor(assessment.care_gap_risk?.score)}`}>
                          {assessment.care_gap_risk?.score}%
                        </p>
                        <div className="mt-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${getProgressColor(assessment.care_gap_risk?.score)}`}
                            style={{ width: `${assessment.care_gap_risk?.score}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Interventions */}
                    {assessment.priority_interventions?.length > 0 && (
                      <div className="lg:w-64 flex-shrink-0">
                        <p className="text-xs font-semibold text-slate-700 mb-2">Recommended Interventions:</p>
                        <ul className="space-y-1">
                          {assessment.priority_interventions.slice(0, 3).map((intervention, idx) => (
                            <li key={idx} className="text-xs text-slate-600 flex items-start gap-1">
                              <ChevronRight className="w-3 h-3 mt-0.5 text-navy-500 flex-shrink-0" />
                              {intervention}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <Brain className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <p className="text-slate-500">Click "Analyze Risks" to generate predictive risk scores</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}