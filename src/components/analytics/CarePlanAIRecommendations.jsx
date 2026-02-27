import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Target, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function CarePlanAIRecommendations() {
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState(null);
  const [expanded, setExpanded] = useState({});

  const { data: patients } = useQuery({
    queryKey: ["patients-careplan-ai"],
    queryFn: () => base44.entities.Patient.list("-updated_date", 20),
    initialData: []
  });

  const { data: carePlans } = useQuery({
    queryKey: ["careplans-ai"],
    queryFn: () => base44.entities.CarePlan.list("-updated_date", 30),
    initialData: []
  });

  const generateRecommendations = async () => {
    setLoading(true);
    try {
      const patientSummary = patients.slice(0, 10).map(p => ({
        name: p.first_name + " " + p.last_name,
        diagnosis: p.primary_diagnosis,
        risk: p.risk_level,
        insurance: p.insurance_type
      }));

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical AI assistant specializing in personalized care plan optimization. Based on patient data, generate specific care plan adjustment recommendations.

Patient data: ${JSON.stringify(patientSummary)}
Total care plans active: ${carePlans.length}

Generate personalized care plan adjustment recommendations for at least 5 different patient scenarios. Return JSON:
{
  "summary": "Brief overall summary of care plan health across the patient population",
  "overall_optimization_score": <number 50-95>,
  "patients": [
    {
      "patient_name": "string",
      "diagnosis": "string",
      "current_status": "on_track|needs_adjustment|critical",
      "priority": "high|medium|low",
      "recommendations": [
        {"action": "string", "rationale": "string", "expected_impact": "string", "timeframe": "string"}
      ],
      "goal_adjustments": ["string", "string"],
      "frequency_recommendation": "string"
    }
  ],
  "population_insights": [
    {"category": "string", "finding": "string", "recommendation": "string"}
  ],
  "evidence_based_protocols": [
    {"condition": "string", "protocol": "string", "evidence_level": "A|B|C"}
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            overall_optimization_score: { type: "number" },
            patients: { type: "array", items: { type: "object" } },
            population_insights: { type: "array", items: { type: "object" } },
            evidence_based_protocols: { type: "array", items: { type: "object" } }
          }
        }
      });

      setRecommendations(response);
      toast.success("Care plan recommendations generated");
    } catch (error) {
      console.error(error);
      toast.error("Failed to generate recommendations");
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (s) => ({
    on_track: "bg-green-100 text-green-700",
    needs_adjustment: "bg-yellow-100 text-yellow-700",
    critical: "bg-red-100 text-red-700"
  }[s] || "bg-slate-100 text-slate-700");

  const priorityColor = (p) => ({
    high: "bg-red-500",
    medium: "bg-yellow-500",
    low: "bg-green-500"
  }[p] || "bg-slate-500");

  const evidenceColor = (e) => ({
    A: "bg-green-100 text-green-700",
    B: "bg-blue-100 text-blue-700",
    C: "bg-slate-100 text-slate-700"
  }[e] || "bg-slate-100 text-slate-700");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-purple-600" />
              <div>
                <CardTitle className="text-base">AI Care Plan Recommendations</CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">Personalized adjustments based on patient data and evidence-based protocols</p>
              </div>
            </div>
            <Button onClick={generateRecommendations} disabled={loading} className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {loading ? "Analyzing..." : "Generate Recommendations"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {!recommendations && !loading && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
            <Target className="w-12 h-12 mb-3 opacity-30" />
            <p className="font-medium">No recommendations yet</p>
            <p className="text-sm">Click "Generate Recommendations" to get AI-driven care plan adjustments</p>
          </CardContent>
        </Card>
      )}

      {recommendations && (
        <>
          {/* Summary */}
          <Card className="border-purple-200 bg-purple-50 dark:bg-purple-900/20">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm text-slate-700 dark:text-slate-300">{recommendations.summary}</p>
                </div>
                <div className="text-center flex-shrink-0">
                  <p className="text-3xl font-bold text-purple-700">{recommendations.overall_optimization_score}%</p>
                  <p className="text-xs text-slate-500">Optimization Score</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Patient Recommendations */}
          <div className="space-y-3">
            {recommendations.patients?.map((patient, i) => (
              <Card key={i} className="overflow-hidden">
                <button
                  className="w-full text-left"
                  onClick={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}
                >
                  <CardHeader className="pb-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityColor(patient.priority)}`} />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{patient.patient_name}</p>
                          <p className="text-xs text-slate-500 truncate">{patient.diagnosis}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge className={`text-xs ${statusColor(patient.current_status)}`}>
                          {patient.current_status?.replace("_", " ")}
                        </Badge>
                        {expanded[i] ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                    </div>
                  </CardHeader>
                </button>

                {expanded[i] && (
                  <CardContent className="pt-0 space-y-3">
                    {/* Recommendations */}
                    <div>
                      <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Recommended Actions</p>
                      <div className="space-y-2">
                        {patient.recommendations?.map((r, ri) => (
                          <div key={ri} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-sm">
                            <p className="font-medium text-slate-800 dark:text-slate-200">{r.action}</p>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{r.rationale}</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Impact: {r.expected_impact}</span>
                              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">⏱ {r.timeframe}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Goal Adjustments */}
                    {patient.goal_adjustments?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Goal Adjustments</p>
                        <ul className="space-y-1">
                          {patient.goal_adjustments.map((g, gi) => (
                            <li key={gi} className="text-sm text-slate-700 dark:text-slate-300 flex gap-2">
                              <span className="text-purple-500">✓</span>{g}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {patient.frequency_recommendation && (
                      <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded text-sm text-green-800 dark:text-green-300">
                        <strong>Visit Frequency:</strong> {patient.frequency_recommendation}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>

          {/* Population Insights */}
          {recommendations.population_insights?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">📊 Population-Level Insights</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {recommendations.population_insights.map((ins, i) => (
                  <div key={i} className="p-3 border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-r-lg">
                    <p className="text-xs font-semibold text-blue-700 uppercase">{ins.category}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">{ins.finding}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">→ {ins.recommendation}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Evidence-Based Protocols */}
          {recommendations.evidence_based_protocols?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">📚 Evidence-Based Protocols</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {recommendations.evidence_based_protocols.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <Badge className={`text-xs mt-0.5 flex-shrink-0 ${evidenceColor(p.evidence_level)}`}>
                      Level {p.evidence_level}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">{p.condition}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{p.protocol}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}