import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, AlertTriangle, Users, Filter, Eye } from "lucide-react";
import { toast } from "sonner";

const RISK_FACTORS = [
  { key: "visit_gap", label: "Visit Gap >7 days", weight: 20 },
  { key: "alerts_count", label: "Active Alerts ≥2", weight: 25 },
  { key: "compliance_low", label: "Compliance Score <70%", weight: 20 },
  { key: "multiple_diagnoses", label: "3+ Diagnoses", weight: 15 },
  { key: "high_risk_flag", label: "High Risk Flag", weight: 20 }
];

function computeRiskScore(patient, visits, alerts, audits) {
  let score = 0;
  const flags = [];

  const patientVisits = visits.filter(v => v.patient_id === patient.id);
  if (patientVisits.length > 0) {
    const lastVisit = new Date(patientVisits[0]?.visit_date || patientVisits[0]?.created_date);
    const daysSince = (Date.now() - lastVisit.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 7) { score += 20; flags.push("Visit gap >7 days"); }
  } else {
    score += 20; flags.push("No recent visits");
  }

  const patientAlerts = alerts.filter(a => a.patient_id === patient.id && a.status !== "resolved");
  if (patientAlerts.length >= 2) { score += 25; flags.push(`${patientAlerts.length} active alerts`); }
  else if (patientAlerts.length === 1) { score += 12; flags.push("1 active alert"); }

  const patientAudits = audits.filter(a => a.patient_id === patient.id);
  const avgCompliance = patientAudits.length > 0
    ? patientAudits.reduce((s, a) => s + (a.compliance_score || 0), 0) / patientAudits.length
    : 100;
  if (avgCompliance < 70) { score += 20; flags.push(`Low compliance (${Math.round(avgCompliance)}%)`); }

  const diagnosisCount = [
    patient.primary_diagnosis,
    patient.secondary_diagnosis_1,
    patient.secondary_diagnosis_2
  ].filter(Boolean).length;
  if (diagnosisCount >= 3) { score += 15; flags.push("Multiple diagnoses"); }

  if (patient.risk_level === "high") { score += 20; flags.push("Flagged high risk"); }
  else if (patient.risk_level === "medium") { score += 10; flags.push("Flagged medium risk"); }

  return { score: Math.min(score, 100), flags, alertCount: patientAlerts.length, compliance: Math.round(avgCompliance), lastVisit: patientVisits[0] };
}

