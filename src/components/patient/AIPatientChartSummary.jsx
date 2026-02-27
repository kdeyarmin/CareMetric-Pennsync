import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, ClipboardList, Activity, Calendar, Pill, AlertTriangle } from "lucide-react";
import { format, isValid } from "date-fns";

export default function AIPatientChartSummary({ patient, visits = [], carePlans = [], incidents = [] }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const generateSummary = async () => {
    setLoading(true);
    try {
      const recentVisits = visits
        .filter(v => v.status === "completed")
        .slice(0, 5)
        .map(v => ({
          date: v.visit_date,
          type: v.visit_type,
          notes: v.nurse_notes?.slice(0, 300),
          vitals: v.vital_signs
        }));

      const activeCarePlans = carePlans.filter(cp => cp.status === "active").map(cp => ({
        problem: cp.problem,
        goal: cp.goal,
        status: cp.status
      }));

      const prompt = `You are a clinical documentation AI assistant. Generate a concise, structured patient chart summary based on the following patient data.

PATIENT INFORMATION:
- Name: ${patient.first_name} ${patient.last_name}
- DOB: ${patient.date_of_birth || "Unknown"}
- Care Type: ${patient.care_type || "Home Health"}
- Primary Diagnosis: ${patient.primary_diagnosis || "Not specified"}
- Secondary Diagnoses: ${(patient.secondary_diagnoses || []).join(", ") || "None"}
- Allergies: ${patient.allergies || "NKDA"}
- Current Medications: ${(patient.current_medications || []).map(m => `${m.name} ${m.dosage || ""}`).join(", ") || "None documented"}
- Past Medical History: ${(patient.past_medical_history || []).join(", ") || "None documented"}
- Payor: ${patient.payor || "Not specified"}

RECENT VISITS (last 5 completed):
${recentVisits.length > 0 ? recentVisits.map(v => `- ${v.date} (${v.type}): ${v.notes || "No notes"}`).join("\n") : "No recent visits"}

ACTIVE CARE PLANS:
${activeCarePlans.length > 0 ? activeCarePlans.map(cp => `- ${cp.problem}: ${cp.goal}`).join("\n") : "No active care plans"}

RECENT INCIDENTS: ${incidents.length} total incident(s)

Please provide a structured JSON summary with these exact fields:
{
  "overall_status": "stable|improving|declining|critical",
  "clinical_snapshot": "2-3 sentence overview of the patient's current clinical status",
  "key_medical_history": ["up to 4 most important medical history points"],
  "current_conditions": ["list of active conditions/diagnoses being managed"],
  "recent_visit_summary": "1-2 sentence summary of recent visit activity and trends",
  "active_care_focus": ["up to 3 main care focus areas from care plans"],
  "medication_highlights": ["up to 3 notable medications or concerns"],
  "flags": ["any important clinical flags or concerns to highlight"],
  "last_updated_context": "brief note on data currency"
}`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_status: { type: "string" },
            clinical_snapshot: { type: "string" },
            key_medical_history: { type: "array", items: { type: "string" } },
            current_conditions: { type: "array", items: { type: "string" } },
            recent_visit_summary: { type: "string" },
            active_care_focus: { type: "array", items: { type: "string" } },
            medication_highlights: { type: "array", items: { type: "string" } },
            flags: { type: "array", items: { type: "string" } },
            last_updated_context: { type: "string" }
          }
        }
      });

      setSummary(result);
      setExpanded(true);
    } catch (err) {
      console.error("Chart summary error:", err);
    } finally {
      setLoading(false);
    }
  };

  const statusColors = {
    stable: "bg-green-100 text-green-800 border-green-300",
    improving: "bg-blue-100 text-blue-800 border-blue-300",
    declining: "bg-orange-100 text-orange-800 border-orange-300",
    critical: "bg-red-100 text-red-800 border-red-300"
  };

  return (
    <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-slate-50">
      <CardHeader className="pb-3 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-purple-900">
            <Sparkles className="h-4 w-4 text-purple-600" />
            AI Patient Chart Summary
          </CardTitle>
          <div className="flex items-center gap-2">
            {summary && (
              <button onClick={() => setExpanded(!expanded)} className="text-slate-500 hover:text-slate-700">
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            )}
            <Button
              size="sm"
              onClick={generateSummary}
              disabled={loading}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs"
            >
              {loading ? (
                <RefreshCw className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Sparkles className="h-3 w-3 mr-1" />
              )}
              {loading ? "Generating..." : summary ? "Refresh" : "Generate Summary"}
            </Button>
          </div>
        </div>
      </CardHeader>

      {!summary && !loading && (
        <CardContent className="px-3 sm:px-4 pb-4">
          <p className="text-sm text-slate-500 text-center py-4">
            Click "Generate Summary" to create an AI-powered overview of this patient's chart, including medical history, recent visits, and current conditions.
          </p>
        </CardContent>
      )}

      {loading && (
        <CardContent className="px-3 sm:px-4 pb-4">
          <div className="flex items-center justify-center gap-3 py-6">
            <RefreshCw className="h-5 w-5 animate-spin text-purple-600" />
            <p className="text-sm text-slate-600">Analyzing patient chart...</p>
          </div>
        </CardContent>
      )}

      {summary && expanded && (
        <CardContent className="px-3 sm:px-4 pb-4 space-y-4">
          {/* Status + Snapshot */}
          <div className="flex flex-wrap items-start gap-3">
            {summary.overall_status && (
              <Badge className={`${statusColors[summary.overall_status] || statusColors.stable} capitalize font-semibold border`}>
                {summary.overall_status}
              </Badge>
            )}
            <p className="text-sm text-slate-700 flex-1 min-w-0 leading-relaxed">
              {summary.clinical_snapshot}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Current Conditions */}
            {summary.current_conditions?.length > 0 && (
              <div className="bg-white rounded-lg p-3 border border-slate-200">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Activity className="h-3 w-3" /> Current Conditions
                </p>
                <ul className="space-y-1">
                  {summary.current_conditions.map((c, i) => (
                    <li key={i} className="text-xs text-slate-700 flex items-start gap-1">
                      <span className="text-purple-500 mt-0.5">•</span> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Key Medical History */}
            {summary.key_medical_history?.length > 0 && (
              <div className="bg-white rounded-lg p-3 border border-slate-200">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <ClipboardList className="h-3 w-3" /> Key Medical History
                </p>
                <ul className="space-y-1">
                  {summary.key_medical_history.map((h, i) => (
                    <li key={i} className="text-xs text-slate-700 flex items-start gap-1">
                      <span className="text-blue-500 mt-0.5">•</span> {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recent Visit Summary */}
            {summary.recent_visit_summary && (
              <div className="bg-white rounded-lg p-3 border border-slate-200">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Recent Visits
                </p>
                <p className="text-xs text-slate-700 leading-relaxed">{summary.recent_visit_summary}</p>
                {summary.active_care_focus?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {summary.active_care_focus.map((f, i) => (
                      <span key={i} className="text-xs bg-blue-50 text-blue-700 rounded px-1.5 py-0.5 border border-blue-100">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Medications */}
            {summary.medication_highlights?.length > 0 && (
              <div className="bg-white rounded-lg p-3 border border-slate-200">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Pill className="h-3 w-3" /> Medication Highlights
                </p>
                <ul className="space-y-1">
                  {summary.medication_highlights.map((m, i) => (
                    <li key={i} className="text-xs text-slate-700 flex items-start gap-1">
                      <span className="text-green-500 mt-0.5">•</span> {m}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Flags */}
          {summary.flags?.length > 0 && (
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Clinical Flags
              </p>
              <ul className="space-y-1">
                {summary.flags.map((f, i) => (
                  <li key={i} className="text-xs text-amber-800 flex items-start gap-1">
                    <span className="mt-0.5">⚠</span> {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.last_updated_context && (
            <p className="text-xs text-slate-400 italic">{summary.last_updated_context}</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}