import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { Loader2, HelpCircle, ChevronDown, ChevronUp, Plus, CheckCircle2 } from "lucide-react";

export default function AIFollowUpQuestions({ patient, visitType, diagnosis, roughNotes, onInsertQuestion }) {
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [insertedIds, setInsertedIds] = useState(new Set());

  const generate = async () => {
    if (!diagnosis || !visitType) return;
    setLoading(true);

    const recentNotes = (patient?.enhanced_notes_history || []).slice(-3);
    const meds = (patient?.current_medications || []).map(m => m.name).filter(Boolean);
    const conditions = [patient?.primary_diagnosis, ...(patient?.secondary_diagnoses || [])].filter(Boolean);

    const res = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert home health clinical documentation advisor.

PATIENT CONTEXT:
- Name: ${patient?.first_name || "Unknown"} ${patient?.last_name || ""}
- Diagnoses: ${conditions.join(", ") || "Not specified"}
- Medications: ${meds.join(", ") || "None listed"}
- Allergies: ${patient?.allergies || "NKDA"}
- Functional Status: ${JSON.stringify(patient?.functional_status || {})}
- Social History: ${JSON.stringify(patient?.social_history || {})}

VISIT TYPE: ${visitType}
CURRENT DIAGNOSIS: ${diagnosis}
CURRENT ROUGH NOTES: ${roughNotes || "None yet"}

RECENT VISIT HISTORY:
${recentNotes.map(n => `- ${n.date}: ${n.visit_type} - ${n.diagnosis} - ${(n.enhanced_note || "").substring(0, 200)}`).join("\n") || "No previous visits"}

Based on the patient's history, current visit type, and what has been documented so far, suggest 6 targeted follow-up questions or assessments the clinician should ask/perform during THIS visit. 

Prioritize:
1. Questions that address changes since last visit
2. Assessments required for compliance/billing for this visit type
3. Safety screenings based on patient risk factors
4. Questions that would strengthen documentation quality

For each, indicate priority (high/medium) and the clinical rationale.`,
      response_json_schema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                category: { type: "string", enum: ["assessment", "safety", "compliance", "follow_up", "screening"] },
                priority: { type: "string", enum: ["high", "medium"] },
                rationale: { type: "string" },
                sample_documentation: { type: "string" }
              }
            }
          }
        }
      }
    });
    setQuestions(res.questions || []);
    setLoading(false);
  };

  const CATEGORY_STYLES = {
    assessment: "bg-blue-100 text-blue-700",
    safety: "bg-red-100 text-red-700",
    compliance: "bg-purple-100 text-purple-700",
    follow_up: "bg-green-100 text-green-700",
    screening: "bg-amber-100 text-amber-700",
  };

  const handleInsert = (q, idx) => {
    onInsertQuestion(q.sample_documentation || q.question);
    setInsertedIds(prev => new Set(prev).add(idx));
  };

  if (!diagnosis || !visitType) return null;

  return (
    <Card className="border-blue-200/60">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <HelpCircle className="w-4 h-4 text-blue-500" />
            AI Follow-Up Questions & Assessments
          </div>
          {questions && (
            <Button variant="ghost" size="sm" className="h-6 px-1" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
          )}
        </div>

        {!questions ? (
          <Button onClick={generate} disabled={loading} variant="outline" size="sm" className="w-full gap-2 text-xs">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <HelpCircle className="w-3 h-3" />}
            {loading ? "Analyzing patient history..." : "Suggest questions for this visit"}
          </Button>
        ) : expanded && (
          <div className="space-y-1.5">
            {questions.map((q, i) => (
              <div key={i} className={`p-2 rounded-lg border text-xs transition-all ${insertedIds.has(i) ? "bg-green-50 border-green-200" : "bg-white border-slate-200 hover:border-blue-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <Badge className={`${CATEGORY_STYLES[q.category] || "bg-slate-100 text-slate-600"} text-[9px] px-1.5 py-0`}>
                        {q.category?.replace("_", " ")}
                      </Badge>
                      {q.priority === "high" && <Badge className="bg-red-50 text-red-600 text-[9px] px-1.5 py-0">High Priority</Badge>}
                    </div>
                    <p className="font-medium text-slate-800">{q.question}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{q.rationale}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 flex-shrink-0"
                    onClick={() => handleInsert(q, i)}
                    disabled={insertedIds.has(i)}
                  >
                    {insertedIds.has(i) ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Plus className="w-3 h-3" />}
                  </Button>
                </div>
              </div>
            ))}
            <Button onClick={() => { setQuestions(null); setInsertedIds(new Set()); }} variant="ghost" size="sm" className="text-[10px] h-6">
              Refresh
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}