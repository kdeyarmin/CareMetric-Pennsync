import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { Loader2, BookOpen, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function EducationContentGenerator({ patient, carePlans, selectedTopic, onGenerated }) {
  const [topic, setTopic] = useState(selectedTopic?.title || "");
  const [readingLevel, setReadingLevel] = useState("simple");
  const [loading, setLoading] = useState(false);

  // Sync when selectedTopic changes
  React.useEffect(() => {
    if (selectedTopic?.title) setTopic(selectedTopic.title);
  }, [selectedTopic]);

  const generate = async () => {
    if (!topic.trim()) { toast.error("Enter a topic"); return; }
    setLoading(true);

    const diagnoses = [patient.primary_diagnosis, ...(patient.secondary_diagnoses || [])].filter(Boolean);
    const meds = (patient.current_medications || []).map(m => `${m.name} (${m.dosage || ""})`).filter(Boolean);
    const goals = (carePlans || []).filter(cp => cp.status === "active").map(cp => `${cp.problem}: ${cp.goal}`);
    const levelMap = { simple: "5th grade / very easy to understand", intermediate: "8th grade", advanced: "college level" };

    const res = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a patient education writer for home health care. Create a personalized education document.

PATIENT CONTEXT:
- Name: ${patient.first_name}
- Age: ${patient.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / 31557600000) : "unknown"}
- Diagnoses: ${diagnoses.join(", ") || "Not specified"}
- Current Medications: ${meds.join("; ") || "None listed"}
- Allergies: ${patient.allergies || "NKDA"}
- Care Plan Goals: ${goals.join("; ") || "None"}
- Living Situation: ${patient.social_history?.living_situation || "unknown"}
- Language: ${patient.social_history?.primary_language || "English"}

TOPIC: ${topic}
READING LEVEL: ${levelMap[readingLevel]}

Create a comprehensive but easy-to-read education document. Include:
1. A clear title
2. A warm, personalized introduction addressing the patient by first name
3. What they need to know (2-4 short sections)
4. Key points to remember (5-7 bullet points)
5. Warning signs - when to call their doctor immediately
6. Simple action items they can do today
7. Reassuring closing message

Personalize everything to their specific situation, medications, and care plan. Use simple analogies. Avoid jargon.`,
      response_json_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          key_points: { type: "array", items: { type: "string" } },
          warning_signs: { type: "array", items: { type: "string" } },
          action_items: { type: "array", items: { type: "string" } }
        }
      }
    });

    onGenerated({
      ...res,
      topic,
      reading_level: readingLevel,
    });
    setLoading(false);
  };

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Sparkles className="w-4 h-4 text-blue-500" />
          Generate Education Material
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Education topic (e.g., Managing Diabetes at Home)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="flex-1 h-9 text-sm"
          />
          <Select value={readingLevel} onValueChange={setReadingLevel}>
            <SelectTrigger className="w-[130px] h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="simple">Simple</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={generate} disabled={loading || !topic.trim()} size="sm" className="h-9 gap-1">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
            {loading ? "Generating..." : "Generate"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}