import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Award,
  Clock,
  Target
} from "lucide-react";

export default function InteractiveTrainingModule({ trainingData, onComplete, onExit }) {
  const [currentStep, setCurrentStep] = useState('lesson'); // lesson, scenario, quiz
  const [scenarioStep, setScenarioStep] = useState(0);
  const [quizStep, setQuizStep] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [showFeedback, setShowFeedback] = useState(false);
  const [startTime] = useState(Date.now());
  const [_score, setScore] = useState(0);

  const content = trainingData.training_content;

  const handleNextStep = () => {
    if (currentStep === 'lesson') {
      setCurrentStep('scenario');
    } else if (currentStep === 'scenario') {
      if (scenarioStep < content.scenario.decision_points.length - 1) {
        setScenarioStep(scenarioStep + 1);
        setShowFeedback(false);
        setSelectedAnswers({});
      } else {
        setCurrentStep('quiz');
        setShowFeedback(false);
        setSelectedAnswers({});
      }
    } else if (currentStep === 'quiz') {
      if (quizStep < content.quiz.length - 1) {
        setQuizStep(quizStep + 1);
        setShowFeedback(false);
        // Do NOT clear selectedAnswers here: the final score iterates over every
        // quiz question's answer (keyed by its index), so wiping between
        // questions left only the last answer and capped a perfect run at 1/N.
      } else {
        // Calculate final score
        let correctCount = 0;
        content.quiz.forEach((q, idx) => {
          if (selectedAnswers[idx] === q.correct_answer) correctCount++;
        });
        const finalScore = Math.round((correctCount / content.quiz.length) * 100);
        setScore(finalScore);
        
        const timeSpent = Math.round((Date.now() - startTime) / 1000 / 60); // minutes
        onComplete(finalScore, timeSpent);
      }
    }
  };

  const handleCheckAnswer = () => {
    setShowFeedback(true);
  };

  const getProgress = () => {
    if (currentStep === 'lesson') return 33;
    if (currentStep === 'scenario') return 33 + (scenarioStep + 1) / content.scenario.decision_points.length * 33;
    if (currentStep === 'quiz') return 66 + (quizStep + 1) / content.quiz.length * 34;
    return 100;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <Card className="mb-6 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{content.title}</h1>
                <div className="flex items-center gap-3 mt-2">
                  <Badge className="bg-blue-600">{currentStep}</Badge>
                  <div className="flex items-center gap-1 text-sm text-slate-600">
                    <Clock className="w-4 h-4" />
                    <span>{trainingData.estimated_duration} min</span>
                  </div>
                </div>
              </div>
              <Button variant="outline" onClick={onExit}>Exit</Button>
            </div>
            <Progress value={getProgress()} className="h-2" />
          </CardContent>
        </Card>

        {/* Lesson Content */}
        {currentStep === 'lesson' && (
          <Card>
            <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-600" />
                Learning Content
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <ScrollArea className="h-96">
                <div className="space-y-6 pr-4">
                  {/* Learning Objectives */}
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <Target className="w-5 h-5 text-blue-600" />
                      Learning Objectives
                    </h3>
                    <ul className="space-y-2">
                      {content.learning_objectives.map((obj, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-700">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                          <span>{obj}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Introduction */}
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-3">Introduction</h3>
                    <p className="text-slate-700 leading-relaxed">{content.lesson_content.introduction}</p>
                  </div>

                  {/* Key Concepts */}
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-3">Key Concepts</h3>
                    <div className="space-y-4">
                      {content.lesson_content.key_concepts.map((concept, idx) => (
                        <div key={idx} className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                          <h4 className="font-semibold text-blue-900 mb-2">{concept.concept}</h4>
                          <p className="text-slate-700">{concept.explanation}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Best Practices */}
                  <div>
                    <h3 className="text-lg font-semibold text-green-900 mb-3">Best Practices</h3>
                    <ul className="space-y-2">
                      {content.lesson_content.best_practices.map((practice, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-700 bg-green-50 p-3 rounded-lg">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                          <span>{practice}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Common Mistakes */}
                  <div>
                    <h3 className="text-lg font-semibold text-red-900 mb-3">Common Mistakes to Avoid</h3>
                    <ul className="space-y-2">
                      {content.lesson_content.common_mistakes.map((mistake, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-700 bg-red-50 p-3 rounded-lg">
                          <XCircle className="w-4 h-4 text-red-600 mt-1 flex-shrink-0" />
                          <span>{mistake}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </ScrollArea>
              <div className="mt-6 flex justify-end">
                <Button onClick={handleNextStep} className="bg-blue-600 hover:bg-blue-700">
                  Continue to Scenario
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Scenario */}
        {currentStep === 'scenario' && (
          <Card>
            <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
              <CardTitle>Clinical Scenario</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="bg-navy-50 rounded-lg p-4 border border-navy-200">
                  <h3 className="font-semibold text-navy-900 mb-2">{content.scenario.title}</h3>
                  <p className="text-slate-700 mb-3">{content.scenario.patient_background}</p>
                  <p className="text-slate-800 font-medium">{content.scenario.situation}</p>
                </div>

                {/* Decision Point */}
                <div className="bg-white rounded-lg p-4 border">
                  <h4 className="font-semibold text-slate-900 mb-4">
                    Decision Point {scenarioStep + 1} of {content.scenario.decision_points.length}
                  </h4>
                  <p className="text-slate-800 mb-4">{content.scenario.decision_points[scenarioStep].question}</p>

                  <RadioGroup
                    value={selectedAnswers[scenarioStep]?.toString()}
                    onValueChange={(value) => setSelectedAnswers({ ...selectedAnswers, [scenarioStep]: parseInt(value) })}
                  >
                    {content.scenario.decision_points[scenarioStep].options.map((option, idx) => (
                      <div key={idx} className="flex items-center space-x-2 p-3 rounded-lg hover:bg-slate-50">
                        <RadioGroupItem value={idx.toString()} id={`scenario-${idx}`} />
                        <Label htmlFor={`scenario-${idx}`} className="flex-1 cursor-pointer">{option}</Label>
                      </div>
                    ))}
                  </RadioGroup>

                  {showFeedback && (
                    <div className={`mt-4 p-4 rounded-lg ${
                      selectedAnswers[scenarioStep] === content.scenario.decision_points[scenarioStep].correct_answer
                        ? 'bg-green-50 border border-green-200'
                        : 'bg-red-50 border border-red-200'
                    }`}>
                      <p className={`font-semibold mb-2 ${
                        selectedAnswers[scenarioStep] === content.scenario.decision_points[scenarioStep].correct_answer
                          ? 'text-green-900'
                          : 'text-red-900'
                      }`}>
                        {selectedAnswers[scenarioStep] === content.scenario.decision_points[scenarioStep].correct_answer
                          ? '✓ Correct!'
                          : '✗ Incorrect'}
                      </p>
                      <p className="text-slate-700">{content.scenario.decision_points[scenarioStep].rationale}</p>
                    </div>
                  )}
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setCurrentStep('lesson')}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Lesson
                  </Button>
                  {!showFeedback ? (
                    <Button
                      onClick={handleCheckAnswer}
                      disabled={selectedAnswers[scenarioStep] === undefined}
                      className="bg-navy-600 hover:bg-navy-700"
                    >
                      Check Answer
                    </Button>
                  ) : (
                    <Button onClick={handleNextStep} className="bg-navy-600 hover:bg-navy-700">
                      {scenarioStep < content.scenario.decision_points.length - 1 ? 'Next Question' : 'Continue to Quiz'}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quiz */}
        {currentStep === 'quiz' && (
          <Card>
            <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
              <CardTitle className="flex items-center gap-2">
                <Award className="w-5 h-5 text-green-600" />
                Knowledge Check
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-slate-600">
                    Question {quizStep + 1} of {content.quiz.length}
                  </span>
                  <Progress value={(quizStep + 1) / content.quiz.length * 100} className="w-48 h-2" />
                </div>

                <div className="bg-white rounded-lg p-4 border">
                  <p className="text-slate-900 font-medium mb-4">{content.quiz[quizStep].question}</p>

                  <RadioGroup
                    value={selectedAnswers[quizStep]?.toString()}
                    onValueChange={(value) => setSelectedAnswers({ ...selectedAnswers, [quizStep]: parseInt(value) })}
                  >
                    {content.quiz[quizStep].options.map((option, idx) => (
                      <div key={idx} className="flex items-center space-x-2 p-3 rounded-lg hover:bg-slate-50">
                        <RadioGroupItem value={idx.toString()} id={`quiz-${idx}`} />
                        <Label htmlFor={`quiz-${idx}`} className="flex-1 cursor-pointer">{option}</Label>
                      </div>
                    ))}
                  </RadioGroup>

                  {showFeedback && (
                    <div className={`mt-4 p-4 rounded-lg ${
                      selectedAnswers[quizStep] === content.quiz[quizStep].correct_answer
                        ? 'bg-green-50 border border-green-200'
                        : 'bg-red-50 border border-red-200'
                    }`}>
                      <p className={`font-semibold mb-2 ${
                        selectedAnswers[quizStep] === content.quiz[quizStep].correct_answer
                          ? 'text-green-900'
                          : 'text-red-900'
                      }`}>
                        {selectedAnswers[quizStep] === content.quiz[quizStep].correct_answer
                          ? '✓ Correct!'
                          : '✗ Incorrect'}
                      </p>
                      <p className="text-slate-700">{content.quiz[quizStep].explanation}</p>
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  {!showFeedback ? (
                    <Button
                      onClick={handleCheckAnswer}
                      disabled={selectedAnswers[quizStep] === undefined}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      Submit Answer
                    </Button>
                  ) : (
                    <Button onClick={handleNextStep} className="bg-green-600 hover:bg-green-700">
                      {quizStep < content.quiz.length - 1 ? 'Next Question' : 'Complete Training'}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}