export default function HighRiskPatientIdentifier() {
  const [analyzed, setAnalyzed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [aiInsights, setAiInsights] = useState(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  const { data: patients = [] } = useQuery({
    queryKey: ["patients-risk-id"],
    queryFn: () => base44.entities.Patient.list("-updated_date", 100)
  });

  const { data: visits = [] } = useQuery({
    queryKey: ["visits-risk-id"],
    queryFn: () => base44.entities.Visit.list("-visit_date", 200)
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ["alerts-risk-id"],
    queryFn: () => base44.entities.PatientAlert.list("-created_date", 200)
  });

  const { data: audits = [] } = useQuery({
    queryKey: ["audits-risk-id"],
    queryFn: () => base44.entities.ComplianceAudit.list("-created_date", 200)
  });

  const runAnalysis = () => {
    setLoading(true);
    setTimeout(() => { setAnalyzed(true); setLoading(false); }, 800);
  };

  const scoredPatients = analyzed
    ? patients.map(p => {
        const { score, flags, alertCount, compliance, lastVisit } = computeRiskScore(p, visits, alerts, audits);
        return { ...p, riskScore: score, riskFlags: flags, alertCount, compliance, lastVisit };
      }).sort((a, b) => b.riskScore - a.riskScore)
    : [];

  const filtered = scoredPatients.filter(p => {
    if (filter === "critical") return p.riskScore >= 70;
    if (filter === "high") return p.riskScore >= 50 && p.riskScore < 70;
    if (filter === "moderate") return p.riskScore >= 30 && p.riskScore < 50;
    return true;
  });

  const critical = scoredPatients.filter(p => p.riskScore >= 70).length;
  const high = scoredPatients.filter(p => p.riskScore >= 50 && p.riskScore < 70).length;
  const moderate = scoredPatients.filter(p => p.riskScore >= 30 && p.riskScore < 50).length;

  const getRiskLabel = (score) => {
    if (score >= 70) return { label: "Critical", color: "bg-red-600 text-white" };
    if (score >= 50) return { label: "High", color: "bg-orange-500 text-white" };
    if (score >= 30) return { label: "Moderate", color: "bg-yellow-500 text-white" };
    return { label: "Low", color: "bg-green-500 text-white" };
  };

  const generateAIInsights = async () => {
    setLoadingInsights(true);
    try {
      const topRisk = scoredPatients.slice(0, 5).map(p => ({
        name: `${p.first_name} ${p.last_name}`,
        score: p.riskScore,
        flags: p.riskFlags
      }));

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Given these high-risk patients: ${JSON.stringify(topRisk)}, provide 3-5 concise, actionable insights for the care team. Focus on immediate interventions needed. Return JSON: {"insights": [{"title": "string", "detail": "string", "urgency": "immediate|this_week|this_month"}]}`,
        response_json_schema: {
          type: "object",
          properties: { insights: { type: "array", items: { type: "object" } } }
        }
      });
      setAiInsights(response);
    } catch (e) {
      toast.error("Failed to generate insights");
    } finally {
      setLoadingInsights(false);
    }
  };

  const urgencyColor = (u) => ({
    immediate: "bg-red-100 text-red-700 border-red-300",
    this_week: "bg-yellow-100 text-yellow-700 border-yellow-300",
    this_month: "bg-blue-100 text-blue-700 border-blue-300"
  }[u] || "bg-slate-100 text-slate-700");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              <div>
                <CardTitle className="text-base">Automated High-Risk Patient Identification</CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">Multi-factor scoring: visit history, compliance, alerts, diagnoses</p>
              </div>
            </div>
            <Button onClick={runAnalysis} disabled={loading} className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
              {loading ? "Analyzing..." : analyzed ? "Re-Run Analysis" : "Run Analysis"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {!analyzed && !loading && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
            <AlertTriangle className="w-12 h-12 mb-3 opacity-30" />
            <p className="font-medium">Analysis not run yet</p>
            <p className="text-sm">Click "Run Analysis" to identify high-risk patients across multiple factors</p>
          </CardContent>
        </Card>
      )}

      {analyzed && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Analyzed", value: scoredPatients.length, color: "bg-slate-50 text-slate-700" },
              { label: "Critical Risk", value: critical, color: "bg-red-50 text-red-700" },
              { label: "High Risk", value: high, color: "bg-orange-50 text-orange-700" },
              { label: "Moderate Risk", value: moderate, color: "bg-yellow-50 text-yellow-700" }
            ].map((s, i) => (
              <Card key={i} className={`p-3 ${s.color.split(" ")[0]}`}>
                <p className={`text-2xl font-bold ${s.color.split(" ")[1]}`}>{s.value}</p>
                <p className="text-xs font-medium text-slate-600 mt-1">{s.label}</p>
              </Card>
            ))}
          </div>

          {/* AI Insights CTA */}
          {critical > 0 && (
            <Card className="border-orange-200 bg-orange-50 dark:bg-orange-900/20">
              <CardContent className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <p className="text-sm text-orange-800 dark:text-orange-200">
                  <strong>{critical} critical patients</strong> identified — get AI-generated action plan
                </p>
                <Button size="sm" variant="outline" onClick={generateAIInsights} disabled={loadingInsights} className="flex-shrink-0">
                  {loadingInsights ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Eye className="w-3 h-3 mr-1" />}
                  Get AI Insights
                </Button>
              </CardContent>
            </Card>
          )}

          {/* AI Insights */}
          {aiInsights?.insights && (
            <div className="space-y-2">
              {aiInsights.insights.map((ins, i) => (
                <div key={i} className={`p-3 rounded-lg border ${urgencyColor(ins.urgency)}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm">{ins.title}</p>
                    <Badge className={`text-[10px] flex-shrink-0 ${urgencyColor(ins.urgency)}`}>{ins.urgency?.replace("_", " ")}</Badge>
                  </div>
                  <p className="text-xs mt-1">{ins.detail}</p>
                </div>
              ))}
            </div>
          )}

          {/* Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-slate-500" />
            {["all", "critical", "high", "moderate"].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  filter === f ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)} {f === "all" ? `(${scoredPatients.length})` : f === "critical" ? `(${critical})` : f === "high" ? `(${high})` : `(${moderate})`}
              </button>
            ))}
          </div>

          {/* Patient List */}
          <div className="space-y-2">
            {filtered.slice(0, 20).map((patient, i) => {
              const risk = getRiskLabel(patient.riskScore);
              return (
                <Card key={i} className="overflow-hidden">
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-semibold text-sm">{patient.first_name} {patient.last_name}</p>
                          <Badge className={`text-xs ${risk.color}`}>{risk.label}</Badge>
                        </div>
                        <p className="text-xs text-slate-500 mb-2">{patient.primary_diagnosis || "No diagnosis"}</p>
                        
                        <Progress value={patient.riskScore} className="h-1.5 mb-2" />
                        
                        <div className="flex flex-wrap gap-1 mb-2">
                          {patient.riskFlags?.map((flag, fi) => (
                            <span key={fi} className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{flag}</span>
                          ))}
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-center mt-2">
                          <div className="bg-slate-50 rounded p-1.5">
                            <p className="text-xs font-bold">{patient.alertCount}</p>
                            <p className="text-[10px] text-slate-500">Alerts</p>
                          </div>
                          <div className="bg-slate-50 rounded p-1.5">
                            <p className="text-xs font-bold">{patient.compliance}%</p>
                            <p className="text-[10px] text-slate-500">Compliance</p>
                          </div>
                          <div className="bg-slate-50 rounded p-1.5">
                            <p className="text-xs font-bold text-orange-600">{patient.riskScore}/100</p>
                            <p className="text-[10px] text-slate-500">Risk Score</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {filtered.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-slate-500 text-sm">
                  No patients match this risk level filter.
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}