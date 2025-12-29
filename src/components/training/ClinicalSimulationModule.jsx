import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Play,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  User,
  MessageSquare,
  FileText,
  RotateCcw,
  ArrowRight,
  Star,
  Lightbulb
} from "lucide-react";

const simulationScenarios = [
  {
    id: "homebound",
    title: "Homebound Status Documentation",
    description: "Document homebound status for a CHF patient",
    difficulty: "Medium",
    category: "Documentation"
  },
  {
    id: "family_conflict",
    title: "Family Disagreement",
    description: "Handle conflicting care wishes between patient and family",
    difficulty: "Hard",
    category: "Communication"
  },
  {
    id: "medication_error",
    title: "Medication Discrepancy",
    description: "Address a medication reconciliation issue",
    difficulty: "Medium",
    category: "Safety"
  },
  {
    id: "declining_patient",
    title: "Clinical Decline Recognition",
    description: "Assess and document signs of patient deterioration",
    difficulty: "Hard",
    category: "Clinical"
  },
  {
    id: "teach_back",
    title: "Patient Education",
    description: "Teach diabetes management using teach-back method",
    difficulty: "Easy",
    category: "Communication"
  },
  {
    id: "incident_report",
    title: "Fall Incident",
    description: "Document and respond to a patient fall",
    difficulty: "Medium",
    category: "Safety"
  }
];

