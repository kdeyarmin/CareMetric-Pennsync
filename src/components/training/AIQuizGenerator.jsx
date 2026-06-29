import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { safePercent } from "@/lib/safePercent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Sparkles, CheckCircle2, XCircle, HelpCircle, ArrowRight, RotateCcw, Trophy } from "lucide-react";
import { toast } from 'sonner';

export default function AIQuizGenerator({ trainingContent, moduleTitle, onComplete }) {
  const ai = useAICall();
  const [quiz, setQuiz] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [showResults, setShowResults] = useState(false);
  const [quizResults, setQuizResults] = useState(null);

  const generateQuiz = async () => {
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate a comprehensive nursing quiz based on the following training content.

TRAINING CONTENT:
${trainingContent}

MODULE TITLE: ${moduleTitle}

Create 10 multiple-choice questions that:
1. Test critical knowledge and understanding
2. Include realistic clinical scenarios
3. Have 4 answer options each
4. Provide detailed explanations for correct answers
5. Cover different aspects of the material
6. Include application/critical thinking questions, not just recall

Return JSON with:
{
  "questions": [
    {
      "question": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": 0,
      "explanation": "Detailed explanation of why this is correct",
      "difficulty": "easy|medium|hard",
      "category": "knowledge|application|analysis"
    }
  ],
  "quiz_title": "Title for this quiz",
  "passing_score": 80
}`,
        response_json_schema: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  options: { type: "array", items: { type: "string" } },
                  correct_answer: { type: "number" },
                  explanation: { type: "string" },
                  difficulty: { type: "string" },
                  category: { type: "string" }
                }
              }
            },
            quiz_title: { type: "string" },
            passing_score: { type: "number" }
          }
        }
      });

      if (!Array.isArray(result?.questions) || result.questions.length === 0) {
        toast.error("The quiz couldn't be generated. Please try again.");
        return;
      }
      setQuiz(result);
      setCurrentQuestion(0);
      setSelectedAnswers({});
      setShowResults(false);
    } catch (error) {
      console.error('Quiz generation error:', error);
      toast.error('Failed to generate quiz. Please try again.');
    }
  };

  const handleAnswerSelect = (questionIndex, answerIndex) => {
    setSelectedAnswers({
      ...selectedAnswers,
      [questionIndex]: answerIndex
    });
  };

  const handleSubmitQuiz = () => {
    const correctCount = quiz.questions.filter((q, idx) => 
      selectedAnswers[idx] === q.correct_answer
    ).length;
    
    const score = safePercent(correctCount, quiz.questions.length);
    const passed = score >= (quiz.passing_score || 80);

    setQuizResults({
      score,
      passed,
      correctCount,
      totalQuestions: quiz.questions.length,
      passingScore: quiz.passing_score || 80
    });
    setShowResults(true);
    onComplete?.({ score, passed, totalQuestions: quiz.questions.length });
  };

  const handleRetry = () => {
    setCurrentQuestion(0);
    setSelectedAnswers({});
    setShowResults(false);
    setQuizResults(null);
  };

  if (!quiz) {
    return (
      <Card className="border-2 border-navy-200">
        <CardContent className="p-8 text-center">
          <Sparkles className="w-16 h-16 text-navy-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-slate-900 mb-2">AI Quiz Generator</h3>
          <p className="text-slate-600 mb-6">
            Generate an interactive quiz based on the training material to assess understanding
          </p>
          <Button
            onClick={generateQuiz}
            disabled={ai.loading || !trainingContent}
            className="bg-navy-600 hover:bg-navy-700"
            size="lg"
          >
            {ai.loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                Generating Quiz...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Generate Quiz
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (showResults) {
    return (
      <Card className={`border-4 ${quizResults.passed ? 'border-green-400 bg-green-50' : 'border-orange-400 bg-orange-50'}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {quizResults.passed ? (
              <Trophy className="w-6 h-6 text-green-600" />
            ) : (
              <HelpCircle className="w-6 h-6 text-orange-600" />
            )}
            Quiz Results
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <div className={`text-6xl font-bold mb-2 ${quizResults.passed ? 'text-green-600' : 'text-orange-600'}`}>
              {quizResults.score}%
            </div>
            <p className="text-lg text-slate-700 mb-1">
              {quizResults.correctCount} of {quizResults.totalQuestions} correct
            </p>
            <Badge className={`text-sm ${quizResults.passed ? 'bg-green-600' : 'bg-orange-500'}`}>
              {quizResults.passed ? '✓ Passed' : `Need ${quizResults.passingScore}% to pass`}
            </Badge>
          </div>

          {/* Question Review */}
          <div className="space-y-3">
            <h4 className="font-semibold text-slate-900">Review Your Answers</h4>
            {quiz.questions.map((q, idx) => {
              const isCorrect = selectedAnswers[idx] === q.correct_answer;
              return (
                <Card key={idx} className={`border-l-4 ${isCorrect ? 'border-l-green-500 bg-green-50' : 'border-l-red-500 bg-red-50'}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-2 mb-2">
                      {isCorrect ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-900 mb-2">{q.question}</p>
                        <div className="space-y-1 text-sm">
                          <p className={isCorrect ? 'text-green-700' : 'text-red-700'}>
                            Your answer: {q.options[selectedAnswers[idx]]}
                          </p>
                          {!isCorrect && (
                            <p className="text-green-700">
                              Correct answer: {q.options[q.correct_answer]}
                            </p>
                          )}
                        </div>
                        <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-900">
                          <strong>Explanation:</strong> {q.explanation}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex gap-3">
            <Button onClick={handleRetry} variant="outline" className="flex-1">
              <RotateCcw className="w-4 h-4 mr-2" />
              Retake Quiz
            </Button>
            <Button onClick={() => setQuiz(null)} className="flex-1 bg-blue-600 hover:bg-blue-700">
              Generate New Quiz
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const question = quiz.questions[currentQuestion];
  const progress = ((currentQuestion + 1) / quiz.questions.length) * 100;
  const allAnswered = Object.keys(selectedAnswers).length === quiz.questions.length;

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader>
        <div className="flex items-center justify-between mb-2">
          <CardTitle className="text-lg">{quiz.quiz_title}</CardTitle>
          <Badge variant="outline">
            Question {currentQuestion + 1} of {quiz.questions.length}
          </Badge>
        </div>
        <Progress value={progress} className="h-2" />
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Question */}
        <div className="space-y-4">
          <div className="flex items-start gap-2">
            <Badge className={`mt-1 ${
              question.difficulty === 'hard' ? 'bg-red-600' :
              question.difficulty === 'medium' ? 'bg-yellow-500' : 'bg-green-600'
            }`}>
              {question.difficulty}
            </Badge>
            <h3 className="text-lg font-medium text-slate-900 flex-1">{question.question}</h3>
          </div>

          <RadioGroup
            value={selectedAnswers[currentQuestion]?.toString()}
            onValueChange={(value) => handleAnswerSelect(currentQuestion, parseInt(value))}
          >
            {question.options.map((option, idx) => (
              <div key={idx} className="flex items-center space-x-3 p-3 rounded-lg border-2 border-slate-200 hover:border-navy-300 hover:bg-navy-50 transition-colors">
                <RadioGroupItem value={idx.toString()} id={`option-${idx}`} />
                <Label htmlFor={`option-${idx}`} className="flex-1 cursor-pointer text-sm">
                  {option}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Navigation */}
        <div className="flex justify-between items-center pt-4 border-t">
          <Button
            onClick={() => setCurrentQuestion(currentQuestion - 1)}
            disabled={currentQuestion === 0}
            variant="outline"
          >
            Previous
          </Button>

          <div className="text-sm text-slate-600">
            {selectedAnswers[currentQuestion] !== undefined ? (
              <span className="text-green-600 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> Answered
              </span>
            ) : (
              <span className="text-orange-600">Select an answer</span>
            )}
          </div>

          {currentQuestion < quiz.questions.length - 1 ? (
            <Button
              onClick={() => setCurrentQuestion(currentQuestion + 1)}
              disabled={selectedAnswers[currentQuestion] === undefined}
              className="bg-navy-600 hover:bg-navy-700"
            >
              Next <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmitQuiz}
              disabled={!allAnswered}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Submit Quiz
            </Button>
          )}
        </div>

        {/* Progress Indicator */}
        <div className="text-center text-sm text-slate-500">
          {Object.keys(selectedAnswers).length} of {quiz.questions.length} questions answered
        </div>
      </CardContent>
    </Card>
  );
}