import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2,
  RefreshCw,
  ChevronRight,
  Brain,
  FileText,
  Heart,
  Stethoscope,
  AlertTriangle,
  Lightbulb,
  Award
} from "lucide-react";
import { toast } from 'sonner';

const SCENARIO_TYPES = [
  { id: 'chf_admission', name: 'CHF Admission', icon: Heart, difficulty: 'intermediate' },
  { id: 'copd_exacerbation', name: 'COPD Exacerbation', icon: Stethoscope, difficulty: 'advanced' },
  { id: 'diabetic_wound', name: 'Diabetic Wound Care', icon: FileText, difficulty: 'intermediate' },
  { id: 'fall_assessment', name: 'Fall Risk Assessment', icon: AlertTriangle, difficulty: 'beginner' },
  { id: 'hospice_symptom', name: 'Hospice Symptom Management', icon: Heart, difficulty: 'advanced' },
  { id: 'oasis_accuracy', name: 'OASIS Documentation', icon: FileText, difficulty: 'intermediate' }
];

export default function TrainingScenarioSimulator({ onComplete }) {
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [scenario, setScenario] = useState(null);
  const genAi = useAICall();
  const [currentStep, setCurrentStep] = useState(0);
  const [userResponses, setUserResponses] = useState({});
  const [feedback, setFeedback] = useState(null);
  // Per-step AI scores, keyed by step index, so the final average reflects each
  // step rather than repeating the last step's score.
  const [stepScores, setStepScores] = useState({});
  const evalAi = useAICall();
  const [finalScore, setFinalScore] = useState(null);

  const generateScenario = async (type) => {
    setSelectedScenario(type);
    
    try {
      const prompt = `Create an interactive clinical training scenario for home health nurses.

SCENARIO TYPE: ${type.name}
DIFFICULTY: ${type.difficulty}

Generate a realistic patient scenario with multiple decision points. The scenario should test:
1. Clinical assessment skills
2. Documentation compliance (Medicare requirements)
3. Patient communication
4. Critical thinking and prioritization

Return JSON:
{
  "patient": {
    "name": "Anonymized name",
    "age": 75,
    "gender": "Female/Male",
    "primary_diagnosis": "Diagnosis",
    "secondary_diagnoses": ["Diagnosis 1", "Diagnosis 2"],
    "medications": ["Med 1", "Med 2"],
    "allergies": "Allergies or NKDA",
    "living_situation": "Description",
    "caregiver": "Caregiver info"
  },
  "presenting_situation": "Detailed scenario description upon arrival",
  "vital_signs": {
    "temperature": 98.6,
    "blood_pressure": "140/90",
    "heart_rate": 88,
    "respiratory_rate": 20,
    "oxygen_saturation": 94,
    "pain_level": 4
  },
  "steps": [
    {
      "step_number": 1,
      "situation": "What the nurse observes or encounters",
      "question": "What should the nurse do/assess/document?",
      "question_type": "open_ended|multiple_choice",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_approach": "The ideal response",
      "key_points": ["Point 1", "Point 2"],
      "compliance_focus": "Specific Medicare/compliance element being tested"
    }
  ],
  "learning_objectives": ["Objective 1", "Objective 2"],
  "oasis_elements": ["Relevant OASIS items to consider"],
  "quality_measures": ["Relevant quality measures"]
}`;

      const result = await genAi.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            patient: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "number" },
                gender: { type: "string" },
                primary_diagnosis: { type: "string" },
                secondary_diagnoses: { type: "array", items: { type: "string" } },
                medications: { type: "array", items: { type: "string" } },
                allergies: { type: "string" },
                living_situation: { type: "string" },
                caregiver: { type: "string" }
              }
            },
            presenting_situation: { type: "string" },
            vital_signs: { type: "object" },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step_number: { type: "number" },
                  situation: { type: "string" },
                  question: { type: "string" },
                  question_type: { type: "string" },
                  options: { type: "array", items: { type: "string" } },
                  correct_approach: { type: "string" },
                  key_points: { type: "array", items: { type: "string" } },
                  compliance_focus: { type: "string" }
                }
              }
            },
            learning_objectives: { type: "array", items: { type: "string" } },
            oasis_elements: { type: "array", items: { type: "string" } },
            quality_measures: { type: "array", items: { type: "string" } }
          }
        }
      });

      setScenario(result);
      setCurrentStep(0);
      setUserResponses({});
      setStepScores({});
      setFeedback(null);
      setFinalScore(null);
    } catch (error) {
      console.error('Error generating scenario:', error);
    }
  };

  const submitResponse = async () => {
    const step = scenario.steps[currentStep];
    const response = userResponses[currentStep];
    
    if (!response || response.trim().length < 10) {
      toast.error("Please provide a more detailed response.");
      return;
    }

    try {
      const evalPrompt = `Evaluate this nurse's response to a clinical training scenario.

SCENARIO CONTEXT:
Patient: ${scenario.patient.name}, ${scenario.patient.age}yo with ${scenario.patient.primary_diagnosis}
Situation: ${step.situation}

QUESTION ASKED:
${step.question}

NURSE'S RESPONSE:
${response}

CORRECT APPROACH:
${step.correct_approach}

KEY POINTS TO COVER:
${step.key_points.join(', ')}

COMPLIANCE FOCUS:
${step.compliance_focus}

Evaluate the response and provide feedback:
{
  "score": 0-100,
  "strengths": ["What they did well"],
  "areas_for_improvement": ["What could be better"],
  "missed_elements": ["Critical elements not addressed"],
  "compliance_feedback": "Specific feedback on Medicare/compliance aspects",
  "teaching_point": "Key learning point from this step",
  "encouragement": "Positive, constructive message"
}`;

      const evalResult = await evalAi.run({
        model: "claude_opus_4_8",
        prompt: evalPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            score: { type: "number" },
            strengths: { type: "array", items: { type: "string" } },
            areas_for_improvement: { type: "array", items: { type: "string" } },
            missed_elements: { type: "array", items: { type: "string" } },
            compliance_feedback: { type: "string" },
            teaching_point: { type: "string" },
            encouragement: { type: "string" }
          }
        }
      });

      setFeedback(evalResult);
      setStepScores(prev => ({ ...prev, [currentStep]: evalResult?.score ?? 70 }));
    } catch (error) {
      console.error('Error evaluating response:', error);
    }
  };

  const nextStep = () => {
    if (currentStep < scenario.steps.length - 1) {
      setCurrentStep(currentStep + 1);
      setFeedback(null);
    } else {
      calculateFinalScore();
    }
  };

  const calculateFinalScore = () => {
    const scores = Object.values(stepScores);
    const avgScore = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;
    setFinalScore({
      score: avgScore,
      completed: true,
      scenarioType: selectedScenario.id
    });
    if (onComplete) {
      onComplete({
        scenarioType: selectedScenario.id,
        score: avgScore,
        completedAt: new Date().toISOString()
      });
    }
  };

  const getDifficultyColor = (diff) => {
    switch (diff) {
      case 'beginner': return 'bg-green-100 text-green-800';
      case 'intermediate': return 'bg-yellow-100 text-yellow-800';
      case 'advanced': return 'bg-red-100 text-red-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  // Scenario Selection
  if (!scenario && !genAi.loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            Select Training Scenario
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {SCENARIO_TYPES.map((type) => (
              <Card 
                key={type.id} 
                className="cursor-pointer hover:shadow-lg transition-all hover:border-navy-300"
                onClick={() => generateScenario(type)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-navy-100 rounded-lg flex items-center justify-center">
                      <type.icon className="w-5 h-5 text-navy-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{type.name}</h3>
                      <Badge className={getDifficultyColor(type.difficulty)}>
                        {type.difficulty}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Loading
  if (genAi.loading) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <RefreshCw className="w-12 h-12 text-navy-600 mx-auto mb-4 animate-spin" />
          <h3 className="text-xl font-semibold mb-2">Generating Training Scenario</h3>
          <p className="text-slate-500">Creating a realistic clinical situation...</p>
        </CardContent>
      </Card>
    );
  }

  // Final Score
  if (finalScore) {
    return (
      <Card className="bg-gradient-to-br from-navy-50 to-indigo-50">
        <CardContent className="p-8 text-center">
          <Award className={`w-16 h-16 mx-auto mb-4 ${
            finalScore.score >= 80 ? 'text-green-500' : 
            finalScore.score >= 60 ? 'text-yellow-500' : 'text-red-500'
          }`} />
          <h2 className="text-3xl font-bold mb-2">Scenario Complete!</h2>
          <p className="text-6xl font-bold mb-4" style={{
            color: finalScore.score >= 80 ? '#22c55e' : 
                   finalScore.score >= 60 ? '#eab308' : '#ef4444'
          }}>
            {finalScore.score}%
          </p>
          <p className="text-slate-600 mb-6">
            {finalScore.score >= 80 ? 'Excellent work! You demonstrated strong clinical skills.' :
             finalScore.score >= 60 ? 'Good effort! Review the feedback to strengthen weak areas.' :
             'Keep practicing! Focus on the areas highlighted for improvement.'}
          </p>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => {
              setScenario(null);
              setSelectedScenario(null);
              setFinalScore(null);
            }}>
              Try Another Scenario
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Active Scenario
  const step = scenario.steps[currentStep];

  return (
    <div className="space-y-4">
      {/* Progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              Step {currentStep + 1} of {scenario.steps.length}
            </span>
            <Badge>{selectedScenario.name}</Badge>
          </div>
          <Progress value={((currentStep + 1) / scenario.steps.length) * 100} />
        </CardContent>
      </Card>

      {/* Patient Info */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <h3 className="font-semibold text-blue-900 mb-2">Patient: {scenario.patient.name}</h3>
          <div className="grid md:grid-cols-3 gap-2 text-sm text-blue-800">
            <p>Age: {scenario.patient.age} | {scenario.patient.gender}</p>
            <p>Dx: {scenario.patient.primary_diagnosis}</p>
            <p>Allergies: {scenario.patient.allergies}</p>
          </div>
        </CardContent>
      </Card>

      {/* Current Situation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current Situation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-slate-700 mb-4">{step.situation}</p>
          
          <Alert className="bg-navy-50 border-navy-200 mb-4">
            <Lightbulb className="w-4 h-4 text-navy-600" />
            <AlertDescription className="text-navy-900 font-medium">
              {step.question}
            </AlertDescription>
          </Alert>

          <Textarea
            placeholder="Type your response here..."
            value={userResponses[currentStep] || ''}
            onChange={(e) => setUserResponses({
              ...userResponses,
              [currentStep]: e.target.value
            })}
            rows={6}
            className="mb-4"
          />

          {!feedback && (
            <Button 
              onClick={submitResponse} 
              disabled={evalAi.loading}
              className="w-full"
            >
              {evalAi.loading ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Evaluating...</>
              ) : (
                'Submit Response'
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Feedback */}
      {feedback && (
        <Card className="border-2 border-navy-300">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>AI Feedback</span>
              <Badge className={
                feedback.score >= 80 ? 'bg-green-500' :
                feedback.score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
              }>
                {feedback.score}%
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {feedback.strengths?.length > 0 && (
              <div className="p-3 bg-green-50 rounded-lg">
                <p className="text-sm font-semibold text-green-800 mb-1">
                  <CheckCircle2 className="w-4 h-4 inline mr-1" /> Strengths
                </p>
                <ul className="text-sm text-green-700 list-disc ml-5">
                  {feedback.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}

            {feedback.areas_for_improvement?.length > 0 && (
              <div className="p-3 bg-yellow-50 rounded-lg">
                <p className="text-sm font-semibold text-yellow-800 mb-1">
                  <AlertTriangle className="w-4 h-4 inline mr-1" /> Areas for Improvement
                </p>
                <ul className="text-sm text-yellow-700 list-disc ml-5">
                  {feedback.areas_for_improvement.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}

            {feedback.compliance_feedback && (
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-sm font-semibold text-blue-800 mb-1">
                  <FileText className="w-4 h-4 inline mr-1" /> Compliance Note
                </p>
                <p className="text-sm text-blue-700">{feedback.compliance_feedback}</p>
              </div>
            )}

            <Alert className="bg-navy-50 border-navy-200">
              <Lightbulb className="w-4 h-4 text-navy-600" />
              <AlertDescription className="text-navy-900">
                <strong>Teaching Point:</strong> {feedback.teaching_point}
              </AlertDescription>
            </Alert>

            <p className="text-center text-slate-600 italic">{feedback.encouragement}</p>

            <Button onClick={nextStep} className="w-full">
              {currentStep < scenario.steps.length - 1 ? (
                <>Next Step <ChevronRight className="w-4 h-4 ml-1" /></>
              ) : (
                'Complete Scenario'
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}