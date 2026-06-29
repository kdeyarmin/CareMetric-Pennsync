import { useState, useMemo } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Brain, Activity, AlertTriangle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from 'sonner';

export default function DiseaseProgressionPredictor({ patients, visits }) {
  const ai = useAICall();
  const [progressionData, setProgressionData] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);

  // Identify patients with deteriorating trends
  const patientsAtRisk = useMemo(() => {
    return patients.filter(p => p.status === "active").map(patient => {
      const patientVisits = visits
        .filter(v => v.patient_id === patient.id && v.vital_signs)
        .sort((a, b) => new Date(a.visit_date) - new Date(b.visit_date));

      if (patientVisits.length < 2) return null;

      const deteriorationScore = calculateDeteriorationScore(patientVisits);
      
      return {
        patient,
        visits: patientVisits,
        deteriorationScore,
        trend: deteriorationScore > 50 ? "declining" : deteriorationScore > 25 ? "stable-concern" : "stable",
        indicators: identifyDeteriorationIndicators(patientVisits)
      };
    }).filter(p => p && p.deteriorationScore > 0)
      .sort((a, b) => b.deteriorationScore - a.deteriorationScore);
  }, [patients, visits]);

  const calculateDeteriorationScore = (visits) => {
    if (visits.length < 2) return 0;
    
    let score = 0;
    const recent = visits.slice(-3);
    const older = visits.slice(-6, -3);

    // Blood pressure trend
    const recentBP = recent.filter(v => v.vital_signs?.blood_pressure_systolic).map(v => v.vital_signs.blood_pressure_systolic);
    const olderBP = older.filter(v => v.vital_signs?.blood_pressure_systolic).map(v => v.vital_signs.blood_pressure_systolic);
    if (recentBP.length && olderBP.length) {
      const recentAvg = recentBP.reduce((a, b) => a + b, 0) / recentBP.length;
      const olderAvg = olderBP.reduce((a, b) => a + b, 0) / olderBP.length;
      if (recentAvg > olderAvg + 15 || recentAvg < olderAvg - 15) score += 20;
    }

    // Oxygen saturation trend
    const recentO2 = recent.filter(v => v.vital_signs?.oxygen_saturation).map(v => v.vital_signs.oxygen_saturation);
    const olderO2 = older.filter(v => v.vital_signs?.oxygen_saturation).map(v => v.vital_signs.oxygen_saturation);
    if (recentO2.length && olderO2.length) {
      const recentAvg = recentO2.reduce((a, b) => a + b, 0) / recentO2.length;
      const olderAvg = olderO2.reduce((a, b) => a + b, 0) / olderO2.length;
      if (recentAvg < olderAvg - 2) score += 25;
    }

    // Weight trend
    const recentWeight = recent.filter(v => v.vital_signs?.weight).map(v => v.vital_signs.weight);
    const olderWeight = older.filter(v => v.vital_signs?.weight).map(v => v.vital_signs.weight);
    if (recentWeight.length && olderWeight.length) {
      const recentAvg = recentWeight.reduce((a, b) => a + b, 0) / recentWeight.length;
      const olderAvg = olderWeight.reduce((a, b) => a + b, 0) / olderWeight.length;
      const change = Math.abs(recentAvg - olderAvg);
      if (change > 5) score += 15;
    }

    // Pain level trend
    const recentPain = recent.filter(v => v.vital_signs?.pain_level).map(v => v.vital_signs.pain_level);
    if (recentPain.length) {
      const avgPain = recentPain.reduce((a, b) => a + b, 0) / recentPain.length;
      if (avgPain > 5) score += 20;
    }

    return Math.min(score, 100);
  };

  const identifyDeteriorationIndicators = (visits) => {
    const indicators = [];
    const recent = visits.slice(-3);

    recent.forEach(v => {
      if (v.vital_signs?.oxygen_saturation && v.vital_signs.oxygen_saturation < 92) {
        indicators.push("Low oxygen saturation");
      }
      if (v.vital_signs?.blood_pressure_systolic && (v.vital_signs.blood_pressure_systolic > 160 || v.vital_signs.blood_pressure_systolic < 90)) {
        indicators.push("Blood pressure instability");
      }
      if (v.vital_signs?.pain_level && v.vital_signs.pain_level >= 7) {
        indicators.push("Severe pain reported");
      }
    });

    return [...new Set(indicators)];
  };

  const generateProgressionPrediction = async (patientData) => {
    setSelectedPatient(patientData);

    try {
      const vitalsTrend = patientData.visits.slice(-10).map(v => ({
        date: format(new Date(v.visit_date), 'MMM dd'),
        bp: v.vital_signs?.blood_pressure_systolic || null,
        o2: v.vital_signs?.oxygen_saturation || null,
        weight: v.vital_signs?.weight || null,
        pain: v.vital_signs?.pain_level || null
      }));

      const prompt = `Analyze this patient's disease progression and predict the next 30 days:

Patient: ${patientData.patient.first_name} ${patientData.patient.last_name}
Primary Diagnosis: ${patientData.patient.primary_diagnosis}
Deterioration Score: ${patientData.deteriorationScore}/100
Current Trend: ${patientData.trend}
Warning Signs: ${patientData.indicators.join(", ")}

Recent Vital Signs Trend:
${vitalsTrend.map(v => `${v.date}: BP=${v.bp || "N/A"}, O2=${v.o2 || "N/A"}%, Weight=${v.weight || "N/A"}lbs, Pain=${v.pain || "N/A"}/10`).join("\n")}

Provide:
1. Predicted trajectory (improving, stable, declining, critical)
2. Expected complications in next 30 days
3. Recommended clinical interventions
4. Monitoring frequency recommendation
5. Care plan adjustments needed`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            trajectory: { type: "string" },
            expected_complications: { type: "array", items: { type: "string" } },
            interventions: { type: "array", items: { type: "string" } },
            monitoring_frequency: { type: "string" },
            care_plan_adjustments: { type: "array", items: { type: "string" } }
          }
        }
      });

      setProgressionData(result);
    } catch (error) {
      console.error("Progression prediction error:", error);
      toast.error("Failed to generate prediction");
    }

  };

  const getTrendColor = (trend) => {
    switch (trend) {
      case "declining": return "text-red-600 bg-red-50";
      case "stable-concern": return "text-yellow-600 bg-yellow-50";
      default: return "text-green-600 bg-green-50";
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-navy-600" />
            Disease Progression Monitoring
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 mb-4">
            AI-powered analysis of patient vital signs trends to predict disease progression and identify intervention opportunities.
          </p>
          <div className="space-y-3">
            {patientsAtRisk.slice(0, 10).map((data, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border ${getTrendColor(data.trend)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-semibold">
                        {data.patient.first_name} {data.patient.last_name}
                      </h4>
                      <Badge className={data.trend === "declining" ? "bg-red-500" : data.trend === "stable-concern" ? "bg-yellow-500" : "bg-green-500"}>
                        {data.trend.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm mb-2">
                      <strong>Diagnosis:</strong> {data.patient.primary_diagnosis}
                    </p>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-sm font-medium">Deterioration Score:</span>
                      <Progress value={data.deteriorationScore} className="w-32" />
                      <span className="text-sm font-bold">{data.deteriorationScore}</span>
                    </div>
                    {data.indicators.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {data.indicators.map((indicator, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {indicator}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={() => generateProgressionPrediction(data)}
                    disabled={ai.loading}
                    size="sm"
                    className="bg-navy-600 hover:bg-navy-700"
                  >
                    {ai.loading && selectedPatient?.patient.id === data.patient.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Brain className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI Prediction Results */}
      {progressionData && selectedPatient && (
        <Card className="border-navy-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-navy-600" />
              30-Day Progression Prediction
            </CardTitle>
            <p className="text-sm text-slate-600">
              {selectedPatient.patient.first_name} {selectedPatient.patient.last_name} - {selectedPatient.patient.primary_diagnosis}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className={
              progressionData.trajectory === "critical" ? "border-red-300 bg-red-50" :
              progressionData.trajectory === "declining" ? "border-yellow-300 bg-yellow-50" :
              "border-blue-300 bg-blue-50"
            }>
              <AlertDescription>
                <div className="flex items-center gap-2 mb-2">
                  {progressionData.trajectory === "improving" && <TrendingUp className="w-5 h-5 text-green-600" />}
                  {progressionData.trajectory === "declining" && <TrendingDown className="w-5 h-5 text-red-600" />}
                  <h4 className="font-semibold">Predicted Trajectory: {progressionData.trajectory}</h4>
                </div>
              </AlertDescription>
            </Alert>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-semibold mb-2">Expected Complications:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {progressionData.expected_complications?.map((comp, i) => (
                    <li key={i} className="text-slate-700">{comp}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Monitoring Frequency:</h4>
                <p className="text-sm text-slate-700">{progressionData.monitoring_frequency}</p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Recommended Interventions:</h4>
              <div className="space-y-2">
                {progressionData.interventions?.map((intervention, i) => (
                  <div key={i} className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-sm text-slate-700">{intervention}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Care Plan Adjustments:</h4>
              <div className="space-y-2">
                {progressionData.care_plan_adjustments?.map((adjustment, i) => (
                  <div key={i} className="p-3 bg-navy-50 rounded-lg border border-navy-200">
                    <p className="text-sm text-slate-700">{adjustment}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Vitals Trend Chart */}
            <div>
              <h4 className="font-semibold mb-2">Historical Vital Signs Trend:</h4>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={selectedPatient.visits.slice(-10).map(v => ({
                  date: format(new Date(v.visit_date), 'MM/dd'),
                  bp: v.vital_signs?.blood_pressure_systolic || null,
                  o2: v.vital_signs?.oxygen_saturation || null
                }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="bp" stroke="#3557b0" name="Blood Pressure" />
                  <Line yAxisId="right" type="monotone" dataKey="o2" stroke="#10b981" name="O2 Saturation" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}