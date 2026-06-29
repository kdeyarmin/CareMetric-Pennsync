import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lightbulb,
  Award,
  TrendingUp,
  Loader2
} from "lucide-react";

export default function InteractiveSimulation({ scenario, onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [responses, setResponses] = useState({});
  const [feedback, setFeedback] = useState({});
  const [showResults, setShowResults] = useState(false);
  const [score, setScore] = useState(0);
  const ai = useAICall();
  const [evalError, setEvalError] = useState(null);

  const steps = scenario?.steps || [];
  
  // Safety check
  if (!scenario || !steps || steps.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-slate-500">
          No simulation steps available for this module.
        </CardContent>
      </Card>
    );
  }
  const currentStepData = steps[currentStep];

  const handleResponseSubmit = async () => {
    const response = responses[currentStep];
    if (!response || ai.loading) return;

    setEvalError(null);

    try {
      // Evaluate the nurse's response against Medicare home health documentation
      // standards using the LLM integration (replaces the prior random placeholder).
      const evaluation = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a Medicare home health documentation expert evaluating a nurse's response in a clinical documentation training simulation.

SCENARIO: ${scenario.title || "Clinical documentation simulation"}
SCENARIO CONTEXT: ${scenario.description || "N/A"}

STEP: ${currentStepData?.title || ""}
TASK GIVEN TO NURSE: ${currentStepData?.prompt || ""}

NURSE'S RESPONSE:
"""${response}"""

Evaluate whether the response meets Medicare home health documentation standards. Assess: skilled-need justification, clinical specificity, objective/measurable findings, homebound support where relevant, and overall accuracy. Pass the step only when the response is clinically adequate and audit-defensible. Provide concrete, educational feedback.`,
        response_json_schema: {
          type: "object",
          properties: {
            correct: { type: "boolean" },
            message: { type: "string" },
            suggestions: { type: "array", items: { type: "string" } }
          },
          required: ["correct", "message"]
        }
      });

      const stepFeedback = {
        correct: !!evaluation?.correct,
        message:
          evaluation?.message ||
          (evaluation?.correct
            ? "Your documentation meets Medicare standards."
            : "This could be improved. Consider adding more specific clinical detail."),
        suggestions: Array.isArray(evaluation?.suggestions) ? evaluation.suggestions : []
      };

      const updatedFeedback = { ...feedback, [currentStep]: stepFeedback };
      setFeedback(updatedFeedback);

      if (currentStep < steps.length - 1) {
        setTimeout(() => {
          setCurrentStep(prev => prev + 1);
        }, 2000);
      } else {
        // Calculate final score from the AI evaluations of every step.
        const correctCount = Object.values(updatedFeedback).filter(f => f.correct).length;
        const finalScore = Math.round((correctCount / steps.length) * 100);
        setScore(finalScore);
        setShowResults(true);
      }
    } catch (error) {
      // Don't fabricate a result on failure — let the learner retry.
      console.error("Error evaluating simulation response:", error);
      setEvalError("We couldn't evaluate your response just now. Please try submitting again.");
    }
  };

  const handleInputChange = (value) => {
    setResponses({ ...responses, [currentStep]: value });
  };

  if (showResults) {
    return (
      <Card className={`border-2 ${score >= 80 ? 'border-green-500 bg-green-50' : 'border-yellow-500 bg-yellow-50'}`}>
        <CardContent className="p-6">
          <div className="text-center mb-6">
            {score >= 80 ? (
              <Award className="w-16 h-16 text-green-600 mx-auto mb-3" />
            ) : (
              <TrendingUp className="w-16 h-16 text-yellow-600 mx-auto mb-3" />
            )}
            <h3 className="text-2xl font-bold mb-2">
              {score >= 80 ? 'Excellent Work!' : 'Good Progress!'}
            </h3>
            <p className="text-lg font-semibold mb-1">Final Score: {score}%</p>
            <p className="text-sm text-slate-600">
              You completed {Object.values(feedback).filter(f => f.correct).length} of {steps.length} steps correctly
            </p>
          </div>

          {/* Step by Step Review */}
          <div className="space-y-3 mb-6">
            <h4 className="font-semibold text-slate-900">Review:</h4>
            {steps.map((step, idx) => {
              const stepFeedback = feedback[idx];
              return (
                <div key={idx} className="p-4 bg-white rounded-lg border">
                  <div className="flex items-start gap-2 mb-2">
                    {stepFeedback?.correct ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium">{step.title}</p>
                      <p className="text-sm text-slate-600 mt-1">{stepFeedback?.message}</p>
                      {stepFeedback?.suggestions?.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {stepFeedback.suggestions.map((suggestion, sIdx) => (
                            <li key={sIdx} className="text-xs text-blue-600 flex items-start gap-1">
                              <Lightbulb className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              {suggestion}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3">
            <Button onClick={() => {
              setCurrentStep(0);
              setResponses({});
              setFeedback({});
              setShowResults(false);
              setScore(0);
            }} variant="outline" className="flex-1">
              Try Again
            </Button>
            <Button onClick={() => onComplete(score)} className="flex-1">
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const progress = ((currentStep + 1) / steps.length) * 100;
  const currentFeedback = feedback[currentStep];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between mb-2">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            Interactive Simulation
          </CardTitle>
          <Badge>
            Step {currentStep + 1} of {steps.length}
          </Badge>
        </div>
        <Progress value={progress} className="h-2" />
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Scenario Context */}
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription>
              <strong className="text-blue-900">Scenario:</strong>
              <p className="text-blue-800 mt-1">{scenario.description}</p>
            </AlertDescription>
          </Alert>

          {/* Current Step */}
          <div>
            <h3 className="text-lg font-semibold mb-2">{currentStepData?.title}</h3>
            <p className="text-slate-600 mb-4">{currentStepData?.prompt}</p>

            {currentStepData?.type === 'text_input' && (
              <Textarea
                value={responses[currentStep] || ''}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder="Type your documentation here..."
                rows={6}
                className="mb-4"
              />
            )}

            {currentStepData?.type === 'vital_signs' && (
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Input placeholder="Blood Pressure" />
                <Input placeholder="Heart Rate" />
                <Input placeholder="Temperature" />
                <Input placeholder="O2 Saturation" />
              </div>
            )}
          </div>

          {/* Feedback Display */}
          {currentFeedback && (
            <Alert className={currentFeedback.correct ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}>
              {currentFeedback.correct ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
              )}
              <AlertDescription>
                <p className={currentFeedback.correct ? 'text-green-800' : 'text-yellow-800'}>
                  {currentFeedback.message}
                </p>
                {currentFeedback.suggestions?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {currentFeedback.suggestions.map((suggestion, idx) => (
                      <li key={idx} className="text-sm flex items-start gap-2">
                        <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        {suggestion}
                      </li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Evaluation Error */}
          {evalError && !currentFeedback && (
            <Alert className="bg-red-50 border-red-200">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-800">{evalError}</AlertDescription>
            </Alert>
          )}

          {/* Action Button */}
          {!currentFeedback && (
            <Button
              onClick={handleResponseSubmit}
              disabled={!responses[currentStep] || ai.loading}
              className="w-full"
            >
              {ai.loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Evaluating Response…
                </>
              ) : (
                "Submit Response"
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}