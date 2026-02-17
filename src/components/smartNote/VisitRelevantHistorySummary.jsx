import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { Loader2, History, ChevronDown, ChevronUp, Copy, Plus } from "lucide-react";
import { toast } from "sonner";

export default function VisitRelevantHistorySummary({ patient, visitType, diagnosis, onInsertText }) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const generate = async () => {
    if (!patient || !visitType || !diagnosis) return;
    setLoading(true);

    const conditions = [patient.primary_diagnosis, ...(patient.secondary_diagnoses || [])].filter(Boolean);
    const meds = (patient.current_medications || []).map(m => `${m.name} ${m.dosage || ""} ${m.frequency || ""}`).filter(Boolean);
    const recentNotes = (patient.enhanced_notes_history || []).slice(-5);
    const hospitalizations = (patient.past_hospitalizations || []).slice(-3);
    const surgeries = (patient.past_surgeries || []).slice(-3);
    const wounds = patient.wounds || [];
    const allergies = patient.allergies || "NKDA";

    const res = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a clinical documentation specialist preparing a concise, visit-relevant patient history summary for a home health clinician.

PATIENT: ${patient.first_name} ${patient.last_name}
DOB: ${patient.date_of_birth || "Unknown"}
CURRENT VISIT TYPE: ${visitType}
VISIT DIAGNOSIS: ${diagnosis}

ALL DIAGNOSES: ${conditions.join(", ")}
CURRENT MEDICATIONS: ${meds.join("; ") || "None listed"}
ALLERGIES: ${allergies}

FUNCTIONAL STATUS:
- Ambulation: ${patient.functional_status?.ambulation || "Unknown"}
- ADL Independence: ${patient.functional_status?.adl_independence || "Unknown"}
- Cognitive: ${patient.functional_status?.cognitive_status || "Unknown"}
- Fall Risk: ${patient.functional_status?.fall_risk || "Unknown"}

ACTIVE WOUNDS: ${wounds.map(w => `${w.type} on ${w.location} (stage ${w.stage})`).join("; ") || "None"}

RECENT HOSPITALIZATIONS: ${hospitalizations.map(h => `${h.date}: ${h.reason} at ${h.hospital} (${h.length_of_stay} days)`).join("; ") || "None"}

PAST SURGERIES: ${surgeries.map(s => `${s.date}: ${s.procedure}`).join("; ") || "None"}

SOCIAL HISTORY:
- Living: ${patient.social_history?.living_situation || "Unknown"}
- Language: ${patient.social_history?.primary_language || "English"}
- Smoking: ${patient.social_history?.smoking_status || "Unknown"}
- Support: ${patient.social_history?.support_system || "Unknown"}

RECENT VISIT NOTES (last 5):
${recentNotes.map(n => `[${n.date}] ${n.visit_type} - ${n.diagnosis}: ${(n.enhanced_note || "").substring(0, 300)}`).join("\n\n") || "No previous notes"}

ADVANCE DIRECTIVES: ${JSON.stringify(patient.advance_directives || {})}

Create a focused summary with these sections:
1. **Visit-Relevant History**: Only history items directly relevant to today's ${visitType} visit for ${diagnosis}. Include pertinent positives AND negatives.
2. **Trending Changes**: What has changed across recent visits? Improving or declining? Any new symptoms?
3. **Medication Considerations**: Medications relevant to today's diagnosis — any interactions, adherence issues, or changes needed?
4. **Risk Factors**: Active risk factors the clinician should be aware of for THIS visit.
5. **Key Documentation Reminders**: What specific historical details should be referenced in today's note for compliance.

Keep each section 2-4 bullet points. Be specific and actionable, not generic.`,
      response_json_schema: {
        type: "object",
        properties: {
          visit_relevant_history: {
            type: "array",
            items: { type: "string" }
          },
          trending_changes: {
            type: "array",
            items: { type: "string" }
          },
          medication_considerations: {
            type: "array",
            items: { type: "string" }
          },
          risk_factors: {
            type: "array",
            items: { type: "string" }
          },
          documentation_reminders: {
            type: "array",
            items: { type: "string" }
          },
          one_line_summary: { type: "string" }
        }
      }
    });
    setSummary(res);
    setLoading(false);
  };

  const copyAll = () => {
    if (!summary) return;
    const text = [
      "VISIT-RELEVANT HISTORY:",
      ...(summary.visit_relevant_history || []).map(s => `• ${s}`),
      "\nTRENDING CHANGES:",
      ...(summary.trending_changes || []).map(s => `• ${s}`),
      "\nMEDICATION CONSIDERATIONS:",
      ...(summary.medication_considerations || []).map(s => `• ${s}`),
      "\nRISK FACTORS:",
      ...(summary.risk_factors || []).map(s => `• ${s}`),
    ].join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Summary copied");
  };

  if (!patient || !visitType || !diagnosis) return null;

  const SECTION_CONFIG = [
    { key: "visit_relevant_history", label: "Visit-Relevant History", icon: "📋", color: "blue" },
    { key: "trending_changes", label: "Trending Changes", icon: "📈", color: "green" },
    { key: "medication_considerations", label: "Medication Considerations", icon: "💊", color: "purple" },
    { key: "risk_factors", label: "Risk Factors", icon: "⚠️", color: "red" },
    { key: "documentation_reminders", label: "Documentation Reminders", icon: "📝", color: "amber" },
  ];

  return (
    <Card className="border-indigo-200/60">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <History className="w-4 h-4 text-indigo-500" />
            Visit-Relevant History Summary
          </div>
          {summary && (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] gap-1" onClick={copyAll}>
                <Copy className="w-2.5 h-2.5" /> Copy
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-1" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
            </div>
          )}
        </div>

        {!summary ? (
          <Button onClick={generate} disabled={loading} variant="outline" size="sm" className="w-full gap-2 text-xs">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <History className="w-3 h-3" />}
            {loading ? "Analyzing patient history..." : "Generate history summary for this visit"}
          </Button>
        ) : expanded && (
          <div className="space-y-2">
            {summary.one_line_summary && (
              <p className="text-xs font-medium text-indigo-700 bg-indigo-50 rounded-lg p-2">{summary.one_line_summary}</p>
            )}

            {SECTION_CONFIG.map(({ key, label, icon, color }) => {
              const items = summary[key];
              if (!items || items.length === 0) return null;
              return (
                <div key={key} className={`bg-${color}-50/50 rounded-lg p-2`}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold text-slate-600 flex items-center gap-1">
                      <span>{icon}</span> {label}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1 text-[9px]"
                      onClick={() => {
                        onInsertText(`\n${label}:\n${items.map(i => `- ${i}`).join("\n")}`);
                        toast.success(`Inserted ${label}`);
                      }}
                    >
                      <Plus className="w-2.5 h-2.5" />
                    </Button>
                  </div>
                  {items.map((item, i) => (
                    <p key={i} className="text-[10px] text-slate-600 pl-4 mb-0.5">• {item}</p>
                  ))}
                </div>
              );
            })}

            <Button onClick={() => setSummary(null)} variant="ghost" size="sm" className="text-[10px] h-6">
              Refresh
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}