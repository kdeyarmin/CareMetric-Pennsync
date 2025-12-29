import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Brain, AlertTriangle, TrendingUp, Activity, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AIHealthRiskPredictor({ patientId, onRiskAssessed }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [selectedPatientId, setSelectedPatientId] = useState(patientId || "");

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list()
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', selectedPatientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidents', selectedPatientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId
  });

  const patient = patients.find(p => p.id === selectedPatientId);

  const analyzeRisks = async () => {
    if (!patient) return;

    setAnalyzing(true);
    try {
      const recentVisits = visits.slice(0, 15);
      const recentIncidents = incidents.slice(0, 10);
      
      const vitalTrends = recentVisits.map(v => v.vital_signs).filter(Boolean);
      
      const prompt = `Analyze health risks for this patient and provide risk scores:

Patient Profile:
- Age: ${patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Medications: ${patient.current_medications?.length || 0} current
- Functional Status: ${patient.functional_status?.ambulation || 'Unknown'}, ${patient.functional_status?.adl_independence || 'Unknown'}
- Fall Risk: ${patient.functional_status?.fall_risk || 'Unknown'}
- Cognitive Status: ${patient.functional_status?.cognitive_status || 'Unknown'}

Recent Vital Trends (${vitalTrends.length} readings):
${vitalTrends.slice(0, 5).map((v, i) => `Reading ${i+1}: BP ${v.blood_pressure_systolic || 'N/A'}/${v.blood_pressure_diastolic || 'N/A'}, HR ${v.heart_rate || 'N/A'}, O2 ${v.oxygen_saturation || 'N/A'}%`).join('\n')}

Recent Incidents (${recentIncidents.length}):
${recentIncidents.map(i => `- ${i.incident_type} on ${i.incident_date}: ${i.severity} severity`).join('\n')}

Past Hospitalizations: ${patient.past_hospitalizations?.length || 0}
Wounds: ${patient.wounds?.length || 0} active

Provide a comprehensive risk assessment with scores (0-100) for:
1. Readmission Risk
2. Fall Risk
3. Deterioration Risk
4. Medication Compliance Risk
5. Infection Risk

For each risk, provide:
- Risk score (0-100)
- Risk level (low/medium/high/critical)
- Contributing factors
- Recommended interventions`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_level: { type: "string" },
            risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  score: { type: "number" },
                  level: { type: "string" },
                  factors: { type: "array", items: { type: "string" } },
                  interventions: { type: "array", items: { type: "string" } }
                }
              }
            },
            priority_actions: { type: "array", items: { type: "string" } }
          }
        }
      });

      setRiskAssessment(result);
      if (onRiskAssessed) {
        onRiskAssessed(result);
      }
      toast.success("Risk assessment completed");
    } catch (error) {
      console.error('Error analyzing risks:', error);
      toast.error("Failed to analyze risks");
    }
    setAnalyzing(false);
  };

  const getRiskColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'low': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'critical': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getProgressColor = (score) => {
    if (score < 30) return 'bg-green-600';
    if (score < 60) return 'bg-yellow-600';
    if (score < 80) return 'bg-orange-600';
    return 'bg-red-600';
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-600" />
            AI Health Risk Predictor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Select Patient</label>
            <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a patient" />
              </SelectTrigger>
              <SelectContent>
                {patients.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.first_name} {p.last_name} - {p.primary_diagnosis || 'No diagnosis'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button 
            onClick={analyzeRisks} 
            disabled={!selectedPatientId || analyzing}
            className="w-full"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Risks...
              </>
            ) : (
              <>
                <Activity className="w-4 h-4 mr-2" />
                Analyze Health Risks
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {riskAssessment && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                Risk Assessment Results
              </CardTitle>
              <Badge className={getRiskColor(riskAssessment.overall_risk_level)}>
                {riskAssessment.overall_risk_level} Risk Overall
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {riskAssessment.risks?.map((risk, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">{risk.category}</h4>
                  <Badge className={getRiskColor(risk.level)}>
                    {risk.level} ({risk.score}/100)
                  </Badge>
                </div>
                
                <Progress value={risk.score} className="h-2">
                  <div className={`h-full ${getProgressColor(risk.score)}`} style={{ width: `${risk.score}%` }} />
                </Progress>

                <div className="mt-2">
                  <p className="text-xs font-medium text-gray-600 mb-1">Contributing Factors:</p>
                  <ul className="space-y-1">
                    {risk.factors?.map((factor, fIdx) => (
                      <li key={fIdx} className="text-xs text-gray-700 flex items-start gap-1">
                        <span>•</span>
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-2 bg-blue-50 p-2 rounded">
                  <p className="text-xs font-medium text-blue-900 mb-1">Recommended Interventions:</p>
                  <ul className="space-y-1">
                    {risk.interventions?.map((intervention, iIdx) => (
                      <li key={iIdx} className="text-xs text-blue-800 flex items-start gap-1">
                        <span>→</span>
                        <span>{intervention}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}

            {riskAssessment.priority_actions?.length > 0 && (
              <div className="border-t pt-4">
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-red-600" />
                  Priority Actions
                </h4>
                <ul className="space-y-2">
                  {riskAssessment.priority_actions.map((action, idx) => (
                    <li key={idx} className="text-sm bg-red-50 p-2 rounded flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <span className="text-red-900">{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}