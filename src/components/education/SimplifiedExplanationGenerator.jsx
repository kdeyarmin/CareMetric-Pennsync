import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  Loader2,
  Copy,
  CheckCircle2,
  RefreshCw,
  BookOpen,
  Lightbulb,
  MessageCircle
} from "lucide-react";
import { toast } from 'sonner';

export default function SimplifiedExplanationGenerator({ patient, diagnosis }) {
  const [nurseInput, setNurseInput] = useState("");
  const [explanationType, setExplanationType] = useState("condition");
  const [simplificationLevel, setSimplificationLevel] = useState("very_simple");
  const ai = useAICall();
  const [explanation, setExplanation] = useState(null);
  const [copied, setCopied] = useState(false);

  const explanationTypes = [
    { value: "condition", label: "Medical Condition", icon: "🏥" },
    { value: "treatment", label: "Treatment Plan", icon: "💊" },
    { value: "procedure", label: "Procedure/Test", icon: "🔬" },
    { value: "medication", label: "Medication", icon: "💉" },
    { value: "lifestyle", label: "Lifestyle Changes", icon: "🥗" },
    { value: "prognosis", label: "Prognosis/Outlook", icon: "📈" }
  ];

  const simplificationLevels = [
    { value: "very_simple", label: "Very Simple (5th grade)", description: "For patients with limited health literacy" },
    { value: "simple", label: "Simple (8th grade)", description: "Easy to understand, minimal jargon" },
    { value: "moderate", label: "Moderate", description: "Standard patient education level" }
  ];

  const generateExplanation = async () => {
    if (!nurseInput.trim()) {
      toast.error("Please enter the medical information you want to explain.");
      return;
    }

    try {
      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `You are an expert health communicator specializing in translating complex medical information into patient-friendly language.

NURSE'S INPUT (Medical Information):
${nurseInput}

EXPLANATION TYPE: ${explanationType}
SIMPLIFICATION LEVEL: ${simplificationLevel === 'very_simple' ? '5th grade reading level - use very simple words, short sentences, everyday analogies' : simplificationLevel === 'simple' ? '8th grade reading level' : 'Standard adult level'}

${patient ? `PATIENT: ${patient.first_name} ${patient.last_name}, Diagnosis: ${patient.primary_diagnosis}` : ''}
${diagnosis ? `CONTEXT DIAGNOSIS: ${diagnosis}` : ''}

YOUR TASK:
Transform the nurse's medical input into a patient-friendly explanation that:
1. Uses everyday language and avoids medical jargon
2. Includes relatable analogies (e.g., "Your heart is like a pump...")
3. Breaks complex concepts into simple, digestible pieces
4. Addresses common patient concerns and fears
5. Ends with encouragement and actionable takeaways

Return JSON:
{
  "title": "Simple title for the explanation",
  "opening_hook": "An engaging, reassuring opening sentence",
  "simplified_explanation": "The main explanation in simple language (2-4 paragraphs)",
  "key_analogies": [
    {
      "medical_concept": "The complex medical term/concept",
      "simple_analogy": "The everyday analogy to explain it",
      "why_it_helps": "How this analogy clarifies the concept"
    }
  ],
  "common_concerns_addressed": [
    {
      "concern": "A common patient worry about this",
      "reassurance": "Reassuring explanation addressing the concern"
    }
  ],
  "key_takeaways": [
    "Simple bullet point the patient should remember"
  ],
  "questions_patient_might_ask": [
    {
      "question": "A question the patient might have",
      "simple_answer": "Easy-to-understand answer"
    }
  ],
  "encouraging_closing": "A supportive, encouraging closing statement",
  "speaking_script": "A conversational script the nurse can use when explaining this to the patient"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            opening_hook: { type: "string" },
            simplified_explanation: { type: "string" },
            key_analogies: { type: "array", items: { type: "object" } },
            common_concerns_addressed: { type: "array", items: { type: "object" } },
            key_takeaways: { type: "array", items: { type: "string" } },
            questions_patient_might_ask: { type: "array", items: { type: "object" } },
            encouraging_closing: { type: "string" },
            speaking_script: { type: "string" }
          }
        }
      });

      setExplanation(result);
    } catch (error) {
      console.error("Error generating explanation:", error);
      toast.error("Error generating explanation. Please try again.");
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" />
          AI Simplified Explanation Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="bg-navy-50 p-3 rounded-lg border border-navy-200 text-sm text-navy-800">
          <Lightbulb className="w-4 h-4 inline mr-1" />
          Enter complex medical information and AI will transform it into simple, patient-friendly language with analogies.
        </div>

        {/* Input Section */}
        <div className="space-y-3">
          <div>
            <Label>Medical Information to Simplify</Label>
            <Textarea
              value={nurseInput}
              onChange={(e) => setNurseInput(e.target.value)}
              placeholder="Enter the medical condition, treatment plan, or procedure you need to explain to the patient. Include any technical details - AI will simplify them.

Example: 'Patient has CHF with reduced ejection fraction of 35%. Needs to understand the importance of daily weights, sodium restriction, and taking Lasix as prescribed to prevent fluid overload and hospitalizations.'"
              rows={4}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Explanation Type</Label>
              <Select value={explanationType} onValueChange={setExplanationType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {explanationTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.icon} {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Simplification Level</Label>
              <Select value={simplificationLevel} onValueChange={setSimplificationLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {simplificationLevels.map((level) => (
                    <SelectItem key={level.value} value={level.value}>
                      {level.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={generateExplanation}
            disabled={ai.loading || !nurseInput.trim()}
            className="w-full bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Simple Explanation...</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Generate Patient-Friendly Explanation</>
            )}
          </Button>
        </div>

        {/* Generated Explanation */}
        {explanation && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">{explanation.title}</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(explanation.speaking_script)}
              >
                {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>

            {/* Opening Hook */}
            <div className="bg-green-50 p-3 rounded-lg border border-green-200">
              <p className="text-green-800 italic">"{explanation.opening_hook}"</p>
            </div>

            {/* Main Explanation */}
            <div className="bg-white p-4 rounded-lg border">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-600" />
                Simple Explanation
              </h4>
              <p className="text-slate-700 whitespace-pre-line">{explanation.simplified_explanation}</p>
            </div>

            {/* Analogies */}
            {explanation.key_analogies?.length > 0 && (
              <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                <h4 className="font-semibold mb-3 text-yellow-900">💡 Helpful Analogies</h4>
                <div className="space-y-3">
                  {explanation.key_analogies.map((analogy, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border border-yellow-200">
                      <p className="text-sm">
                        <span className="font-medium text-slate-700">{analogy.medical_concept}:</span>
                      </p>
                      <p className="text-yellow-800 mt-1">"{analogy.simple_analogy}"</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Common Concerns */}
            {explanation.common_concerns_addressed?.length > 0 && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h4 className="font-semibold mb-3 text-blue-900">🤔 Addressing Common Concerns</h4>
                <div className="space-y-2">
                  {explanation.common_concerns_addressed.map((concern, idx) => (
                    <div key={idx} className="text-sm">
                      <p className="font-medium text-blue-800">"{concern.concern}"</p>
                      <p className="text-blue-700 ml-4">→ {concern.reassurance}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Key Takeaways */}
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <h4 className="font-semibold mb-2 text-green-900">✅ Key Takeaways</h4>
              <ul className="space-y-1">
                {explanation.key_takeaways?.map((takeaway, idx) => (
                  <li key={idx} className="text-sm text-green-800 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    {takeaway}
                  </li>
                ))}
              </ul>
            </div>

            {/* Speaking Script */}
            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-indigo-900 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  Speaking Script
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(explanation.speaking_script)}
                  className="h-7 text-xs"
                >
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
              </div>
              <p className="text-sm text-indigo-800 italic whitespace-pre-line">
                "{explanation.speaking_script}"
              </p>
            </div>

            {/* Encouraging Closing */}
            <div className="bg-gold-50 p-3 rounded-lg border border-gold-200 text-center">
              <p className="text-gold-800 font-medium">{explanation.encouraging_closing}</p>
            </div>

            {/* Regenerate */}
            <Button
              variant="outline"
              onClick={() => setExplanation(null)}
              className="w-full"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Generate New Explanation
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}