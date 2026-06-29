import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  ChevronRight,
  RotateCcw,
  Trophy,
  Target,
  Lightbulb
} from "lucide-react";

export default function AIInteractiveQuiz({ 
  topic, 
  difficulty = "intermediate",
  questionCount = 5,
  onComplete 
}) {
  const ai = useAICall();
  const [quiz, setQuiz] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [showExplanation, setShowExplanation] = useState(false);
  const [quizComplete, setQuizComplete] = useState(false);
  const [score, setScore] = useState(0);

  const generateQuiz = async () => {
    setQuiz(null);
    setCurrentQuestion(0);
    setAnswers([]);
    setQuizComplete(false);
    setScore(0);

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate an interactive quiz for home health nurses on the topic: "${topic}"

Difficulty Level: ${difficulty}
Number of Questions: ${questionCount}

Create questions that test practical knowledge of Medicare compliance and home health documentation.
Each question should:
1. Be scenario-based when possible
2. Have 4 answer options (A, B, C, D)
3. Include a detailed explanation for the correct answer
4. Include a tip for remembering the concept

Focus on real-world application, not just memorization.`,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "number" },
                  question: { type: "string" },
                  scenario: { type: "string" },
                  options: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        letter: { type: "string" },
                        text: { type: "string" }
                      }
                    }
                  },
                  correct_answer: { type: "string" },
                  explanation: { type: "string" },
                  memory_tip: { type: "string" },
                  difficulty: { type: "string" }
                }
              }
            }
          }
        }
      });

      if (!Array.isArray(result?.questions) || result.questions.length === 0) {
        toast.error("The quiz couldn't be generated. Please try again.");
        return;
      }
      setQuiz(result);
    } catch (error) {
      console.error("Error generating quiz:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const handleAnswer = () => {
    const question = quiz.questions[currentQuestion];
    const isCorrect = selectedAnswer === question.correct_answer;
    
    setAnswers([...answers, { 
      questionId: question.id, 
      selected: selectedAnswer, 
      correct: question.correct_answer,
      isCorrect 
    }]);
    
    if (isCorrect) setScore(score + 1);
    setShowExplanation(true);
  };

  const nextQuestion = () => {
    if (currentQuestion < quiz.questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedAnswer(null);
      setShowExplanation(false);
    } else {
      setQuizComplete(true);
      onComplete?.({
        topic,
        score,
        total: quiz.questions.length,
        percentage: Math.round((score / quiz.questions.length) * 100),
        answers
      });
    }
  };

  const resetQuiz = () => {
    setCurrentQuestion(0);
    setSelectedAnswer(null);
    setAnswers([]);
    setShowExplanation(false);
    setQuizComplete(false);
    setScore(0);
  };

  if (!quiz && !ai.loading) {
    return (
      <Card className="border-2 border-navy-200">
        <CardContent className="p-6 text-center">
          <Brain className="w-12 h-12 text-navy-600 mx-auto mb-3" />
          <h3 className="font-semibold text-lg mb-2">AI-Generated Quiz</h3>
          <p className="text-sm text-slate-600 mb-4">
            Test your knowledge on: <strong>{topic}</strong>
          </p>
          <div className="flex justify-center gap-2 mb-4">
            <Badge variant="outline">{difficulty}</Badge>
            <Badge variant="outline">{questionCount} questions</Badge>
          </div>
          <Button onClick={generateQuiz} className="bg-navy-600 hover:bg-navy-700">
            <Sparkles className="w-4 h-4 mr-2" /> Generate Quiz
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (ai.loading) {
    return (
      <Card className="border-2 border-navy-200">
        <CardContent className="p-8 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-navy-600 mx-auto mb-3" />
          <p className="text-sm text-slate-600">Creating your personalized quiz...</p>
        </CardContent>
      </Card>
    );
  }

  if (quizComplete) {
    const percentage = Math.round((score / quiz.questions.length) * 100);
    return (
      <Card className="border-2 border-navy-200">
        <CardContent className="p-6">
          <div className="text-center mb-6">
            <Trophy className={`w-16 h-16 mx-auto mb-3 ${percentage >= 80 ? 'text-yellow-500' : percentage >= 60 ? 'text-slate-400' : 'text-orange-400'}`} />
            <h3 className="text-2xl font-bold mb-1">Quiz Complete!</h3>
            <p className="text-slate-600">You scored</p>
            <p className={`text-4xl font-bold ${percentage >= 80 ? 'text-green-600' : percentage >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
              {score}/{quiz.questions.length}
            </p>
            <p className="text-lg text-slate-500">{percentage}%</p>
          </div>

          <div className="space-y-2 mb-6">
            {answers.map((ans, idx) => (
              <div key={idx} className={`flex items-center gap-2 p-2 rounded ${ans.isCorrect ? 'bg-green-50' : 'bg-red-50'}`}>
                {ans.isCorrect ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
                <span className="text-sm">Question {idx + 1}</span>
                {!ans.isCorrect && (
                  <span className="text-xs text-slate-500 ml-auto">
                    Correct: {ans.correct}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button onClick={resetQuiz} variant="outline" className="flex-1">
              <RotateCcw className="w-4 h-4 mr-2" /> Retry
            </Button>
            <Button onClick={generateQuiz} className="flex-1 bg-navy-600 hover:bg-navy-700">
              <Sparkles className="w-4 h-4 mr-2" /> New Quiz
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const question = quiz.questions[currentQuestion];

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-indigo-50 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-4 h-4 text-navy-600" />
            {quiz.title}
          </CardTitle>
          <Badge variant="outline">
            {currentQuestion + 1} / {quiz.questions.length}
          </Badge>
        </div>
        <Progress value={((currentQuestion + 1) / quiz.questions.length) * 100} className="h-1 mt-2" />
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Scenario */}
        {question.scenario && (
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <p className="text-xs font-semibold text-blue-800 mb-1">Scenario:</p>
            <p className="text-sm text-blue-900">{question.scenario}</p>
          </div>
        )}

        {/* Question */}
        <div>
          <p className="font-medium text-slate-900 mb-4">{question.question}</p>

          <RadioGroup value={selectedAnswer} onValueChange={setSelectedAnswer} disabled={showExplanation}>
            <div className="space-y-2">
              {question.options.map((option) => (
                <div
                  key={option.letter}
                  className={`flex items-center space-x-2 p-3 rounded-lg border transition-colors ${
                    showExplanation
                      ? option.letter === question.correct_answer
                        ? 'bg-green-50 border-green-300'
                        : selectedAnswer === option.letter
                        ? 'bg-red-50 border-red-300'
                        : 'bg-slate-50 border-slate-200'
                      : selectedAnswer === option.letter
                      ? 'bg-navy-50 border-navy-300'
                      : 'hover:bg-slate-50 border-slate-200'
                  }`}
                >
                  <RadioGroupItem value={option.letter} id={option.letter} />
                  <Label htmlFor={option.letter} className="flex-1 cursor-pointer text-sm">
                    <span className="font-semibold mr-2">{option.letter}.</span>
                    {option.text}
                  </Label>
                  {showExplanation && option.letter === question.correct_answer && (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  )}
                  {showExplanation && selectedAnswer === option.letter && option.letter !== question.correct_answer && (
                    <XCircle className="w-5 h-5 text-red-600" />
                  )}
                </div>
              ))}
            </div>
          </RadioGroup>
        </div>

        {/* Explanation */}
        {showExplanation && (
          <div className="space-y-3">
            <div className="bg-green-50 p-3 rounded-lg border border-green-200">
              <p className="text-xs font-semibold text-green-800 mb-1">Explanation:</p>
              <p className="text-sm text-green-900">{question.explanation}</p>
            </div>
            {question.memory_tip && (
              <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                <p className="text-xs font-semibold text-yellow-800 mb-1 flex items-center gap-1">
                  <Lightbulb className="w-3 h-3" /> Memory Tip:
                </p>
                <p className="text-sm text-yellow-900">{question.memory_tip}</p>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {!showExplanation ? (
            <Button
              onClick={handleAnswer}
              disabled={!selectedAnswer}
              className="w-full bg-navy-600 hover:bg-navy-700"
            >
              <Target className="w-4 h-4 mr-2" /> Submit Answer
            </Button>
          ) : (
            <Button onClick={nextQuestion} className="w-full bg-navy-600 hover:bg-navy-700">
              {currentQuestion < quiz.questions.length - 1 ? (
                <>Next Question <ChevronRight className="w-4 h-4 ml-2" /></>
              ) : (
                <>View Results <Trophy className="w-4 h-4 ml-2" /></>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}