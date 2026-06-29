import { useState, useMemo } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Loader2
} from "lucide-react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from "recharts";

export default function TherapyNeedForecaster({ 
  patients = [], 
  oasisData = [], 
  visits = [],
  selectedPatientId = ''
}) {
  const [forecasts, setForecasts] = useState({});
  const ai = useAICall();
  const [forecastingPatientId, setForecastingPatientId] = useState(null);

  // Calculate therapy need indicators
  const therapyIndicators = useMemo(() => {
    return patients.map(patient => {
      const patientOASIS = oasisData.filter(o => o.patient_id === patient.id);
      const latestOASIS = patientOASIS[0];
      
      const indicators = {
        pt: { need: 0, reason: [] },
        ot: { need: 0, reason: [] },
        slp: { need: 0, reason: [] }
      };

      if (latestOASIS?.pdgm_data) {
        const fs = latestOASIS.pdgm_data.functional_scores || {};
        const dx = (latestOASIS.pdgm_data.primary_diagnosis || '').toLowerCase();

        // PT indicators
        if ((fs.m1860_ambulation || 0) >= 3) {
          indicators.pt.need += 40;
          indicators.pt.reason.push('Impaired ambulation');
        }
        if ((fs.m1850_transferring || 0) >= 3) {
          indicators.pt.need += 30;
          indicators.pt.reason.push('Transfer difficulties');
        }
        if (dx.includes('fall') || dx.includes('fracture') || dx.includes('joint')) {
          indicators.pt.need += 25;
          indicators.pt.reason.push('Fall/orthopedic diagnosis');
        }

        // OT indicators
        if ((fs.m1830_bathing || 0) >= 3) {
          indicators.ot.need += 35;
          indicators.ot.reason.push('Bathing assistance needed');
        }
        if ((fs.m1810_dress_upper || 0) >= 2 || (fs.m1820_dress_lower || 0) >= 2) {
          indicators.ot.need += 30;
          indicators.ot.reason.push('Dressing difficulties');
        }
        if (dx.includes('stroke') || dx.includes('cva')) {
          indicators.ot.need += 30;
          indicators.ot.reason.push('Stroke diagnosis');
        }

        // SLP indicators
        if (dx.includes('stroke') || dx.includes('dysphagia') || dx.includes('speech')) {
          indicators.slp.need += 50;
          indicators.slp.reason.push('Speech/swallow diagnosis');
        }
        if (dx.includes('dementia') || dx.includes('alzheimer')) {
          indicators.slp.need += 30;
          indicators.slp.reason.push('Cognitive diagnosis');
        }
      }

      // Cap at 100
      Object.keys(indicators).forEach(key => {
        indicators[key].need = Math.min(100, indicators[key].need);
      });

      return {
        ...patient,
        indicators,
        totalNeed: indicators.pt.need + indicators.ot.need + indicators.slp.need,
        forecast: forecasts[patient.id]
      };
    }).sort((a, b) => b.totalNeed - a.totalNeed);
  }, [patients, oasisData, forecasts]);

  // Get AI forecast for patient
  const getForecast = async (patientId) => {
    setForecastingPatientId(patientId);

    const patient = patients.find(p => p.id === patientId);
    const patientOASIS = oasisData.filter(o => o.patient_id === patientId);
    const patientVisits = visits.filter(v => v.patient_id === patientId);

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Analyze this patient's therapy needs and forecast required therapy services.

PATIENT: ${patient?.first_name} ${patient?.last_name}
PRIMARY DIAGNOSIS: ${patient?.primary_diagnosis || 'Not specified'}
SECONDARY DIAGNOSES: ${patient?.secondary_diagnoses?.join(', ') || 'None'}

OASIS FUNCTIONAL DATA:
${patientOASIS[0] ? JSON.stringify(patientOASIS[0].pdgm_data?.functional_scores, null, 2) : 'No OASIS data'}

RECENT VISITS: ${patientVisits.length} total
${patientVisits.filter(v => v.visit_type?.includes('therapy')).slice(0, 5).map(v => `- ${v.visit_date}: ${v.visit_type}`).join('\n') || 'No therapy visits recorded'}

Provide therapy need forecast including:
1. PT, OT, SLP need probability and recommended frequency
2. Expected functional improvement trajectory
3. Specific therapy goals
4. Timeline predictions`,
        response_json_schema: {
          type: "object",
          properties: {
            therapy_needs: {
              type: "object",
              properties: {
                pt: {
                  type: "object",
                  properties: {
                    recommended: { type: "boolean" },
                    probability: { type: "number" },
                    frequency: { type: "string" },
                    duration_weeks: { type: "number" },
                    goals: { type: "array", items: { type: "string" } }
                  }
                },
                ot: {
                  type: "object",
                  properties: {
                    recommended: { type: "boolean" },
                    probability: { type: "number" },
                    frequency: { type: "string" },
                    duration_weeks: { type: "number" },
                    goals: { type: "array", items: { type: "string" } }
                  }
                },
                slp: {
                  type: "object",
                  properties: {
                    recommended: { type: "boolean" },
                    probability: { type: "number" },
                    frequency: { type: "string" },
                    duration_weeks: { type: "number" },
                    goals: { type: "array", items: { type: "string" } }
                  }
                }
              }
            },
            functional_trajectory: {
              type: "object",
              properties: {
                current_level: { type: "string" },
                expected_improvement: { type: "string" },
                timeline: { type: "string" },
                confidence: { type: "number" }
              }
            },
            risk_without_therapy: { type: "string" },
            recommendations: { type: "array", items: { type: "string" } }
          }
        }
      });

      setForecasts(prev => ({ ...prev, [patientId]: result }));
    } catch (error) {
      console.error("Forecast error:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

    setForecastingPatientId(null);
  };

  // Aggregate therapy need distribution
  const therapyDistribution = useMemo(() => {
    const dist = { pt: 0, ot: 0, slp: 0 };
    therapyIndicators.forEach(p => {
      if (p.indicators.pt.need >= 50) dist.pt++;
      if (p.indicators.ot.need >= 50) dist.ot++;
      if (p.indicators.slp.need >= 50) dist.slp++;
    });
    return [
      { therapy: 'PT', count: dist.pt, full: 'Physical Therapy' },
      { therapy: 'OT', count: dist.ot, full: 'Occupational Therapy' },
      { therapy: 'SLP', count: dist.slp, full: 'Speech Therapy' }
    ];
  }, [therapyIndicators]);

  const displayPatients = selectedPatientId 
    ? therapyIndicators.filter(p => p.id === selectedPatientId)
    : therapyIndicators.slice(0, 12);

  const selectedForecast = selectedPatientId ? forecasts[selectedPatientId] : null;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Therapy Need Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={therapyDistribution}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="therapy" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value, name, props) => [value, props.payload.full]} />
                <Bar dataKey="count" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-slate-500 text-center mt-2">
              Patients with ≥50% therapy need indicator
            </p>
          </CardContent>
        </Card>

        {/* Selected Patient Radar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {selectedPatientId 
                ? `${displayPatients[0]?.first_name}'s Therapy Profile`
                : 'Select Patient for Detail'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {displayPatients[0] && (
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={[
                  { subject: 'PT', value: displayPatients[0].indicators.pt.need },
                  { subject: 'OT', value: displayPatients[0].indicators.ot.need },
                  { subject: 'SLP', value: displayPatients[0].indicators.slp.need }
                ]}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Radar dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.4} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Patient List */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Patients Therapy Need Indicators</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {displayPatients.map(patient => (
              <div key={patient.id} className="p-3 bg-slate-50 rounded-lg border">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium text-sm">{patient.first_name} {patient.last_name}</p>
                  <Badge variant="outline">{patient.primary_diagnosis?.slice(0, 20) || 'No dx'}</Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="text-center p-2 bg-blue-50 rounded">
                    <p className="text-lg font-bold text-blue-700">{patient.indicators.pt.need}%</p>
                    <p className="text-xs text-blue-600">PT</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded">
                    <p className="text-lg font-bold text-green-700">{patient.indicators.ot.need}%</p>
                    <p className="text-xs text-green-600">OT</p>
                  </div>
                  <div className="text-center p-2 bg-navy-50 rounded">
                    <p className="text-lg font-bold text-navy-700">{patient.indicators.slp.need}%</p>
                    <p className="text-xs text-navy-600">SLP</p>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => getForecast(patient.id)}
                  disabled={ai.loading && forecastingPatientId === patient.id}
                >
                  {ai.loading && forecastingPatientId === patient.id ? (
                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Forecasting...</>
                  ) : (
                    <><TrendingUp className="w-3 h-3 mr-1" /> Get AI Forecast</>
                  )}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Forecast Details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-navy-600" />
              AI Therapy Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedForecast ? (
              <div className="space-y-4">
                {/* Therapy Recommendations */}
                {['pt', 'ot', 'slp'].map(type => {
                  const therapy = selectedForecast.therapy_needs?.[type];
                  if (!therapy?.recommended) return null;
                  return (
                    <div key={type} className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium uppercase">{type}</span>
                        <Badge className="bg-blue-600 text-white">{therapy.probability}% recommended</Badge>
                      </div>
                      <p className="text-sm text-slate-700">
                        <strong>Frequency:</strong> {therapy.frequency} for {therapy.duration_weeks} weeks
                      </p>
                      {therapy.goals?.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-slate-600 font-medium">Goals:</p>
                          <ul className="text-xs text-slate-600 list-disc list-inside">
                            {therapy.goals.slice(0, 3).map((g, i) => <li key={i}>{g}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Trajectory */}
                {selectedForecast.functional_trajectory && (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <p className="font-medium text-green-800 mb-1">Functional Trajectory</p>
                    <p className="text-sm text-green-700">
                      {selectedForecast.functional_trajectory.current_level} → {selectedForecast.functional_trajectory.expected_improvement}
                    </p>
                    <p className="text-xs text-green-600">
                      Timeline: {selectedForecast.functional_trajectory.timeline} 
                      (Confidence: {selectedForecast.functional_trajectory.confidence}%)
                    </p>
                  </div>
                )}

                {/* Risk without therapy */}
                {selectedForecast.risk_without_therapy && (
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-sm text-red-800">
                      <strong>Risk without therapy:</strong> {selectedForecast.risk_without_therapy}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500">
                <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Click "Get AI Forecast" on a patient for detailed therapy predictions</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}