import React from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  TrendingUp
} from "lucide-react";

const PRACTICE_SCENARIOS = [
  {
    id: "chf-routine",
    title: "CHF Routine Visit",
    difficulty: "beginner",
    scenario: "Patient: Mary Johnson, 78yo female with CHF\nVisit Type: Routine skilled nursing visit\nVitals: BP 142/88, HR 82, RR 18, O2 92% on room air, Weight 165lbs (up 3lbs from last visit)\nAssessment: Patient reports increased shortness of breath with minimal exertion over past 3 days. +1 pitting edema bilateral ankles (previously trace). Lung sounds with bilateral crackles at bases. Patient states she \"forgot\" to take Lasix yesterday.\n\nYour task: Write a visit note documenting this visit."
  },
  {
    id: "wound-care",
    title: "Post-Surgical Wound Care",
    difficulty: "intermediate",
    scenario: "Patient: Robert Chen, 65yo male s/p abdominal surgery 2 weeks ago\nVisit Type: Skilled nursing for wound assessment and care\nWound: Midline abdominal incision, 18cm length. Wound edges approximated, no erythema or warmth. Minimal serous drainage on dressing. No odor. Staples intact.\nVitals: BP 128/76, HR 72, Temp 98.6°F\nPatient reports pain 3/10 at incision site, controlled with Tylenol.\n\nYour task: Write a skilled nursing wound care visit note."
  }
];

