import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { Loader2, Lightbulb, Plus } from "lucide-react";

export default function TopicSuggester({ patient, carePlans, onSelectTopic }) {
  const [loading, setLoading] = useState(false);
  const [topics, setTopics] = useState(null);

  const suggestTopics = async () => {
    setLoading(true);
    const diagnoses = [
      patient.primary_diagnosis,
      ...(patient.secondary_diagnoses || []),
    ].filter(Boolean);
    const meds = (patient.current_medications || []).map(m => m.name).filter(Boolean);
    const goals = (carePlans || []).filter(cp => cp.status === "active").map(cp => cp.problem);

    const res = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a home health patient education specialist.
Given this patient profile, suggest 6 personalized education topics that would be most helpful.

Diagnoses: ${diagnoses.join(", ") || "None listed"}
Current Medications: ${meds.join(", ") || "None listed"}
Active Care Plan Goals: ${goals.join("; ") || "None"}
Allergies: ${patient.allergies || "NKDA"}
Functional Status: ${patient.functional_status?.ambulation || "unknown"}
Living Situation: ${patient.social_history?.living_situation || "unknown"}

For each topic, provide a short title and a one-sentence rationale explaining why it's relevant for THIS patient. Prioritize by clinical importance.`,
      response_json_schema: {
        type: "object",
        properties: {
          topics: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                rationale: { type: "string" },
                category: { type: "string", enum: ["condition", "medication", "self_care", "safety", "nutrition", "exercise"] }
              }
            }
          }
        }
      }
    });
    setTopics(res.topics || []);
    setLoading(false);
  };

  const CATEGORY_COLORS = {
    condition: "bg-blue-100 text-blue-700",
    medication: "bg-purple-100 text-purple-700",
    self_care: "bg-green-100 text-green-700",
    safety: "bg-red-100 text-red-700",
    nutrition: "bg-amber-100 text-amber-700",
    exercise: "bg-cyan-100 text-cyan-700",
  };

  if (!topics) {
    return (
      <Button onClick={suggestTopics} disabled={loading} variant="outline" className="w-full gap-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4 text-amber-500" />}
        {loading ? "Analyzing patient profile..." : "Suggest Topics Based on Patient Profile"}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-500 flex items-center gap-1">
        <Lightbulb className="w-3 h-3 text-amber-500" /> AI-Suggested Topics
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {topics.map((t, i) => (
          <button
            key={i}
            onClick={() => onSelectTopic(t)}
            className="text-left p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 group-hover:text-blue-700">{t.title}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{t.rationale}</p>
              </div>
              <div className="flex-shrink-0 flex items-center gap-1">
                <Badge className={`text-[9px] px-1.5 py-0 ${CATEGORY_COLORS[t.category] || "bg-slate-100 text-slate-600"}`}>
                  {t.category?.replace("_", " ")}
                </Badge>
                <Plus className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500" />
              </div>
            </div>
          </button>
        ))}
      </div>
      <Button onClick={() => setTopics(null)} variant="ghost" size="sm" className="text-xs">
        Refresh suggestions
      </Button>
    </div>
  );
}