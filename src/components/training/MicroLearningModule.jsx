import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  BookOpen,
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  Lightbulb,
  MessageSquare,
  Award,
  ChevronRight,
  Clock,
  Target,
  Sparkles
} from "lucide-react";

export default function MicroLearningModule({
  skillGap,
  nurseEmail,
  onComplete,
  onClose
}) {
  const [moduleContent, setModuleContent] = useState(null);
  const generatingAi = useAICall();
  const [currentStep, setCurrentStep] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizResults, setQuizResults] = useState(null);
  const [scenarioResponse, setScenarioResponse] = useState("");
  const [scenarioFeedback, setScenarioFeedback] = useState(null);
  const evaluatingAi = useAICall();
  const [startTime, setStartTime] = useState(null);
  const [progressRecord, setProgressRecord] = useState(null);

  const setQuizError = (message) => toast.error(message);

  const generateLearningContent = useCallback(async () => {
    try {
      const result = await generatingAi.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert clinical educator creating personalized micro-learning content for a home health nurse.

SKILL GAP IDENTIFIED:
Area: ${skillGap.area}
Evidence: ${skillGap.evidence}
Recommended Training: ${skillGap.recommended_training}

Generate a comprehensive micro-learning module with 4 parts:

1. MICRO-LESSON (2-3 minutes read)
   - Key concepts explained simply
   - Clinical relevance and importance
   - Best practices and tips
   - Common mistakes to avoid

2. KNOWLEDGE CHECK QUIZ (5 questions)
   - Mix of recall and application questions
   - Multiple choice with 4 options each
   - Clear correct answers with explanations

3. SIMULATED PATIENT SCENARIO
   - Realistic clinical scenario related to the skill gap
   - Include patient details, vitals, symptoms
   - Present a documentation challenge
   - Clear learning objectives

4. PRACTICE EXERCISE
   - Hands-on task to apply learning
   - Template or checklist to follow
   - Self-assessment criteria

Return JSON:
{
  "module_title": "Concise title",
  "estimated_minutes": 10,
  "learning_objectives": ["Objective 1", "Objective 2", "Objective 3"],
  "micro_lesson": {
    "introduction": "Why this matters",
    "key_concepts": [
      {
        "title": "Concept title",
        "explanation": "Clear explanation",
        "clinical_tip": "Practical tip"
      }
    ],
    "common_mistakes": ["Mistake 1", "Mistake 2"],
    "summary": "Key takeaways"
  },
  "quiz": {
    "questions": [
      {
        "question": "Question text",
        "options": ["A", "B", "C", "D"],
        "correct_answer": 0,
        "explanation": "Why this is correct"
      }
    ]
  },
  "scenario": {
    "title": "Scenario title",
    "patient_context": "Patient background and current situation",
    "clinical_data": {
      "vitals": "Relevant vitals",
      "symptoms": "Presenting symptoms",
      "history": "Relevant history"
    },
    "challenge": "What the nurse needs to document/address",
    "learning_focus": "What skill this practices",
    "ideal_response_elements": ["Element 1", "Element 2", "Element 3"]
  },
  "practice_exercise": {
    "task": "What to do",
    "template": "Template or structure to follow",
    "checklist": ["Checkbox 1", "Checkbox 2", "Checkbox 3"],
    "self_assessment": "How to evaluate your work"
  }
}`,
        response_json_schema: {
          type: "object",
          properties: {
            module_title: { type: "string" },
            estimated_minutes: { type: "number" },
            learning_objectives: { type: "array", items: { type: "string" } },
            micro_lesson: { type: "object" },
            quiz: { type: "object" },
            scenario: { type: "object" },
            practice_exercise: { type: "object" }
          }
        }
      });

      setModuleContent(result);

      // Create progress record
      const record = await base44.entities.MicroLearningProgress.create({
        nurse_email: nurseEmail,
        skill_gap_id: skillGap.id || `gap_${Date.now()}`,
        skill_area: skillGap.area,
        module_type: 'micro_lesson',
        content: result,
        status: 'in_progress',
        source: 'note_review',
        attempts: 1
      });
      setProgressRecord(record);

    } catch (error) {
      console.error("Error generating content:", error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [nurseEmail, skillGap]);

  useEffect(() => {
    // Guard with !moduleContent && !generatingAi.loading so a skillGap reference change
    // or re-mount can't re-fire the LLM call and create a duplicate progress row.
    if (skillGap && !moduleContent && !generatingAi.loading) {
      generateLearningContent();
      setStartTime(Date.now());
    }
  }, [skillGap, moduleContent, generatingAi.loading, generateLearningContent]);

  const handleQuizSubmit = () => {
    const questions = moduleContent?.quiz?.questions;
    // Guard against an empty/missing quiz so we never compute 0/0 = NaN.
    if (!Array.isArray(questions) || questions.length === 0) {
      setQuizError('The quiz could not be generated. Please retry the module.');
      return;
    }

    const results = questions.map((q, idx) => ({
      question: q.question,
      userAnswer: quizAnswers[idx],
      correctAnswer: q.correct_answer,
      isCorrect: quizAnswers[idx] === q.correct_answer,
      explanation: q.explanation
    }));

    const score = Math.round((results.filter(r => r.isCorrect).length / results.length) * 100);
    setQuizResults({ results, score });
  };

  const evaluateScenarioResponse = async () => {
    if (!scenarioResponse.trim()) return;
    
    try {
      const result = await evaluatingAi.run({
        model: "claude_opus_4_8",
        prompt: `You are a clinical documentation expert evaluating a nurse's response to a simulated scenario.

SCENARIO:
${moduleContent?.scenario?.title || ''}
${moduleContent?.scenario?.patient_context || ''}
Challenge: ${moduleContent?.scenario?.challenge || ''}

IDEAL RESPONSE SHOULD INCLUDE:
${(moduleContent?.scenario?.ideal_response_elements || []).join('\n')}

NURSE'S RESPONSE:
${scenarioResponse}

Evaluate the response and provide constructive feedback:

Return JSON:
{
  "score": 0-100,
  "elements_addressed": ["Elements from ideal list that were included"],
  "elements_missing": ["Elements that were missing"],
  "strengths": ["What was done well"],
  "improvements": ["Specific suggestions for improvement"],
  "model_response": "A brief example of an ideal response snippet",
  "encouragement": "Positive closing message"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            score: { type: "number" },
            elements_addressed: { type: "array", items: { type: "string" } },
            elements_missing: { type: "array", items: { type: "string" } },
            strengths: { type: "array", items: { type: "string" } },
            improvements: { type: "array", items: { type: "string" } },
            model_response: { type: "string" },
            encouragement: { type: "string" }
          }
        }
      });

      setScenarioFeedback(result);
    } catch (error) {
      console.error("Error evaluating scenario:", error);
    }
  };

  const completeModule = async () => {
    const timeSpent = Math.round((Date.now() - startTime) / 60000);
    // The quiz is one optional component of the module. Only let the quiz score
    // drive pass/fail when the quiz was actually taken; if it was skipped, the
    // module is still considered complete (we don't fabricate a 0 that would
    // wrongly flag it for review).
    const quizTaken = quizResults != null && typeof quizResults.score === 'number';
    const finalScore = quizTaken ? quizResults.score : null;
    const passed = quizTaken ? finalScore >= 80 : true;
    const status = passed ? 'completed' : 'needs_review';

    if (progressRecord) {
      try {
        const updatePayload = {
          status,
          time_spent_minutes: timeSpent
        };
        // Only persist a score when one was actually computed (avoid NaN/0 noise).
        if (quizTaken) updatePayload.score = finalScore;
        await base44.entities.MicroLearningProgress.update(progressRecord.id, updatePayload);
      } catch (error) {
        console.error("Error saving module progress:", error);
        toast.error("Could not save your progress. Please try again.");
        return;
      }
    }

    onComplete?.({
      skill_area: skillGap.area,
      score: finalScore,
      time_spent: timeSpent,
      passed
    });
  };

  const steps = [
    { id: 'lesson', title: 'Micro-Lesson', icon: BookOpen },
    { id: 'quiz', title: 'Knowledge Check', icon: Brain },
    { id: 'scenario', title: 'Patient Scenario', icon: MessageSquare },
    { id: 'practice', title: 'Practice', icon: Target }
  ];

  if (generatingAi.loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="p-8 text-center">
            <Loader2 className="w-12 h-12 animate-spin text-navy-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Generating Your Personalized Learning</h3>
            <p className="text-slate-600">Creating micro-lesson, quiz, and scenario for: {skillGap?.area}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!moduleContent) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            {moduleContent.module_title}
          </DialogTitle>
        </DialogHeader>

        {/* Progress Steps */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-50 rounded-lg">
          {steps.map((step, idx) => (
            <div 
              key={step.id}
              className={`flex items-center gap-2 ${idx <= currentStep ? 'text-navy-600' : 'text-slate-400'}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                idx < currentStep ? 'bg-green-100' : 
                idx === currentStep ? 'bg-navy-100' : 'bg-slate-100'
              }`}>
                {idx < currentStep ? (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                ) : (
                  <step.icon className="w-4 h-4" />
                )}
              </div>
              <span className="text-sm font-medium hidden sm:inline">{step.title}</span>
              {idx < steps.length - 1 && <ChevronRight className="w-4 h-4 text-slate-300 hidden sm:inline" />}
            </div>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Step 0: Micro-Lesson */}
          {currentStep === 0 && (
            <div className="space-y-6">
              <div className="flex items-center gap-4 text-sm text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" /> {moduleContent.estimated_minutes} min
                </span>
                <span className="flex items-center gap-1">
                  <Target className="w-4 h-4" /> {moduleContent.learning_objectives?.length} objectives
                </span>
              </div>

              {/* Learning Objectives */}
              <div className="p-4 bg-navy-50 rounded-lg">
                <h4 className="font-semibold text-navy-900 mb-2">Learning Objectives</h4>
                <ul className="space-y-1">
                  {moduleContent.learning_objectives?.map((obj, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-navy-800">
                      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                      {obj}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Introduction */}
              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Why This Matters</h4>
                <p className="text-slate-700">{moduleContent.micro_lesson?.introduction}</p>
              </div>

              {/* Key Concepts */}
              <div className="space-y-4">
                <h4 className="font-semibold text-slate-900">Key Concepts</h4>
                {moduleContent.micro_lesson?.key_concepts?.map((concept, idx) => (
                  <Card key={idx} className="border-l-4 border-l-blue-500">
                    <CardContent className="p-4">
                      <h5 className="font-semibold text-blue-900 mb-2">{concept.title}</h5>
                      <p className="text-slate-700 mb-2">{concept.explanation}</p>
                      {concept.clinical_tip && (
                        <div className="flex items-start gap-2 p-2 bg-yellow-50 rounded text-sm">
                          <Lightbulb className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" />
                          <span className="text-yellow-800">{concept.clinical_tip}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Common Mistakes */}
              <div className="p-4 bg-red-50 rounded-lg">
                <h4 className="font-semibold text-red-900 mb-2">Common Mistakes to Avoid</h4>
                <ul className="space-y-1">
                  {moduleContent.micro_lesson?.common_mistakes?.map((mistake, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-red-800">
                      <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      {mistake}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Summary */}
              <div className="p-4 bg-green-50 rounded-lg">
                <h4 className="font-semibold text-green-900 mb-2">Key Takeaways</h4>
                <p className="text-green-800">{moduleContent.micro_lesson?.summary}</p>
              </div>
            </div>
          )}

          {/* Step 1: Quiz */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-900">Knowledge Check</h4>
                <Badge variant="outline">
                  {Object.keys(quizAnswers).length}/{moduleContent.quiz?.questions?.length} answered
                </Badge>
              </div>

              {!quizResults ? (
                <>
                  {moduleContent.quiz?.questions?.map((q, idx) => (
                    <Card key={idx} className="p-4">
                      <p className="font-medium mb-3">{idx + 1}. {q.question}</p>
                      <RadioGroup
                        value={quizAnswers[idx]?.toString()}
                        onValueChange={(value) => setQuizAnswers(prev => ({...prev, [idx]: parseInt(value)}))}
                      >
                        {(q.options || []).map((option, optIdx) => (
                          <div key={optIdx} className="flex items-center space-x-2">
                            <RadioGroupItem value={optIdx.toString()} id={`q${idx}-opt${optIdx}`} />
                            <Label htmlFor={`q${idx}-opt${optIdx}`} className="cursor-pointer">{option}</Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </Card>
                  ))}
                  <Button 
                    onClick={handleQuizSubmit}
                    disabled={Object.keys(quizAnswers).length !== moduleContent.quiz?.questions?.length}
                    className="w-full bg-navy-600 hover:bg-navy-700"
                  >
                    Submit Quiz
                  </Button>
                </>
              ) : (
                <div className="space-y-4">
                  <div className={`p-6 rounded-lg text-center ${quizResults.score >= 80 ? 'bg-green-50' : 'bg-yellow-50'}`}>
                    <Award className={`w-12 h-12 mx-auto mb-2 ${quizResults.score >= 80 ? 'text-green-600' : 'text-yellow-600'}`} />
                    <p className="text-3xl font-bold">{quizResults.score}%</p>
                    <p className={quizResults.score >= 80 ? 'text-green-700' : 'text-yellow-700'}>
                      {quizResults.score >= 80 ? 'Great job! You passed!' : 'Keep learning - you can retry!'}
                    </p>
                  </div>

                  {quizResults.results.map((r, idx) => (
                    <Card key={idx} className={`p-4 ${r.isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                      <div className="flex items-start gap-2">
                        {r.isCorrect ? (
                          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                        )}
                        <div>
                          <p className="font-medium">{r.question}</p>
                          {!r.isCorrect && (
                            <p className="text-sm text-red-700 mt-1">
                              Correct answer: {moduleContent?.quiz?.questions?.[idx]?.options?.[r.correctAnswer] ?? 'N/A'}
                            </p>
                          )}
                          <p className="text-sm text-slate-600 mt-2">{r.explanation}</p>
                        </div>
                      </div>
                    </Card>
                  ))}

                  {quizResults.score < 80 && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuizAnswers({});
                        setQuizResults(null);
                      }}
                      className="w-full"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" /> Retry Quiz
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Scenario */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
                <CardHeader>
                  <CardTitle className="text-lg">{moduleContent.scenario?.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-slate-700">{moduleContent.scenario?.patient_context}</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 bg-white rounded-lg">
                      <p className="text-xs font-semibold text-slate-500 mb-1">VITALS</p>
                      <p className="text-sm">{moduleContent.scenario?.clinical_data?.vitals}</p>
                    </div>
                    <div className="p-3 bg-white rounded-lg">
                      <p className="text-xs font-semibold text-slate-500 mb-1">SYMPTOMS</p>
                      <p className="text-sm">{moduleContent.scenario?.clinical_data?.symptoms}</p>
                    </div>
                    <div className="p-3 bg-white rounded-lg">
                      <p className="text-xs font-semibold text-slate-500 mb-1">HISTORY</p>
                      <p className="text-sm">{moduleContent.scenario?.clinical_data?.history}</p>
                    </div>
                  </div>

                  <div className="p-3 bg-navy-100 rounded-lg">
                    <p className="text-sm font-semibold text-navy-900 mb-1">Your Challenge:</p>
                    <p className="text-navy-800">{moduleContent.scenario?.challenge}</p>
                  </div>
                </CardContent>
              </Card>

              <div>
                <Label className="font-semibold">Your Response:</Label>
                <Textarea
                  value={scenarioResponse}
                  onChange={(e) => setScenarioResponse(e.target.value)}
                  placeholder="Write your documentation response here..."
                  rows={8}
                  className="mt-2"
                />
              </div>

              {!scenarioFeedback ? (
                <Button 
                  onClick={evaluateScenarioResponse}
                  disabled={!scenarioResponse.trim() || evaluatingAi.loading}
                  className="w-full bg-navy-600 hover:bg-navy-700"
                >
                  {evaluatingAi.loading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Evaluating...</>
                  ) : (
                    <><Brain className="w-4 h-4 mr-2" /> Get AI Feedback</>
                  )}
                </Button>
              ) : (
                <Card className={`${scenarioFeedback.score >= 70 ? 'border-green-200' : 'border-yellow-200'}`}>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Scenario Score</span>
                      <Badge className={scenarioFeedback.score >= 70 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}>
                        {scenarioFeedback.score}%
                      </Badge>
                    </div>

                    {scenarioFeedback.strengths?.length > 0 && (
                      <div className="p-3 bg-green-50 rounded-lg">
                        <p className="text-sm font-semibold text-green-800 mb-1">Strengths:</p>
                        <ul className="text-sm text-green-700 space-y-1">
                          {scenarioFeedback.strengths.map((s, idx) => (
                            <li key={idx}>✓ {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {scenarioFeedback.improvements?.length > 0 && (
                      <div className="p-3 bg-yellow-50 rounded-lg">
                        <p className="text-sm font-semibold text-yellow-800 mb-1">Areas to Improve:</p>
                        <ul className="text-sm text-yellow-700 space-y-1">
                          {scenarioFeedback.improvements.map((i, idx) => (
                            <li key={idx}>→ {i}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {scenarioFeedback.model_response && (
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <p className="text-sm font-semibold text-blue-800 mb-1">Example Response:</p>
                        <p className="text-sm text-blue-700 italic">{scenarioFeedback.model_response}</p>
                      </div>
                    )}

                    <p className="text-sm text-slate-600 italic">{scenarioFeedback.encouragement}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Step 3: Practice */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <Card className="bg-gradient-to-r from-green-50 to-emerald-50">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="w-5 h-5 text-green-600" />
                    Practice Exercise
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="font-semibold text-slate-900 mb-2">Your Task:</p>
                    <p className="text-slate-700">{moduleContent.practice_exercise?.task}</p>
                  </div>

                  {moduleContent.practice_exercise?.template && (
                    <div className="p-4 bg-white rounded-lg border border-slate-200">
                      <p className="text-sm font-semibold text-slate-500 mb-2">TEMPLATE TO FOLLOW:</p>
                      <p className="text-slate-700 whitespace-pre-line">{moduleContent.practice_exercise.template}</p>
                    </div>
                  )}

                  <div>
                    <p className="font-semibold text-slate-900 mb-2">Checklist:</p>
                    <div className="space-y-2">
                      {moduleContent.practice_exercise?.checklist?.map((item, idx) => (
                        <label key={idx} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" className="w-4 h-4 rounded border-slate-300" />
                          <span className="text-sm">{item}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 bg-navy-50 rounded-lg">
                    <p className="text-sm font-semibold text-navy-800 mb-1">Self-Assessment:</p>
                    <p className="text-sm text-navy-700">{moduleContent.practice_exercise?.self_assessment}</p>
                  </div>
                </CardContent>
              </Card>

              <div className="p-6 bg-gradient-to-r from-navy-100 to-gold-100 rounded-lg text-center">
                <Award className="w-12 h-12 text-navy-600 mx-auto mb-2" />
                <h4 className="font-semibold text-lg text-slate-900 mb-1">Module Complete!</h4>
                <p className="text-slate-600 mb-4">Great job completing this micro-learning module.</p>
                <div className="flex items-center justify-center gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" /> 
                    {Math.round((Date.now() - startTime) / 60000)} min spent
                  </span>
                  {quizResults && (
                    <span className="flex items-center gap-1">
                      <Brain className="w-4 h-4" /> 
                      Quiz: {quizResults.score}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {currentStep > 0 && (
            <Button variant="outline" onClick={() => setCurrentStep(prev => prev - 1)}>
              Back
            </Button>
          )}
          {currentStep < steps.length - 1 ? (
            <Button 
              onClick={() => setCurrentStep(prev => prev + 1)}
              className="bg-navy-600 hover:bg-navy-700"
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button 
              onClick={completeModule}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" /> Complete Module
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}