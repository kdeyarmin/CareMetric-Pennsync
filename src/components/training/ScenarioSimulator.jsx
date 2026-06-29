import React from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Users, Play, CheckCircle2, ArrowRight } from "lucide-react";

const SCENARIOS = [
  {
    id: "copd-exacerbation",
    title: "COPD Exacerbation Recognition",
    difficulty: "intermediate",
    description: "Practice recognizing and documenting signs of COPD exacerbation during a routine visit",
    patient: {
      name: "James Wilson",
      age: 72,
      diagnosis: "COPD, on home oxygen 2L continuous",
      baseline: "Usually ambulat with minimal SOB, O2 sat 94-96% on 2L"
    },
    steps: [
      {
        situation: "You arrive for a routine visit. The patient answers the door but appears more short of breath than usual.",
        question: "What should you assess first?",
        options: [
          "Ask about medication compliance",
          "Check vital signs and oxygen saturation",
          "Ask about recent activities",
          "Document arrival time"
        ],
        correct: 1,
        feedback: "Correct! With a COPD patient showing increased SOB, immediate vital sign assessment including O2 saturation is priority to evaluate respiratory status."
      },
      {
        situation: "Vital signs: BP 138/82, HR 96, RR 26, O2 sat 88% on 2L oxygen, Temp 99.2°F",
        question: "These findings indicate:",
        options: [
          "Normal for COPD patient",
          "Possible COPD exacerbation - requires assessment and intervention",
          "Patient needs to rest",
          "Vital signs within normal limits"
        ],
        correct: 1,
        feedback: "Correct! O2 sat of 88% (below baseline), increased RR of 26, and low-grade fever suggest COPD exacerbation requiring skilled nursing assessment and potential physician notification."
      },
      {
        situation: "You increase oxygen to 3L per physician standing orders. O2 sat improves to 92%. Patient reports increased cough with yellow sputum for 2 days.",
        question: "What elements MUST be in your documentation?",
        options: [
          "Just document vital signs",
          "Skilled assessment of respiratory status, clinical findings suggesting exacerbation, RN intervention (O2 adjustment), rationale, patient response, and physician notification",
          "Note that patient has a cold",
          "Document O2 change only"
        ],
        correct: 1,
        feedback: "Excellent! Complete documentation must show skilled RN assessment, clinical judgment in intervening, medical necessity of RN services, and patient response to interventions."
      }
    ]
  }
];

