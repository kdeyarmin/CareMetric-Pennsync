import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Brain,
  Activity,
  Heart,
  Pill,
  TrendingDown,
  Shield,
  Users,
  Clock,
  Zap
} from "lucide-react";

export default function PatientAlertAnalyzer({ 
  patientId, 
  onAlertsGenerated,
  autoAnalyze = false 
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [generatedAlerts, setGeneratedAlerts] = useState([]);
  const queryClient = useQueryClient();

  // Current user — needed to assign generated tasks (Task.assigned_to is required;
  // without it the critical-alert escalation task create silently fails).
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Fetch patient data
  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.filter({ id: patientId }).then(r => r[0]),
    enabled: !!patientId
  });

  // Fetch recent visits
  const { data: recentVisits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 10),
    enabled: !!patientId
  });

  // Fetch care plans
  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId
  });

  // Fetch incidents
  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidents', patientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 5),
    enabled: !!patientId
  });

  // Fetch existing alerts
  const { data: existingAlerts = [] } = useQuery({
    queryKey: ['patientAlerts', patientId],
    queryFn: () => base44.entities.PatientAlert.filter({ patient_id: patientId, status: 'active' }),
    enabled: !!patientId
  });

  const extractVitalTrends = useCallback((visits) => {
    const vitals = visits
      .filter(v => v.vital_signs)
      .map(v => ({
        date: v.visit_date,
        ...v.vital_signs
      }));

    if (vitals.length < 2) return { insufficient_data: true };

    const trends = {};
    const vitalKeys = ['blood_pressure_systolic', 'blood_pressure_diastolic', 'heart_rate', 'oxygen_saturation', 'weight', 'temperature'];

    vitalKeys.forEach(key => {
      const values = vitals.map(v => v[key]).filter(v => v != null);
      if (values.length >= 2) {
        const first = values[values.length - 1];
        const last = values[0];
        const change = last - first;
        const percentChange = first !== 0 ? ((change / first) * 100).toFixed(1) : 0;

        trends[key] = {
          current: last,
          previous: first,
          change,
          percent_change: parseFloat(percentChange),
          trend: change > 0 ? 'increasing' : change < 0 ? 'decreasing' : 'stable',
          values: values.slice(0, 5)
        };
      }
    });

    return trends;
  }, []);

  const sendAlertNotifications = useCallback(async (criticalAlerts) => {
    for (const alert of criticalAlerts) {
      try {
        // Create a high-priority task for critical alerts
        await base44.entities.Task.create({
          patient_id: patientId,
          assigned_to: currentUser?.email,
          title: `🚨 CRITICAL ALERT: ${alert.title}`,
          description: `${alert.message}\n\nContributing Factors:\n${alert.contributing_factors?.join('\n')}\n\nRecommended Actions:\n${alert.recommended_actions?.join('\n')}`,
          priority: 'high',
          type: 'safety',
          status: 'pending',
          source: 'ai_generated',
          ai_reason: 'Critical patient alert requiring immediate attention'
        });
      } catch (error) {
        console.error("Error creating alert task:", error);
      }
    }
  }, [patientId, currentUser]);

  const runAnalysis = useCallback(async () => {
    if (!patient) return;

    setIsAnalyzing(true);
    setAnalysisProgress(10);
    setGeneratedAlerts([]);

    try {
      // Compile patient data for analysis
      const visitSummaries = recentVisits.map(v => ({
        date: v.visit_date,
        type: v.visit_type,
        vitals: v.vital_signs,
        notes: v.nurse_notes?.substring(0, 500)
      }));

      const incidentSummaries = incidents.map(i => ({
        type: i.incident_type,
        date: i.incident_date,
        severity: i.severity,
        details: i.details
      }));

      const carePlanSummaries = carePlans.map(cp => ({
        problem: cp.problem,
        goal: cp.goal,
        status: cp.status,
        target_date: cp.target_date
      }));

      setAnalysisProgress(30);

      // Extract vital trends
      const vitalTrends = extractVitalTrends(recentVisits);

      setAnalysisProgress(50);

      const result = await invokeLLM({
        prompt: `You are an AI clinical decision support system for home health/hospice. Analyze this patient's data to identify potential critical events, deteriorations, or risks that require proactive intervention.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Care Type: ${patient.care_type}
- Status: ${patient.status}
- Allergies: ${patient.allergies || 'None documented'}

RECENT VISITS (Last 10):
${JSON.stringify(visitSummaries, null, 2)}

VITAL SIGN TRENDS:
${JSON.stringify(vitalTrends, null, 2)}

RECENT INCIDENTS:
${JSON.stringify(incidentSummaries, null, 2)}

ACTIVE CARE PLANS:
${JSON.stringify(carePlanSummaries, null, 2)}

ANALYSIS REQUIREMENTS:
1. Identify ANY patterns suggesting clinical deterioration
2. Assess medication-related risks (polypharmacy, compliance issues, interactions)
3. Evaluate fall risk based on history and current status
4. Calculate readmission risk based on diagnosis and trends
5. Identify infection risks or early signs
6. Check for symptom escalation patterns
7. Identify care gaps (missed goals)
8. For hospice: assess comfort and symptom management adequacy
9. Evaluate caregiver stress indicators if mentioned
10. Consider social determinants affecting care

For each identified risk, provide:
- Specific alert with severity
- Evidence-based contributing factors
- Actionable recommendations
- Risk score (0-100)

SEVERITY GUIDELINES:
- CRITICAL (90-100): Immediate intervention needed, potential for serious harm
- HIGH (70-89): Urgent attention within 24 hours
- MEDIUM (40-69): Address within 48-72 hours
- LOW (0-39): Monitor, address at next visit

Return JSON:
{
  "analysis_summary": "Brief overall patient risk assessment",
  "overall_risk_level": "low" | "moderate" | "high" | "critical",
  "alerts": [
    {
      "alert_type": "vital_deterioration" | "medication_risk" | "fall_risk" | "readmission_risk" | "infection_risk" | "symptom_escalation" | "care_gap" | "urgent_intervention" | "hospice_transition" | "caregiver_burnout",
      "severity": "critical" | "high" | "medium" | "low",
      "title": "Concise alert title",
      "message": "Detailed alert message explaining the concern",
      "contributing_factors": ["Specific factor 1", "Specific factor 2"],
      "recommended_actions": ["Action 1", "Action 2"],
      "risk_score": 0-100,
      "data_sources": {
        "vitals": "relevant vital data",
        "trends": "trend information",
        "history": "relevant history"
      },
      "urgency_rationale": "Why this needs attention at this severity level",
      "clinical_evidence": "Evidence-based reasoning for this alert"
    }
  ],
  "monitoring_recommendations": ["What to monitor going forward"],
  "positive_indicators": ["Any positive trends or strengths noted"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            analysis_summary: { type: "string" },
            overall_risk_level: { type: "string" },
            alerts: { type: "array", items: { type: "object" } },
            monitoring_recommendations: { type: "array", items: { type: "string" } },
            positive_indicators: { type: "array", items: { type: "string" } }
          }
        }
      });

      setAnalysisProgress(80);

      // Create alerts in database
      const createdAlerts = [];
      for (const alert of result.alerts || []) {
        // Check if similar alert already exists
        const existingSimilar = existingAlerts.find(
          ea => ea.alert_type === alert.alert_type && ea.status === 'active'
        );

        if (!existingSimilar) {
          const newAlert = await base44.entities.PatientAlert.create({
            patient_id: patientId,
            alert_type: alert.alert_type,
            severity: alert.severity,
            title: alert.title,
            message: alert.message,
            contributing_factors: alert.contributing_factors,
            recommended_actions: alert.recommended_actions,
            risk_score: alert.risk_score,
            data_sources: alert.data_sources,
            status: 'active',
            flagged_urgent: alert.severity === 'critical',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          });
          createdAlerts.push({ ...alert, id: newAlert.id });
        }
      }

      setAnalysisProgress(100);
      setGeneratedAlerts(createdAlerts);

      // Refresh alerts query
      queryClient.invalidateQueries({ queryKey: ['patientAlerts', patientId] });

      if (onAlertsGenerated) {
        onAlertsGenerated(createdAlerts, result);
      }

      // Send notifications for critical alerts
      await sendAlertNotifications(createdAlerts.filter(a => a.severity === 'critical'));

    } catch (error) {
      console.error("Error analyzing patient:", error);
    }
    setIsAnalyzing(false);
  }, [patient, recentVisits, incidents, carePlans, patientId, existingAlerts, queryClient, onAlertsGenerated, extractVitalTrends, sendAlertNotifications]);

  // Auto-analyze on mount if enabled
  useEffect(() => {
    if (autoAnalyze && patientId && patient) {
      runAnalysis();
    }
  }, [autoAnalyze, patientId, patient, runAnalysis]);

  const getAlertIcon = (type) => {
    const icons = {
      vital_deterioration: Activity,
      medication_risk: Pill,
      fall_risk: TrendingDown,
      readmission_risk: Heart,
      infection_risk: Shield,
      symptom_escalation: AlertTriangle,
      care_gap: Clock,
      urgent_intervention: Zap,
      hospice_transition: Heart,
      caregiver_burnout: Users
    };
    const Icon = icons[type] || AlertTriangle;
    return <Icon className="w-4 h-4" />;
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  if (!patientId) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-6 text-center text-slate-500">
          <Brain className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p>Select a patient to analyze for alerts</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-orange-200">
      <CardHeader className="py-3 bg-gradient-to-r from-orange-50 to-red-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-orange-600" />
            AI Patient Alert Analyzer
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={runAnalysis}
            disabled={isAnalyzing}
            className="h-7"
          >
            {isAnalyzing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <><RefreshCw className="w-3 h-3 mr-1" /> Analyze</>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {isAnalyzing ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-orange-600" />
              <span className="text-sm text-slate-600">Analyzing patient data...</span>
            </div>
            <Progress value={analysisProgress} className="h-2" />
            <p className="text-xs text-slate-500">
              {analysisProgress < 30 && "Gathering patient history..."}
              {analysisProgress >= 30 && analysisProgress < 50 && "Analyzing vital trends..."}
              {analysisProgress >= 50 && analysisProgress < 80 && "Identifying risk patterns..."}
              {analysisProgress >= 80 && "Creating alerts..."}
            </p>
          </div>
        ) : generatedAlerts.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {generatedAlerts.length} new alert(s) identified
            </p>
            {generatedAlerts.slice(0, 3).map((alert, idx) => (
              <div key={idx} className="p-2 bg-slate-50 rounded-lg border">
                <div className="flex items-center gap-2 mb-1">
                  {getAlertIcon(alert.alert_type)}
                  <Badge className={getSeverityColor(alert.severity)}>
                    {alert.severity}
                  </Badge>
                  <span className="text-sm font-medium">{alert.title}</span>
                </div>
                <p className="text-xs text-slate-600">{alert.message}</p>
              </div>
            ))}
            {generatedAlerts.length > 3 && (
              <p className="text-xs text-slate-500 text-center">
                +{generatedAlerts.length - 3} more alerts
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <Brain className="w-10 h-10 text-orange-300 mx-auto mb-2" />
            <p className="text-sm text-slate-600 mb-2">
              Analyze patient data to identify potential risks
            </p>
            <Button
              onClick={runAnalysis}
              disabled={isAnalyzing || !patient}
              className="bg-orange-600 hover:bg-orange-700"
              size="sm"
            >
              <Brain className="w-4 h-4 mr-2" />
              Run AI Analysis
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}