import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Lightbulb,
  ArrowRight,
  RefreshCw,
  Trophy
} from "lucide-react";

const scenarioTemplates = [
  {
    id: 'homebound_justification',
    title: 'Homebound Status Justification',
    category: 'compliance',
    difficulty: 'medium',
    description: 'Practice documenting why a patient qualifies as homebound',
    scenario: 'Patient is an 82-year-old female with CHF, COPD, and severe arthritis. She lives alone and uses a walker. Document her homebound status.',
    requiredElements: [
      'taxing effort to leave home',
      'assistance needed',
      'medical reason',
      'frequency of leaving home'
    ],
    goodExample: 'Patient is homebound due to severe dyspnea on exertion secondary to CHF and COPD, requiring supplemental oxygen at 2L continuously. Ambulation limited to 15 feet with walker before becoming short of breath. Requires assistance from daughter to leave home for medical appointments. Leaves home only 1-2 times per month for physician visits. It is a taxing effort for patient to leave home.',
    commonErrors: [
      'Not mentioning medical reason for homebound status',
      'Missing "taxing effort" language',
      'Not documenting assistance needed',
      'Vague or general statements'
    ]
  },
  {
    id: 'skilled_need',
    title: 'Skilled Nursing Need Documentation',
    category: 'clinical',
    difficulty: 'medium',
    description: 'Document why skilled nursing is required',
    scenario: 'Patient has a stage 3 pressure ulcer on coccyx and complex medication regimen including insulin. Document the skilled need.',
    requiredElements: [
      'complexity of care',
      'teaching need',
      'observation and assessment',
      'skilled intervention'
    ],
    goodExample: 'Skilled nursing required for comprehensive wound assessment and management of stage 3 pressure ulcer with undermining, requiring specialized wound care techniques and evaluation for signs of infection. Patient requires teaching for complex insulin sliding scale management and demonstration of proper injection technique. Ongoing assessment of wound healing progression and adjustment of treatment plan as needed.',
    commonErrors: [
      'Focusing only on tasks, not skill required',
      'Not explaining complexity',
      'Missing teaching components',
      'Vague assessment language'
    ]
  },
  {
    id: 'vital_signs',
    title: 'Vital Signs Documentation',
    category: 'clinical',
    difficulty: 'easy',
    description: 'Document vital signs with clinical interpretation',
    scenario: 'During visit, patient\'s BP is 168/94, HR 88, RR 22, O2 sat 91% on room air, temp 98.6°F. Patient has history of hypertension.',
    requiredElements: [
      'all vital signs recorded',
      'clinical significance',
      'comparison to baseline',
      'intervention or plan'
    ],
    goodExample: 'Vital signs obtained: BP 168/94 (elevated from baseline of 130/80), HR 88 regular, RR 22 slightly tachypneic, O2 saturation 91% on room air (below patient\'s baseline of 95%), temperature 98.6°F afebrile. Elevated blood pressure discussed with patient regarding medication compliance. Patient reports missing 2 doses this week. Reinforced importance of daily medication adherence. Will monitor at next visit and notify physician if remains elevated.',
    commonErrors: [
      'Only listing numbers without interpretation',
      'Not comparing to baseline',
      'Missing follow-up plan',
      'Not addressing abnormal findings'
    ]
  },
  {
    id: 'patient_response',
    title: 'Patient Response to Teaching',
    category: 'teaching',
    difficulty: 'easy',
    description: 'Document patient education and response',
    scenario: 'You taught the patient about low-sodium diet for CHF management. Document the teaching and patient response.',
    requiredElements: [
      'specific content taught',
      'method of teaching',
      'patient understanding',
      'barriers identified',
      'plan for reinforcement'
    ],
    goodExample: 'Patient educated on low-sodium diet for CHF management using American Heart Association handouts. Reviewed sodium content in common foods and reading nutrition labels. Patient able to identify 3 high-sodium foods to avoid. Verbalized understanding of 2000mg daily sodium limit. Patient expressed concern about meal preparation, daughter present and agrees to assist with grocery shopping. Will reassess understanding at next visit and provide additional resources as needed.',
    commonErrors: [
      'Vague "patient instructed" statements',
      'Not documenting patient\'s actual understanding',
      'Missing teach-back confirmation',
      'Not addressing barriers to learning'
    ]
  }
];