export default function ScenarioSimulator({ userEmail, onComplete }) {
  const [selectedScenario, setSelectedScenario] = React.useState(null);
  const [currentStep, setCurrentStep] = React.useState(0);
  const [answers, setAnswers] = React.useState({});
  const [showFeedback, setShowFeedback] = React.useState(false);
  const [completed, setCompleted] = React.useState(false);

  const handleSelectAnswer = (answerIndex) => {
    setAnswers({ ...answers, [currentStep]: answerIndex });
    setShowFeedback(true);
  };

  const handleNext = () => {
    if (currentStep < selectedScenario.steps.length - 1) {
      setCurrentStep(currentStep + 1);
      setShowFeedback(false);
    } else {
      completeScenario();
    }
  };

  const completeScenario = async () => {
    const correctAnswers = Object.keys(answers).reduce((acc, stepIdx) => {
      return acc + (answers[stepIdx] === selectedScenario.steps[stepIdx].correct ? 1 : 0);
    }, 0);
    const score = (correctAnswers / selectedScenario.steps.length) * 100;

    try {
      await base44.entities.MicroLearningProgress.create({
        nurse_email: userEmail,
        skill_area: selectedScenario.title,
        module_type: "scenario",
        status: "completed",
        score: score,
        content: {
          scenario_id: selectedScenario.id,
          answers: answers
        }
      });
      onComplete?.();
    } catch (error) {
      console.error('Error saving scenario completion:', error);
    }

    setCompleted(true);
  };

  if (!selectedScenario) {
    return (
      <div className="grid gap-4">
        {SCENARIOS.map((scenario) => (
          <Card key={scenario.id} className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    <h3 className="text-lg font-semibold">{scenario.title}</h3>
                    <Badge>{scenario.difficulty}</Badge>
                  </div>
                  <p className="text-sm text-slate-600 mb-4">{scenario.description}</p>
                  <div className="bg-slate-50 p-3 rounded border border-slate-200">
                    <p className="text-xs font-medium text-slate-700 mb-1">Patient:</p>
                    <p className="text-sm text-slate-900">{scenario.patient.name}, {scenario.patient.age}yo</p>
                    <p className="text-xs text-slate-600">{scenario.patient.diagnosis}</p>
                  </div>
                </div>
                <Button onClick={() => setSelectedScenario(scenario)} className="flex-shrink-0">
                  <Play className="w-4 h-4 mr-2" /> Start Scenario
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (completed) {
    const correctAnswers = Object.keys(answers).reduce((acc, stepIdx) => {
      return acc + (answers[stepIdx] === selectedScenario.steps[stepIdx].correct ? 1 : 0);
    }, 0);
    const score = Math.round((correctAnswers / selectedScenario.steps.length) * 100);

    return (
      <Card className="border-2 border-green-300 bg-green-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
            Scenario Complete!
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <p className="text-4xl font-bold text-green-900 mb-2">{score}%</p>
            <p className="text-sm text-green-800">
              You answered {correctAnswers} out of {selectedScenario.steps.length} questions correctly
            </p>
          </div>
          
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-sm text-blue-900">
              <strong>Key Takeaway:</strong> This scenario demonstrates the importance of systematic assessment, clinical judgment, and comprehensive documentation when managing acute changes in patient status.
            </AlertDescription>
          </Alert>

          <Button
            onClick={() => {
              setSelectedScenario(null);
              setCurrentStep(0);
              setAnswers({});
              setShowFeedback(false);
              setCompleted(false);
            }}
            className="w-full"
          >
            Try Another Scenario
          </Button>
        </CardContent>
      </Card>
    );
  }

  const step = selectedScenario.steps[currentStep];
  const isCorrect = answers[currentStep] === step.correct;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-600" />
              {selectedScenario.title}
            </CardTitle>
            <p className="text-sm text-slate-600 mt-1">
              Step {currentStep + 1} of {selectedScenario.steps.length}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedScenario(null);
              setCurrentStep(0);
              setAnswers({});
              setShowFeedback(false);
            }}
          >
            Exit Scenario
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Patient Info */}
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-slate-700 mb-1">Patient: {selectedScenario.patient.name}</p>
            <p className="text-xs text-slate-600">{selectedScenario.patient.diagnosis}</p>
            <p className="text-xs text-slate-600">Baseline: {selectedScenario.patient.baseline}</p>
          </CardContent>
        </Card>

        {/* Situation */}
        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Situation:</p>
          <Alert>
            <AlertDescription>{step.situation}</AlertDescription>
          </Alert>
        </div>

        {/* Question */}
        <div>
          <p className="text-sm font-medium text-slate-900 mb-3">{step.question}</p>
          <div className="space-y-2">
            {step.options.map((option, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  showFeedback
                    ? idx === step.correct
                      ? 'border-green-500 bg-green-50'
                      : answers[currentStep] === idx
                      ? 'border-red-500 bg-red-50'
                      : 'border-slate-200 bg-white'
                    : answers[currentStep] === idx
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:border-indigo-300'
                }`}
                onClick={() => !showFeedback && handleSelectAnswer(idx)}
              >
                <p className="text-sm">{option}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Feedback */}
        {showFeedback && (
          <Alert className={isCorrect ? "bg-green-50 border-green-200" : "bg-orange-50 border-orange-200"}>
            <AlertDescription className={isCorrect ? "text-green-900" : "text-orange-900"}>
              <strong>{isCorrect ? '✓ Correct!' : '✗ Incorrect'}</strong>
              <p className="mt-1">{step.feedback}</p>
            </AlertDescription>
          </Alert>
        )}

        {/* Navigation */}
        {showFeedback && (
          <Button onClick={handleNext} className="w-full">
            {currentStep < selectedScenario.steps.length - 1 ? (
              <>Next Step <ArrowRight className="w-4 h-4 ml-2" /></>
            ) : (
              <>Complete Scenario <CheckCircle2 className="w-4 h-4 ml-2" /></>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}