export default function ClinicalSimulationModule({ nurseEmail, onSimulationCompleted }) {
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [simulation, setSimulation] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [userResponses, setUserResponses] = useState([]);
  const [currentResponse, setCurrentResponse] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [finalScore, setFinalScore] = useState(null);

  const generateSimulation = async (scenario) => {
    setIsGenerating(true);
    setSelectedScenario(scenario);
    
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Create an interactive clinical simulation for home health nurses.

SCENARIO: ${scenario.title}
DESCRIPTION: ${scenario.description}
CATEGORY: ${scenario.category}
DIFFICULTY: ${scenario.difficulty}

Generate a realistic simulation with:

1. **PATIENT PROFILE**: Name, age, diagnosis, relevant history
2. **SETTING**: Time, location, circumstances
3. **INITIAL SITUATION**: What the nurse encounters
4. **DECISION POINTS**: 4-5 steps where nurse must respond/document/decide
5. **EVALUATION CRITERIA**: What makes a good response at each step

For each decision point, provide:
- The situation/prompt
- Key considerations
- What information is available
- What the ideal response includes

Make it realistic, educational, and clinically accurate.`,
        response_json_schema: {
          type: "object",
          properties: {
            patient_profile: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "number" },
                diagnosis: { type: "string" },
                history: { type: "string" },
                current_medications: { type: "array", items: { type: "string" } }
              }
            },
            setting: { type: "string" },
            initial_situation: { type: "string" },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step_number: { type: "number" },
                  situation: { type: "string" },
                  prompt: { type: "string" },
                  available_info: { type: "array", items: { type: "string" } },
                  key_considerations: { type: "array", items: { type: "string" } },
                  ideal_response_elements: { type: "array", items: { type: "string" } },
                  response_type: { type: "string" }
                }
              }
            },
            learning_objectives: { type: "array", items: { type: "string" } }
          }
        }
      });

      setSimulation(result);
      setCurrentStep(0);
      setUserResponses([]);
      setFeedback(null);
      setCompleted(false);
      setFinalScore(null);
    } catch (error) {
      console.error("Error generating simulation:", error);
    }
    setIsGenerating(false);
  };

  const evaluateResponse = async () => {
    if (!currentResponse.trim()) return;
    
    setIsEvaluating(true);
    const step = simulation.steps[currentStep];
    
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Evaluate this nurse's response in a clinical simulation.

SCENARIO CONTEXT:
Patient: ${simulation.patient_profile.name}, ${simulation.patient_profile.age}yo, ${simulation.patient_profile.diagnosis}
Situation: ${step.situation}
Prompt: ${step.prompt}

IDEAL RESPONSE SHOULD INCLUDE:
${step.ideal_response_elements.map((e, i) => `${i + 1}. ${e}`).join('\n')}

NURSE'S RESPONSE:
"${currentResponse}"

Evaluate the response and provide:
1. Score (0-100)
2. What was done well
3. What was missing or could be improved
4. Specific suggestions
5. Clinical teaching point

Be constructive and educational.`,
        response_json_schema: {
          type: "object",
          properties: {
            score: { type: "number" },
            strengths: { type: "array", items: { type: "string" } },
            improvements: { type: "array", items: { type: "string" } },
            suggestions: { type: "string" },
            teaching_point: { type: "string" },
            met_criteria: { type: "array", items: { type: "string" } },
            missed_criteria: { type: "array", items: { type: "string" } }
          }
        }
      });

      setFeedback(result);
      setUserResponses(prev => [...prev, {
        step: currentStep,
        response: currentResponse,
        feedback: result
      }]);
    } catch (error) {
      console.error("Error evaluating response:", error);
    }
    setIsEvaluating(false);
  };

  const nextStep = () => {
    if (currentStep < simulation.steps.length - 1) {
      setCurrentStep(prev => prev + 1);
      setCurrentResponse("");
      setFeedback(null);
    } else {
      completeSimulation();
    }
  };

  const completeSimulation = async () => {
    const totalScore = userResponses.reduce((sum, r) => sum + (r.feedback?.score || 0), 0);
    const avgScore = Math.round(totalScore / simulation.steps.length);
    
    setFinalScore(avgScore);
    setCompleted(true);
    
    onSimulationCompleted?.({
      scenario: selectedScenario.title,
      score: avgScore,
      steps: simulation.steps.length,
      responses: userResponses
    });
  };

  const resetSimulation = () => {
    setSelectedScenario(null);
    setSimulation(null);
    setCurrentStep(0);
    setUserResponses([]);
    setCurrentResponse("");
    setFeedback(null);
    setCompleted(false);
    setFinalScore(null);
  };

  // Scenario Selection
  if (!selectedScenario) {
    return (
      <div className="space-y-4">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Clinical Simulations</h2>
          <p className="text-sm text-gray-600">Practice real-world scenarios with AI-powered feedback</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {simulationScenarios.map((scenario) => (
            <Card
              key={scenario.id}
              className="cursor-pointer hover:shadow-lg transition-all hover:border-purple-300 overflow-hidden"
              onClick={() => generateSimulation(scenario)}
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Play className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                      <h3 className="font-semibold text-gray-900 text-sm sm:text-base break-words">{scenario.title}</h3>
                      <Badge variant="outline" className={`text-xs flex-shrink-0 w-fit ${
                        scenario.difficulty === 'Hard' ? 'bg-red-50 text-red-700' :
                        scenario.difficulty === 'Medium' ? 'bg-yellow-50 text-yellow-700' :
                        'bg-green-50 text-green-700'
                      }`}>
                        {scenario.difficulty}
                      </Badge>
                    </div>
                    <p className="text-xs sm:text-sm text-gray-600 break-words">{scenario.description}</p>
                    <Badge variant="outline" className="mt-2 text-xs w-fit">{scenario.category}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Loading
  if (isGenerating) {
    return (
      <Card className="border-2 border-purple-200 bg-purple-50">
        <CardContent className="p-12 text-center">
          <Loader2 className="w-12 h-12 animate-spin text-purple-600 mx-auto mb-4" />
          <p className="text-lg font-medium text-purple-900">Creating Simulation...</p>
          <p className="text-sm text-purple-700 mt-2">Building a realistic {selectedScenario.title} scenario</p>
        </CardContent>
      </Card>
    );
  }

  // Completed
  if (completed) {
    const passed = finalScore >= 70;
    
    return (
      <Card className={`border-2 ${passed ? 'border-green-300 bg-green-50' : 'border-orange-300 bg-orange-50'}`}>
        <CardContent className="p-8 text-center">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${
            passed ? 'bg-green-100' : 'bg-orange-100'
          }`}>
            <Star className={`w-10 h-10 ${passed ? 'text-green-600' : 'text-orange-600'}`} />
          </div>
          
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Simulation Complete!</h2>
          
          <Badge className={`text-xl px-6 py-2 mb-4 ${passed ? 'bg-green-600' : 'bg-orange-600'}`}>
            Final Score: {finalScore}%
          </Badge>

          <div className="text-left bg-white rounded-lg p-4 mb-6 max-h-60 overflow-auto">
            <h3 className="font-semibold text-gray-900 mb-3">Step-by-Step Review:</h3>
            {userResponses.map((r, idx) => (
              <div key={idx} className="mb-3 pb-3 border-b last:border-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">Step {idx + 1}</span>
                  <Badge className={r.feedback?.score >= 70 ? 'bg-green-500' : 'bg-orange-500'}>
                    {r.feedback?.score}%
                  </Badge>
                </div>
                <p className="text-xs text-gray-600">{r.feedback?.teaching_point}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={resetSimulation}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Try Another Simulation
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Active Simulation
  const step = simulation?.steps[currentStep];

  return (
    <div className="space-y-4">
      {/* Patient Info Card */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-200 rounded-full flex items-center justify-center">
              <User className="w-6 h-6 text-blue-700" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{simulation?.patient_profile.name}, {simulation?.patient_profile.age} y/o</h3>
              <p className="text-sm text-gray-700">{simulation?.patient_profile.diagnosis}</p>
              <p className="text-xs text-gray-600 mt-1">{simulation?.patient_profile.history}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Step */}
      <Card className="border-2 border-purple-200">
        <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-purple-600" />
              Step {currentStep + 1} of {simulation?.steps.length}
            </CardTitle>
            <Badge variant="outline">{step?.response_type}</Badge>
          </div>
        </CardHeader>
        
        <CardContent className="p-4 space-y-4">
          {/* Situation */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-800">{step?.situation}</p>
          </div>

          {/* Prompt */}
          <Alert className="bg-purple-50 border-purple-200">
            <FileText className="w-4 h-4 text-purple-600" />
            <AlertDescription className="text-purple-900 font-medium">
              {step?.prompt}
            </AlertDescription>
          </Alert>

          {/* Available Info */}
          {step?.available_info?.length > 0 && (
            <div className="text-sm">
              <p className="font-medium text-gray-700 mb-1">Available Information:</p>
              <ul className="space-y-1">
                {step.available_info.map((info, idx) => (
                  <li key={idx} className="text-xs text-gray-600">• {info}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Response Input */}
          {!feedback && (
            <>
              <Textarea
                value={currentResponse}
                onChange={(e) => setCurrentResponse(e.target.value)}
                placeholder="Type your response here..."
                rows={6}
                className="mt-4"
              />
              <Button
                onClick={evaluateResponse}
                disabled={!currentResponse.trim() || isEvaluating}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {isEvaluating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Evaluating...</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Submit Response</>
                )}
              </Button>
            </>
          )}

          {/* Feedback */}
          {feedback && (
            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-gray-900">Feedback</h4>
                <Badge className={feedback.score >= 70 ? 'bg-green-600' : 'bg-orange-600'}>
                  Score: {feedback.score}%
                </Badge>
              </div>

              {/* Strengths */}
              {feedback.strengths?.length > 0 && (
                <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                  <p className="text-xs font-semibold text-green-800 mb-1">✓ What You Did Well:</p>
                  <ul className="space-y-1">
                    {feedback.strengths.map((s, idx) => (
                      <li key={idx} className="text-xs text-green-700">• {s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Improvements */}
              {feedback.improvements?.length > 0 && (
                <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
                  <p className="text-xs font-semibold text-orange-800 mb-1">Areas for Improvement:</p>
                  <ul className="space-y-1">
                    {feedback.improvements.map((i, idx) => (
                      <li key={idx} className="text-xs text-orange-700">• {i}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Teaching Point */}
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <p className="text-xs font-semibold text-blue-800 mb-1 flex items-center gap-1">
                  <Lightbulb className="w-3 h-3" /> Clinical Teaching Point:
                </p>
                <p className="text-xs text-blue-700">{feedback.teaching_point}</p>
              </div>

              <Button onClick={nextStep} className="w-full bg-green-600 hover:bg-green-700">
                {currentStep < simulation.steps.length - 1 ? (
                  <>Continue to Next Step <ArrowRight className="w-4 h-4 ml-2" /></>
                ) : (
                  <>Complete Simulation <CheckCircle2 className="w-4 h-4 ml-2" /></>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Button variant="outline" onClick={resetSimulation} className="w-full">
        Exit Simulation
      </Button>
    </div>
  );
}