export default function InteractiveDocumentationScenarios({ nurseEmail, _recommendations = [], initialScenarioId = null }) {
  const queryClient = useQueryClient();
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [userResponse, setUserResponse] = useState("");
  const [feedback, setFeedback] = useState(null);
  const ai = useAICall();
  const [showHint, setShowHint] = useState(false);

  // Auto-select scenario if provided
  React.useEffect(() => {
    if (initialScenarioId && !selectedScenario) {
      const scenario = scenarioTemplates.find(s => s.id === initialScenarioId);
      if (scenario) {
        handleStartScenario(scenario);
      }
    }
  }, [initialScenarioId, selectedScenario]);

  const savePracticeMutation = useMutation({
    mutationFn: async (practiceData) => {
      return base44.entities.MicroLearningProgress.create(practiceData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTrainingProgress'] });
    }
  });

  const handleStartScenario = (scenario) => {
    setSelectedScenario(scenario);
    setUserResponse("");
    setFeedback(null);
    setShowHint(false);
  };

  const handleSubmitResponse = async () => {
    if (!userResponse.trim() || !selectedScenario) return;

    try {
      const prompt = `You are an expert nursing documentation reviewer. Analyze this nurse's documentation for a practice scenario.

SCENARIO: ${selectedScenario.scenario}

REQUIRED ELEMENTS: ${selectedScenario.requiredElements.join(', ')}

NURSE'S DOCUMENTATION:
${userResponse}

GOOD EXAMPLE FOR REFERENCE:
${selectedScenario.goodExample}

Provide detailed feedback in JSON format:
{
  "score": 0-100,
  "elementsPresent": ["list of required elements found"],
  "elementsMissing": ["list of required elements missing"],
  "strengths": ["specific positive aspects"],
  "improvements": ["specific suggestions for improvement"],
  "overallFeedback": "2-3 sentence summary",
  "passed": boolean (true if score >= 70)
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            score: { type: "number" },
            elementsPresent: { type: "array", items: { type: "string" } },
            elementsMissing: { type: "array", items: { type: "string" } },
            strengths: { type: "array", items: { type: "string" } },
            improvements: { type: "array", items: { type: "string" } },
            overallFeedback: { type: "string" },
            passed: { type: "boolean" }
          }
        }
      });

      setFeedback(result);

      // Save practice progress
      if (nurseEmail) {
        await savePracticeMutation.mutateAsync({
          nurse_email: nurseEmail,
          skill_area: selectedScenario.title,
          module_type: 'practice_exercise',
          content: {
            scenario_id: selectedScenario.id,
            user_response: userResponse,
            feedback: result
          },
          status: result.passed ? 'completed' : 'needs_review',
          score: result.score,
          attempts: 1,
          source: 'manual'
        });
      }
    } catch (error) {
      console.error("Error analyzing response:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const handleReset = () => {
    setUserResponse("");
    setFeedback(null);
    setShowHint(false);
  };

  const handleNewScenario = () => {
    setSelectedScenario(null);
    setUserResponse("");
    setFeedback(null);
    setShowHint(false);
  };

  if (!selectedScenario) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            Choose a Practice Scenario
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scenarioTemplates.map((scenario) => (
              <Card key={scenario.id} className="hover:shadow-lg transition-all cursor-pointer" onClick={() => handleStartScenario(scenario)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <Badge className={
                      scenario.difficulty === 'easy' ? 'bg-green-100 text-green-800' :
                      scenario.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }>
                      {scenario.difficulty}
                    </Badge>
                    <Badge variant="outline">{scenario.category}</Badge>
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{scenario.title}</h3>
                  <p className="text-sm text-slate-600 mb-3">{scenario.description}</p>
                  <Button size="sm" className="w-full">
                    Start Practice <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-r from-indigo-50 to-navy-50 border-indigo-200">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 mb-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                {selectedScenario.title}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge className={
                  selectedScenario.difficulty === 'easy' ? 'bg-green-100 text-green-800' :
                  selectedScenario.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-red-100 text-red-800'
                }>
                  {selectedScenario.difficulty}
                </Badge>
                <Badge variant="outline">{selectedScenario.category}</Badge>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleNewScenario}>
              Choose Different Scenario
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="bg-white p-4 rounded-lg border border-indigo-200">
            <h4 className="font-semibold text-slate-900 mb-2">Scenario:</h4>
            <p className="text-slate-700">{selectedScenario.scenario}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your Documentation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={userResponse}
            onChange={(e) => setUserResponse(e.target.value)}
            placeholder="Type your documentation here..."
            className="min-h-[200px]"
            disabled={!!feedback}
          />

          {!feedback && (
            <div className="flex gap-2">
              <Button 
                onClick={handleSubmitResponse}
                disabled={!userResponse.trim() || ai.loading}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {ai.loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    Submit for Review
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={() => setShowHint(!showHint)}>
                <Lightbulb className="w-4 h-4 mr-2" />
                {showHint ? 'Hide' : 'Show'} Hint
              </Button>
              <Button variant="ghost" onClick={handleReset}>
                Reset
              </Button>
            </div>
          )}

          {showHint && !feedback && (
            <Alert className="bg-amber-50 border-amber-200">
              <Lightbulb className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-900">
                <strong>Required Elements:</strong>
                <ul className="list-disc ml-5 mt-2 space-y-1">
                  {selectedScenario.requiredElements.map((element, idx) => (
                    <li key={idx}>{element}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {feedback && (
        <Card className={feedback.passed ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {feedback.passed ? (
                  <>
                    <Trophy className="w-5 h-5 text-green-600" />
                    <span className="text-green-900">Great Job!</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5 text-orange-600" />
                    <span className="text-orange-900">Needs Improvement</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{feedback.score}%</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Progress value={feedback.score} className="h-2" />
            </div>

            <div className="bg-white p-4 rounded-lg border">
              <p className="text-slate-700">{feedback.overallFeedback}</p>
            </div>

            {feedback.elementsPresent?.length > 0 && (
              <div className="bg-white p-4 rounded-lg border border-green-200">
                <h4 className="font-semibold text-green-900 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  What You Did Well
                </h4>
                <ul className="space-y-1">
                  {feedback.elementsPresent.map((item, idx) => (
                    <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                      <CheckCircle2 className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {feedback.elementsMissing?.length > 0 && (
              <div className="bg-white p-4 rounded-lg border border-orange-200">
                <h4 className="font-semibold text-orange-900 mb-2 flex items-center gap-2">
                  <XCircle className="w-4 h-4" />
                  Missing Elements
                </h4>
                <ul className="space-y-1">
                  {feedback.elementsMissing.map((item, idx) => (
                    <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                      <XCircle className="w-3 h-3 text-orange-600 mt-0.5 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {feedback.improvements?.length > 0 && (
              <div className="bg-white p-4 rounded-lg border border-blue-200">
                <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4" />
                  Suggestions for Improvement
                </h4>
                <ul className="space-y-2">
                  {feedback.improvements.map((item, idx) => (
                    <li key={idx} className="text-sm text-slate-700">{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <h4 className="font-semibold text-slate-900 mb-2">Good Example:</h4>
              <p className="text-sm text-slate-700 italic">{selectedScenario.goodExample}</p>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleNewScenario} className="bg-indigo-600 hover:bg-indigo-700">
                Try Another Scenario
              </Button>
              <Button variant="outline" onClick={handleReset}>
                Try This One Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}