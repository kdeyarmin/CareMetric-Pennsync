import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, TrendingUp, Activity, Heart, Brain, Home, Pill } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function RealTimeRiskScoring({ patientId, compact = false }) {
  const [riskScore, setRiskScore] = useState(null);
  const ai = useAICall();

  // Fetch patient data
  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000).then(patients => 
      patients.find(p => p.id === patientId)
    ),
    enabled: !!patientId
  });

  // Fetch recent visits
  const { data: recentVisits = [] } = useQuery({
    queryKey: ['recentVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 5),
    enabled: !!patientId,
    initialData: []
  });

  // Fetch clinical events
  const { data: clinicalEvents = [] } = useQuery({
    queryKey: ['clinicalEvents', patientId],
    queryFn: () => base44.entities.ClinicalEvent.filter({ patient_id: patientId }, '-event_date', 10),
    enabled: !!patientId,
    initialData: []
  });

  // Fetch incidents
  const { data: incidents = [] } = useQuery({
    queryKey: ['incidents', patientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 5),
    enabled: !!patientId,
    initialData: []
  });

  const calculateRiskScore = useCallback(async () => {
    if (!patient) return;

    try {
      // Real-time AI risk calculation
      const response = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Analyze this patient's risk across multiple dimensions and provide a comprehensive risk assessment:

Patient Data:
- Name: ${patient.first_name} ${patient.last_name}
- Primary Diagnosis: ${patient.primary_diagnosis}
- Medications: ${patient.current_medications?.length || 0}
- Recent Falls: ${incidents.filter(i => i.incident_type === 'fall').length}
- Recent Hospitalizations: ${incidents.filter(i => i.incident_type === 'hospitalized').length}
- Functional Status: ${JSON.stringify(patient.functional_status)}
- Age: ${patient.date_of_birth}
- Recent Clinical Events: ${clinicalEvents.length} events in last 30 days

Recent Visits Summary:
${recentVisits.slice(0, 3).map(v => `- ${v.visit_date}: ${v.visit_type}, Vitals: ${JSON.stringify(v.vital_signs)}`).join('\n')}

Calculate comprehensive risk scores (0-100) for:
1. Readmission Risk
2. Fall Risk
3. Medication Non-Adherence Risk
4. Clinical Deterioration Risk
5. Hospice Transition Risk
6. Overall Composite Risk

For each risk, provide:
- Score (0-100)
- Risk level (low/moderate/high/critical)
- Contributing factors
- Recommended interventions
- Urgency level`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_score: { type: "number" },
            overall_risk_level: { type: "string" },
            risk_categories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  score: { type: "number" },
                  level: { type: "string" },
                  factors: { type: "array", items: { type: "string" } },
                  interventions: { type: "array", items: { type: "string" } },
                  urgency: { type: "string" }
                }
              }
            },
            priority_actions: { type: "array", items: { type: "string" } },
            trend: { type: "string" }
          }
        }
      });

      setRiskScore(response);
    } catch (error) {
      console.error("Risk calculation failed:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patient, incidents, clinicalEvents, recentVisits]);

  useEffect(() => {
    if (patient && recentVisits.length > 0 && !riskScore && !ai.loading) {
      calculateRiskScore();
    }
  }, [patient, recentVisits, riskScore, ai.loading, calculateRiskScore]);

  const getRiskColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'moderate': return 'bg-yellow-600 text-white';
      case 'low': return 'bg-green-600 text-white';
      default: return 'bg-slate-600 text-white';
    }
  };

  const getRiskIcon = (category) => {
    switch (category?.toLowerCase()) {
      case 'readmission risk': return Heart;
      case 'fall risk': return AlertTriangle;
      case 'clinical deterioration risk': return Activity;
      case 'hospice transition risk': return Home;
      case 'medication non-adherence risk': return Pill;
      default: return Brain;
    }
  };

  if (!patient) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {ai.loading ? (
          <Badge className="bg-slate-400 animate-pulse">Calculating...</Badge>
        ) : riskScore ? (
          <>
            <Badge className={getRiskColor(riskScore.overall_risk_level)}>
              Risk: {Math.round(riskScore.overall_risk_score)}
            </Badge>
            {riskScore.overall_risk_level === 'critical' || riskScore.overall_risk_level === 'high' ? (
              <AlertTriangle className="w-4 h-4 text-red-600" />
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="border-2 border-orange-300">
      <CardHeader className="pb-3 bg-orange-50">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="w-5 h-5 text-orange-600" />
          Real-Time Risk Assessment
          {riskScore && (
            <Badge className={`ml-auto ${getRiskColor(riskScore.overall_risk_level)}`}>
              {riskScore.overall_risk_level?.toUpperCase()}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {ai.loading && (
          <Alert className="bg-blue-50 border-blue-300">
            <Activity className="w-4 h-4 text-blue-600 animate-pulse" />
            <AlertDescription className="text-blue-900">
              Analyzing {recentVisits.length} visits, {clinicalEvents.length} events, and current health status...
            </AlertDescription>
          </Alert>
        )}

        {riskScore && (
          <>
            {/* Overall Score */}
            <div className="text-center p-4 bg-gradient-to-br from-orange-50 to-red-50 rounded-lg border-2 border-orange-300">
              <p className="text-sm font-medium text-slate-600 mb-1">Overall Composite Risk</p>
              <div className="flex items-center justify-center gap-3">
                <div className="text-4xl font-bold text-orange-600">
                  {Math.round(riskScore.overall_risk_score)}
                </div>
                {riskScore.trend && (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <TrendingUp className={`w-3 h-3 ${riskScore.trend === 'increasing' ? 'text-red-600' : 'text-green-600'}`} />
                    {riskScore.trend}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-1">Last updated: Just now</p>
            </div>

            {/* Risk Categories */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">Risk Breakdown:</p>
              {riskScore.risk_categories?.map((category) => {
                const Icon = getRiskIcon(category.category);
                return (
                  <Card key={category.category} className="border hover:border-orange-300 transition-colors">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-slate-600" />
                          <span className="font-medium text-sm">{category.category}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={getRiskColor(category.level)}>
                            {Math.round(category.score)}
                          </Badge>
                          {category.urgency === 'immediate' && (
                            <AlertTriangle className="w-4 h-4 text-red-600" />
                          )}
                        </div>
                      </div>
                      
                      {category.factors && category.factors.length > 0 && (
                        <div className="text-xs text-slate-600 mb-1">
                          <strong>Factors:</strong> {category.factors.slice(0, 2).join(', ')}
                          {category.factors.length > 2 && ` +${category.factors.length - 2} more`}
                        </div>
                      )}
                      
                      {category.interventions && category.interventions.length > 0 && (
                        <div className="text-xs text-blue-700 bg-blue-50 p-2 rounded mt-1">
                          <strong>Recommended:</strong> {category.interventions[0]}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Priority Actions */}
            {riskScore.priority_actions && riskScore.priority_actions.length > 0 && (
              <Alert className="bg-red-50 border-red-300">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription>
                  <strong className="text-red-900">Priority Actions Required:</strong>
                  <ul className="list-disc list-inside mt-2 text-sm text-red-800 space-y-1">
                    {riskScore.priority_actions.map((action, i) => (
                      <li key={i}>{action}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}