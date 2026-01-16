import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Heart,
  Thermometer,
  Wind,
  Droplets,
  TrendingUp,
  TrendingDown,
  Minus,
  Pill,
  AlertCircle,
  CheckCircle2,
  Brain,
  Loader2
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { format, subDays } from "date-fns";
import { toast } from "sonner";

export default function HealthMetricsDashboard({ patient, visits = [] }) {
  const [generatingAISummary, setGeneratingAISummary] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);

  // Get recent visits (last 30 days)
  const recentVisits = visits
    .filter(v => v.status === "completed" && v.visit_date)
    .filter(v => {
      const visitDate = new Date(v.visit_date);
      const thirtyDaysAgo = subDays(new Date(), 30);
      return visitDate >= thirtyDaysAgo;
    })
    .sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));

  // Get latest vitals
  const latestVitals = recentVisits[0]?.vital_signs || patient?.baseline_vitals || {};

  // Calculate vital trends (compare latest to average of previous 3)
  const calculateTrend = (vitalName) => {
    if (recentVisits.length < 2) return "stable";
    
    const latest = recentVisits[0]?.vital_signs?.[vitalName];
    const previous = recentVisits.slice(1, 4)
      .map(v => v.vital_signs?.[vitalName])
      .filter(Boolean);

    if (!latest || previous.length === 0) return "stable";

    const avg = previous.reduce((sum, val) => sum + val, 0) / previous.length;
    const percentChange = ((latest - avg) / avg) * 100;

    if (Math.abs(percentChange) < 5) return "stable";
    return percentChange > 0 ? "up" : "down";
  };

  const getTrendIcon = (trend) => {
    if (trend === "up") return <TrendingUp className="w-4 h-4 text-red-500" />;
    if (trend === "down") return <TrendingDown className="w-4 h-4 text-blue-500" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  // Medication adherence calculation
  const medicationAdherence = (() => {
    const totalMeds = patient?.current_medications?.length || 0;
    if (totalMeds === 0) return null;

    // Simple heuristic: check if medications were mentioned in recent visits
    const recentNotesText = recentVisits
      .slice(0, 3)
      .map(v => v.nurse_notes?.toLowerCase() || "")
      .join(" ");

    const adherenceKeywords = ["compliant", "taking medications", "adherent", "medications reviewed"];
    const concernKeywords = ["non-compliant", "missed dose", "not taking", "refusing"];

    if (concernKeywords.some(k => recentNotesText.includes(k))) {
      return { status: "concerning", percentage: 65 };
    } else if (adherenceKeywords.some(k => recentNotesText.includes(k))) {
      return { status: "good", percentage: 95 };
    }
    return { status: "unknown", percentage: null };
  })();

  const generateAISummary = async () => {
    setGeneratingAISummary(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical AI assistant. Provide a concise "at-a-glance" patient summary based on the following data.

Patient: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || "Not specified"}
Secondary Diagnoses: ${(patient.secondary_diagnoses || []).join(", ") || "None"}
Current Medications: ${(patient.current_medications || []).map(m => m.name).join(", ") || "None"}
Allergies: ${patient.allergies || "NKDA"}

Recent Visit Data (last ${recentVisits.length} visits):
${recentVisits.slice(0, 5).map(v => `
- Date: ${v.visit_date}
- Type: ${v.visit_type}
- Vitals: BP ${v.vital_signs?.blood_pressure_systolic || "N/A"}/${v.vital_signs?.blood_pressure_diastolic || "N/A"}, HR ${v.vital_signs?.heart_rate || "N/A"}, Temp ${v.vital_signs?.temperature || "N/A"}°F, O2 ${v.vital_signs?.oxygen_saturation || "N/A"}%
- Notes excerpt: ${v.nurse_notes?.substring(0, 200) || "No notes"}
`).join("\n")}

Provide a brief 2-3 sentence clinical summary highlighting:
1. Current clinical status and stability
2. Any concerning trends or improvements
3. Key priorities for care

Be clear, concise, and actionable.`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            stability_status: { 
              type: "string", 
              enum: ["stable", "improving", "declining", "critical"] 
            },
            key_concerns: {
              type: "array",
              items: { type: "string" }
            },
            positive_indicators: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setAiSummary(response);
      toast.success("AI summary generated");
    } catch (error) {
      console.error("Error generating AI summary:", error);
      toast.error("Failed to generate AI summary");
    } finally {
      setGeneratingAISummary(false);
    }
  };

  const vitalsConfig = [
    { 
      key: "blood_pressure", 
      label: "Blood Pressure", 
      icon: Heart,
      value: latestVitals.blood_pressure_systolic 
        ? `${latestVitals.blood_pressure_systolic}/${latestVitals.blood_pressure_diastolic}`
        : null,
      unit: "mmHg",
      color: "text-red-600"
    },
    {
      key: "heart_rate",
      label: "Heart Rate",
      icon: Activity,
      value: latestVitals.heart_rate,
      unit: "bpm",
      color: "text-pink-600"
    },
    {
      key: "temperature",
      label: "Temperature",
      icon: Thermometer,
      value: latestVitals.temperature,
      unit: "°F",
      color: "text-orange-600"
    },
    {
      key: "respiratory_rate",
      label: "Respiratory Rate",
      icon: Wind,
      value: latestVitals.respiratory_rate,
      unit: "/min",
      color: "text-blue-600"
    },
    {
      key: "oxygen_saturation",
      label: "O2 Saturation",
      icon: Droplets,
      value: latestVitals.oxygen_saturation,
      unit: "%",
      color: "text-cyan-600"
    }
  ];

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader className="p-4 sm:p-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Health Metrics Dashboard
          </CardTitle>
          <Button
            onClick={generateAISummary}
            disabled={generatingAISummary}
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-700 w-full sm:w-auto"
          >
            {generatingAISummary ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 mr-2" />
                AI Summary
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* AI Summary Section */}
        {aiSummary && (
          <Card className="border-2 border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/50">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start gap-3 mb-3">
                <Brain className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm sm:text-base text-indigo-900 dark:text-indigo-100 mb-2">
                    Clinical Summary
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {aiSummary.summary}
                  </p>
                </div>
                <Badge className={
                  aiSummary.stability_status === "stable" ? "bg-green-600" :
                  aiSummary.stability_status === "improving" ? "bg-blue-600" :
                  aiSummary.stability_status === "declining" ? "bg-orange-600" :
                  "bg-red-600"
                }>
                  {aiSummary.stability_status}
                </Badge>
              </div>

              {aiSummary.key_concerns?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Key Concerns:</p>
                  <ul className="space-y-1">
                    {aiSummary.key_concerns.map((concern, idx) => (
                      <li key={idx} className="text-xs sm:text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                        <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span className="break-words">{concern}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {aiSummary.positive_indicators?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Positive Indicators:</p>
                  <ul className="space-y-1">
                    {aiSummary.positive_indicators.map((indicator, idx) => (
                      <li key={idx} className="text-xs sm:text-sm text-green-700 dark:text-green-300 flex items-start gap-2">
                        <CheckCircle2 className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span className="break-words">{indicator}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
          <div className="bg-blue-50 dark:bg-blue-950 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Primary Diagnosis</p>
            <p className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-gray-100 line-clamp-2 break-words">
              {patient?.primary_diagnosis || "Not specified"}
            </p>
          </div>

          <div className="bg-purple-50 dark:bg-purple-950 rounded-lg p-3 border border-purple-200 dark:border-purple-800">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Active Medications</p>
            <p className="text-xl sm:text-2xl font-bold text-purple-600">
              {patient?.current_medications?.length || 0}
            </p>
          </div>

          <div className="bg-green-50 dark:bg-green-950 rounded-lg p-3 border border-green-200 dark:border-green-800 col-span-2 sm:col-span-1">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Recent Visits (30d)</p>
            <p className="text-xl sm:text-2xl font-bold text-green-600">
              {recentVisits.length}
            </p>
          </div>
        </div>

        {/* Latest Vital Signs */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Latest Vital Signs
            {recentVisits[0]?.visit_date && (
              <span className="text-xs text-gray-500 font-normal">
                ({format(new Date(recentVisits[0].visit_date), "MMM d, yyyy")})
              </span>
            )}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {vitalsConfig.map((vital) => {
              const trend = vital.key !== "blood_pressure" ? calculateTrend(vital.key) : "stable";
              const Icon = vital.icon;

              return (
                <div
                  key={vital.key}
                  className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${vital.color}`} />
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        {vital.label}
                      </p>
                    </div>
                    {getTrendIcon(trend)}
                  </div>

                  {vital.value ? (
                    <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {vital.value} <span className="text-sm font-normal text-gray-500">{vital.unit}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400">No data</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Medication Adherence */}
        {medicationAdherence && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
              <Pill className="w-4 h-4" />
              Medication Adherence
            </h3>

            <Card className={
              medicationAdherence.status === "good" ? "border-green-300 bg-green-50 dark:bg-green-950" :
              medicationAdherence.status === "concerning" ? "border-red-300 bg-red-50 dark:bg-red-950" :
              "border-gray-300 bg-gray-50 dark:bg-gray-800"
            }>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {medicationAdherence.status === "good" ? (
                      <CheckCircle2 className="w-8 h-8 text-green-600" />
                    ) : medicationAdherence.status === "concerning" ? (
                      <AlertCircle className="w-8 h-8 text-red-600" />
                    ) : (
                      <Pill className="w-8 h-8 text-gray-400" />
                    )}
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-gray-100">
                        {medicationAdherence.status === "good" ? "Good Adherence" :
                         medicationAdherence.status === "concerning" ? "Adherence Concerns" :
                         "Adherence Unknown"}
                      </p>
                      <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        Based on recent documentation
                      </p>
                    </div>
                  </div>
                  {medicationAdherence.percentage && (
                    <div className="text-right">
                      <p className={`text-2xl sm:text-3xl font-bold ${
                        medicationAdherence.status === "good" ? "text-green-600" : "text-red-600"
                      }`}>
                        {medicationAdherence.percentage}%
                      </p>
                      <p className="text-xs text-gray-500">Estimated</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Vital Trends Summary */}
        {recentVisits.length > 1 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Trends (Last {recentVisits.length} Visits)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {["heart_rate", "blood_pressure_systolic", "oxygen_saturation"].map(vitalKey => {
                const trend = calculateTrend(vitalKey);
                const label = vitalKey === "blood_pressure_systolic" ? "Blood Pressure" :
                             vitalKey === "heart_rate" ? "Heart Rate" : "O2 Saturation";

                return (
                  <div key={vitalKey} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border">
                    <div className="flex items-center justify-between">
                      <p className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                        {label}
                      </p>
                      <div className="flex items-center gap-1">
                        {getTrendIcon(trend)}
                        <span className="text-xs text-gray-600 dark:text-gray-400 capitalize">
                          {trend}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No Data State */}
        {recentVisits.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm">No recent visit data available</p>
            <p className="text-xs text-gray-400 mt-1">
              Complete visits to track health metrics over time
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}