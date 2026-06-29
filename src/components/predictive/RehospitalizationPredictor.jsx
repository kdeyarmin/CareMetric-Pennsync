import { useState, useMemo } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  Activity,
  Loader2,
  RefreshCw
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";

export default function RehospitalizationPredictor({ 
  patients = [], 
  oasisData = [], 
  visits = [],
  selectedPatientId = '',
  riskFilter = 'all'
}) {
  const [predictions, setPredictions] = useState({});
  const ai = useAICall();
  const [analyzingPatientId, setAnalyzingPatientId] = useState(null);

  // Calculate base risk for all patients
  const patientRisks = useMemo(() => {
    return patients.map(patient => {
      const patientOASIS = oasisData.filter(o => o.patient_id === patient.id);
      const patientVisits = visits.filter(v => v.patient_id === patient.id);
      const latestOASIS = patientOASIS[0];
      
      let baseRisk = 15; // Baseline
      const factors = [];

      if (latestOASIS?.pdgm_data) {
        const pdgm = latestOASIS.pdgm_data;
        const fs = pdgm.functional_scores || {};

        // Admission source - major factor
        if (pdgm.admission_source === 'institutional') {
          baseRisk += 25;
          factors.push({ factor: 'Recent hospitalization/SNF stay', impact: 25 });
        }

        // Functional impairment
        const totalFunctional = (fs.m1860_ambulation || 0) + (fs.m1850_transferring || 0) + (fs.m1830_bathing || 0);
        if (totalFunctional >= 12) {
          baseRisk += 20;
          factors.push({ factor: 'Severe functional impairment', impact: 20 });
        } else if (totalFunctional >= 8) {
          baseRisk += 12;
          factors.push({ factor: 'Moderate functional impairment', impact: 12 });
        }

        // Diagnosis-based risk
        const dx = (pdgm.primary_diagnosis || '').toLowerCase();
        if (dx.includes('heart failure') || dx.includes('chf')) {
          baseRisk += 18;
          factors.push({ factor: 'CHF/Heart Failure', impact: 18 });
        }
        if (dx.includes('copd') || dx.includes('respiratory')) {
          baseRisk += 15;
          factors.push({ factor: 'COPD/Respiratory condition', impact: 15 });
        }
        if (dx.includes('diabetes') && dx.includes('complication')) {
          baseRisk += 12;
          factors.push({ factor: 'Diabetes with complications', impact: 12 });
        }

        // Comorbidity burden
        const comorbidities = pdgm.comorbidities?.length || 0;
        if (comorbidities >= 5) {
          baseRisk += 15;
          factors.push({ factor: 'Multiple comorbidities (5+)', impact: 15 });
        } else if (comorbidities >= 3) {
          baseRisk += 8;
          factors.push({ factor: 'Multiple comorbidities', impact: 8 });
        }
      }

      // Visit adherence
      const scheduledVisits = patientVisits.filter(v => v.status === 'scheduled').length;
      const completedVisits = patientVisits.filter(v => v.status === 'completed').length;
      if (completedVisits < scheduledVisits * 0.7) {
        baseRisk += 10;
        factors.push({ factor: 'Low visit adherence', impact: 10 });
      }

      const riskLevel = baseRisk >= 50 ? 'high' : baseRisk >= 30 ? 'medium' : 'low';

      return {
        ...patient,
        rehospRisk: Math.min(95, baseRisk),
        riskLevel,
        riskFactors: factors.sort((a, b) => b.impact - a.impact),
        latestOASIS,
        prediction: predictions[patient.id]
      };
    }).filter(p => riskFilter === 'all' || p.riskLevel === riskFilter);
  }, [patients, oasisData, visits, predictions, riskFilter]);

  // Get AI prediction for specific patient
  const analyzePatient = async (patientId) => {
    setAnalyzingPatientId(patientId);

    const patient = patients.find(p => p.id === patientId);
    const patientOASIS = oasisData.filter(o => o.patient_id === patientId);
    const patientVisits = visits.filter(v => v.patient_id === patientId);

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Analyze this home health patient's rehospitalization risk and provide predictions with preventive recommendations.

PATIENT: ${patient?.first_name} ${patient?.last_name}
PRIMARY DIAGNOSIS: ${patient?.primary_diagnosis || 'Not specified'}
SECONDARY DIAGNOSES: ${patient?.secondary_diagnoses?.join(', ') || 'None documented'}

LATEST OASIS DATA:
${patientOASIS[0] ? JSON.stringify(patientOASIS[0].pdgm_data, null, 2) : 'No OASIS data'}

RECENT VISITS: ${patientVisits.length} total visits
${patientVisits.slice(0, 5).map(v => `- ${v.visit_date}: ${v.visit_type} (${v.status})`).join('\n')}

Provide a comprehensive rehospitalization risk assessment with:
1. 30-day and 60-day risk probabilities
2. Key risk factors with confidence levels
3. Specific preventive interventions
4. Monitoring recommendations`,
        response_json_schema: {
          type: "object",
          properties: {
            risk_30day: { type: "number", description: "30-day rehospitalization probability 0-100" },
            risk_60day: { type: "number", description: "60-day rehospitalization probability 0-100" },
            confidence: { type: "number", description: "Confidence in prediction 0-100" },
            risk_category: { type: "string", enum: ["low", "moderate", "high", "critical"] },
            key_factors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  factor: { type: "string" },
                  severity: { type: "string", enum: ["high", "medium", "low"] },
                  contribution: { type: "number" }
                }
              }
            },
            preventive_actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
                  timeframe: { type: "string" },
                  expected_impact: { type: "string" }
                }
              }
            },
            monitoring_recommendations: {
              type: "array",
              items: { type: "string" }
            },
            clinical_alerts: {
              type: "array",
              items: { type: "string" }
            },
            summary: { type: "string" }
          }
        }
      });

      setPredictions(prev => ({ ...prev, [patientId]: result }));
    } catch (error) {
      console.error("Analysis error:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

    setAnalyzingPatientId(null);
  };

  // Current risk distribution (REAL counts). This replaces a prior chart that
  // fabricated an 8-week "trend" by multiplying the current counts by
  // Math.random() — there is no historical risk time-series available, so a
  // trend line would be invented data. We show the honest current snapshot
  // instead (see docs/AI_TRUSTWORTHINESS_AUDIT.md — no fabricated metrics).
  const riskDistribution = useMemo(() => {
    const counts = { High: 0, Medium: 0, Low: 0 };
    for (const p of patientRisks) {
      if (p.riskLevel === 'high') counts.High += 1;
      else if (p.riskLevel === 'medium') counts.Medium += 1;
      else counts.Low += 1;
    }
    return [
      { level: 'High', count: counts.High },
      { level: 'Medium', count: counts.Medium },
      { level: 'Low', count: counts.Low },
    ];
  }, [patientRisks]);

  const selectedPrediction = selectedPatientId ? predictions[selectedPatientId] : null;
  const displayPatients = selectedPatientId 
    ? patientRisks.filter(p => p.id === selectedPatientId)
    : patientRisks.sort((a, b) => b.rehospRisk - a.rehospRisk).slice(0, 15);

  return (
    <div className="space-y-6">
      {/* Current risk distribution (real counts, not a fabricated trend) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            Current Rehospitalization Risk Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={riskDistribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="level" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Patients" fill="#264491" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Patient List */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Patients at Risk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {displayPatients.map(patient => (
              <div 
                key={patient.id}
                className={`p-3 rounded-lg border ${
                  patient.riskLevel === 'high' ? 'bg-red-50 border-red-200' :
                  patient.riskLevel === 'medium' ? 'bg-yellow-50 border-yellow-200' :
                  'bg-green-50 border-green-200'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">{patient.first_name} {patient.last_name}</p>
                    <p className="text-xs text-slate-600">{patient.primary_diagnosis || 'No diagnosis'}</p>
                  </div>
                  <Badge className={`${
                    patient.riskLevel === 'high' ? 'bg-red-600' :
                    patient.riskLevel === 'medium' ? 'bg-yellow-600' : 'bg-green-600'
                  } text-white`}>
                    {patient.rehospRisk}% Risk
                  </Badge>
                </div>

                <div className="mb-2">
                  <Progress value={patient.rehospRisk} className="h-2" />
                </div>

                <div className="flex flex-wrap gap-1 mb-2">
                  {patient.riskFactors.slice(0, 3).map((f, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {f.factor}
                    </Badge>
                  ))}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => analyzePatient(patient.id)}
                  disabled={ai.loading && analyzingPatientId === patient.id}
                >
                  {ai.loading && analyzingPatientId === patient.id ? (
                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Analyzing...</>
                  ) : patient.prediction ? (
                    <><RefreshCw className="w-3 h-3 mr-1" /> Refresh AI Analysis</>
                  ) : (
                    <><Activity className="w-3 h-3 mr-1" /> Get AI Prediction</>
                  )}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* AI Prediction Details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-navy-600" />
              AI Prediction Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedPrediction ? (
              <div className="space-y-4">
                {/* Risk Scores */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-center">
                    <p className="text-2xl font-bold text-red-700">{selectedPrediction.risk_30day}%</p>
                    <p className="text-xs text-red-600">30-Day Risk</p>
                  </div>
                  <div className="p-3 bg-orange-50 rounded-lg border border-orange-200 text-center">
                    <p className="text-2xl font-bold text-orange-700">{selectedPrediction.risk_60day}%</p>
                    <p className="text-xs text-orange-600">60-Day Risk</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2 bg-slate-50 rounded">
                  <span className="text-sm">AI Confidence</span>
                  <Badge variant="outline">{selectedPrediction.confidence}%</Badge>
                </div>

                <p className="text-sm text-slate-700">{selectedPrediction.summary}</p>

                {/* Preventive Actions */}
                <div>
                  <p className="text-sm font-medium mb-2">Preventive Actions</p>
                  <div className="space-y-2">
                    {selectedPrediction.preventive_actions?.slice(0, 4).map((action, idx) => (
                      <div key={idx} className="p-2 bg-blue-50 rounded border border-blue-200">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{action.action}</span>
                          <Badge className={`text-xs ${
                            action.priority === 'urgent' ? 'bg-red-600' :
                            action.priority === 'high' ? 'bg-orange-600' : 'bg-blue-600'
                          } text-white`}>
                            {action.priority}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-600">{action.timeframe}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Clinical Alerts */}
                {selectedPrediction.clinical_alerts?.length > 0 && (
                  <Alert className="bg-yellow-50 border-yellow-200">
                    <AlertTriangle className="w-4 h-4 text-yellow-600" />
                    <AlertDescription>
                      <ul className="text-sm space-y-1">
                        {selectedPrediction.clinical_alerts.map((alert, idx) => (
                          <li key={idx}>• {alert}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500">
                <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a patient and click "Get AI Prediction" for detailed analysis</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}