export default function PracticeNoteSubmission({ userEmail, onSubmit }) {
  const [selectedScenario, setSelectedScenario] = React.useState(null);
  const [practiceNote, setPracticeNote] = React.useState("");
  const ai = useAICall();
  const [feedback, setFeedback] = React.useState(null);

  const handleSubmitPractice = async () => {
    if (!practiceNote.trim() || !selectedScenario) return;

    try {
      const prompt = `You are an expert clinical documentation instructor. A nurse has written a practice visit note for the following scenario. Provide detailed, constructive feedback.

SCENARIO:
${selectedScenario.scenario}

NURSE'S NOTE:
${practiceNote}

ANALYZE THE NOTE FOR:
1. Homebound Status Documentation (Is it clear, specific, and well-justified?)
2. Skilled Need Justification (Does it show why RN skills are required?)
3. Patient Response (Is patient/caregiver response documented?)
4. Clinical Assessment (Are observations specific and measurable?)
5. Compliance Elements (Does it meet Medicare requirements?)
6. Medical Terminology (Is professional language used appropriately?)

PROVIDE:
- Overall score (0-100)
- Strengths (what was done well)
- Areas for improvement (specific gaps or weaknesses)
- Specific suggestions for improvement
- Revised examples showing how to improve weak sections

Return JSON with:
{
  "overall_score": number,
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": [
    {
      "category": "homebound|skilled_need|patient_response|assessment|compliance|terminology",
      "issue": "What's wrong",
      "suggestion": "How to fix it",
      "example": "Example of improved text"
    }
  ],
  "compliance_score": number,
  "clinical_detail_score": number,
  "summary": "Brief overall assessment"
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_score: { type: "number" },
            strengths: { type: "array", items: { type: "string" } },
            weaknesses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  issue: { type: "string" },
                  suggestion: { type: "string" },
                  example: { type: "string" }
                }
              }
            },
            compliance_score: { type: "number" },
            clinical_detail_score: { type: "number" },
            summary: { type: "string" }
          }
        }
      });

      setFeedback(result);

      // Save practice submission
      await base44.entities.MicroLearningProgress.create({
        nurse_email: userEmail,
        skill_area: "clinical_documentation",
        module_type: "practice_exercise",
        status: "completed",
        score: result.overall_score,
        content: {
          scenario_id: selectedScenario.id,
          practice_note: practiceNote,
          feedback: result
        }
      });

      onSubmit?.();
    } catch (error) {
      console.error('Error analyzing practice note:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  if (!selectedScenario) {
    return (
      <div className="space-y-4">
        <Card className="border-indigo-200 bg-indigo-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Lightbulb className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-1" />
              <div>
                <p className="font-medium text-indigo-900 mb-1">Practice Makes Perfect</p>
                <p className="text-sm text-indigo-700">
                  Select a scenario below, write your visit note, and receive detailed AI-powered feedback on compliance, clinical detail, and documentation quality.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {PRACTICE_SCENARIOS.map((scenario) => (
            <Card key={scenario.id} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setSelectedScenario(scenario)}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold">{scenario.title}</h3>
                      <Badge>{scenario.difficulty}</Badge>
                    </div>
                    <div className="text-sm text-slate-600 whitespace-pre-line">
                      {scenario.scenario.split('\n').slice(0, 3).join('\n')}...
                    </div>
                  </div>
                  <Button onClick={() => setSelectedScenario(scenario)}>
                    Start Practice
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {selectedScenario.title}
                <Badge>{selectedScenario.difficulty}</Badge>
              </CardTitle>
            </div>
            <Button variant="outline" onClick={() => {
              setSelectedScenario(null);
              setPracticeNote("");
              setFeedback(null);
            }}>
              Back to Scenarios
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Card className="bg-slate-50 border-slate-200 mb-4">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-slate-900 mb-2">Scenario:</p>
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">
                {selectedScenario.scenario}
              </pre>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div>
              <label htmlFor="practice-note" className="text-sm font-medium mb-2 block">Write Your Visit Note:</label>
              <Textarea
                id="practice-note"
                value={practiceNote}
                onChange={(e) => setPracticeNote(e.target.value)}
                placeholder="Document this visit as if you were writing a real visit note in your EHR..."
                className="min-h-[300px] font-mono text-sm"
                disabled={!!feedback}
              />
              <p className="text-xs text-slate-500 mt-1">{practiceNote.length} characters</p>
            </div>

            {!feedback && (
              <Button
                onClick={handleSubmitPractice}
                disabled={ai.loading || practiceNote.length < 100}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
              >
                {ai.loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing Your Note...</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> Submit for AI Feedback</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {feedback && (
        <Card className="border-2 border-indigo-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
              AI Feedback & Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Overall Score */}
            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-indigo-200">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-indigo-600 mb-1">Overall Score</p>
                  <p className="text-3xl font-bold text-indigo-900">{Math.round(feedback.overall_score)}%</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-green-600 mb-1">Compliance</p>
                  <p className="text-3xl font-bold text-green-900">{Math.round(feedback.compliance_score)}%</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-navy-50 to-gold-50 border-navy-200">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-navy-600 mb-1">Clinical Detail</p>
                  <p className="text-3xl font-bold text-navy-900">{Math.round(feedback.clinical_detail_score)}%</p>
                </CardContent>
              </Card>
            </div>

            {/* Summary */}
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-sm text-blue-900">
                <strong>Summary:</strong> {feedback.summary}
              </AlertDescription>
            </Alert>

            {/* Strengths */}
            {feedback.strengths?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-green-900 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Strengths
                </h4>
                <div className="space-y-2">
                  {feedback.strengths.map((strength, idx) => (
                    <Card key={idx} className="bg-green-50 border-green-200">
                      <CardContent className="p-3">
                        <p className="text-sm text-green-900">✓ {strength}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Areas for Improvement */}
            {feedback.weaknesses?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-orange-900 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Areas for Improvement
                </h4>
                <ScrollArea className="h-96">
                  <div className="space-y-3 pr-4">
                    {feedback.weaknesses.map((weakness, idx) => (
                      <Card key={idx} className="bg-orange-50 border-orange-200">
                        <CardContent className="p-4 space-y-2">
                          <Badge className="bg-orange-600">{(weakness.category || '').replace(/_/g, ' ')}</Badge>
                          <p className="text-sm font-medium text-slate-900">{weakness.issue}</p>
                          <div className="bg-white p-3 rounded border border-orange-200">
                            <p className="text-xs font-medium text-slate-700 mb-1">💡 Suggestion:</p>
                            <p className="text-xs text-slate-800">{weakness.suggestion}</p>
                          </div>
                          <div className="bg-white p-3 rounded border border-green-200">
                            <p className="text-xs font-medium text-green-700 mb-1">✏️ Example:</p>
                            <p className="text-xs text-slate-800 italic">{weakness.example}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            <Button
              onClick={() => {
                setSelectedScenario(null);
                setPracticeNote("");
                setFeedback(null);
              }}
              className="w-full"
            >
              Try Another Scenario
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}