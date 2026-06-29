import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { safePercent } from "@/lib/safePercent";
import { DEFAULT_PASSING_SCORE } from "@/constants/training";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Brain,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Trophy,
  RefreshCw,
  Sparkles
} from "lucide-react";

const quizTopics = [
  {
    id: 'medicare_cop',
    title: 'Medicare Conditions of Participation',
    description: 'Test your knowledge of Medicare CoP requirements',
    difficulty: 'hard'
  },
  {
    id: 'oasis',
    title: 'OASIS Documentation',
    description: 'Practice OASIS assessment documentation',
    difficulty: 'medium'
  },
  {
    id: 'homebound',
    title: 'Homebound Status',
    description: 'Master homebound criteria and documentation',
    difficulty: 'medium'
  },
  {
    id: 'skilled_need',
    title: 'Skilled Need Justification',
    description: 'Learn to justify skilled nursing services',
    difficulty: 'medium'
  },
  {
    id: 'infection_control',
    title: 'Infection Control',
    description: 'Test infection prevention knowledge',
    difficulty: 'easy'
  },
  {
    id: 'safety',
    title: 'Patient Safety',
    description: 'Practice patient safety protocols',
    difficulty: 'easy'
  }
];

export default function AIComplianceQuizGenerator({ nurseEmail, _recommendations = [], initialTopicId = null }) {
  const queryClient = useQueryClient();
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const ai = useAICall();
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState({});
  const [showResults, setShowResults] = useState(false);
  const [quizResults, setQuizResults] = useState(null);

  // Auto-generate quiz if topic provided
  React.useEffect(() => {
    if (initialTopicId && !quiz) {
      const topic = quizTopics.find(t => t.id === initialTopicId);
      if (topic) {
        generateQuiz(topic);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional run-once auto-generate on mount; guarded so it can't re-fire
  }, [initialTopicId, quiz]);

  const savePracticeMutation = useMutation({
    mutationFn: async (practiceData) => {
      return base44.entities.MicroLearningProgress.create(practiceData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTrainingProgress'] });
    }
  });

  const generateQuiz = async (topic) => {
    try {
      const prompt = `Generate a 5-question multiple choice quiz about ${topic.title} for home health nurses.

Topic: ${topic.title}
Description: ${topic.description}
Difficulty: ${topic.difficulty}

Create questions that test:
- Medicare compliance requirements
- Best practices in documentation
- Common errors to avoid
- Clinical decision making

Return JSON format:
{
  "questions": [
    {
      "question": "Clear question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "Detailed explanation of why this answer is correct",
      "references": "Medicare CoP 484.50 or relevant guideline"
    }
  ]
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
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
                  correctAnswer: { type: "number" },
                  explanation: { type: "string" },
                  references: { type: "string" }
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
      setSelectedTopic(topic);
      setCurrentQuestionIndex(0);
      setUserAnswers({});
      setShowResults(false);
    } catch (error) {
      console.error("Error generating quiz:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const handleAnswerSelect = (questionIndex, answerIndex) => {
    setUserAnswers(prev => ({
      ...prev,
      [questionIndex]: answerIndex
    }));
  };

  const handleSubmitQuiz = async () => {
    const correctCount = quiz.questions.reduce((count, question, index) => {
      return count + (userAnswers[index] === question.correctAnswer ? 1 : 0);
    }, 0);

    const score = safePercent(correctCount, quiz.questions.length);
    const passed = score >= DEFAULT_PASSING_SCORE;

    const results = {
      score,
      passed,
      correctCount,
      totalQuestions: quiz.questions.length,
      questionResults: quiz.questions.map((question, index) => ({
        correct: userAnswers[index] === question.correctAnswer,
        userAnswer: userAnswers[index],
        correctAnswer: question.correctAnswer
      }))
    };

    setQuizResults(results);
    setShowResults(true);

    // Save quiz progress
    if (nurseEmail) {
      await savePracticeMutation.mutateAsync({
        nurse_email: nurseEmail,
        skill_area: selectedTopic.title,
        module_type: 'quiz',
        content: {
          topic_id: selectedTopic.id,
          questions: quiz.questions,
          userAnswers,
          results
        },
        status: passed ? 'completed' : 'needs_review',
        score,
        attempts: 1,
        source: 'manual'
      });
    }
  };

  const handleRetake = () => {
    setUserAnswers({});
    setShowResults(false);
    setQuizResults(null);
    setCurrentQuestionIndex(0);
  };

  const handleNewQuiz = () => {
    setQuiz(null);
    setSelectedTopic(null);
    setUserAnswers({});
    setShowResults(false);
    setQuizResults(null);
  };

  if (!quiz) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            Choose a Quiz Topic
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quizTopics.map((topic) => (
              <Card 
                key={topic.id} 
                className="hover:shadow-lg transition-all cursor-pointer"
                onClick={() => generateQuiz(topic)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <Badge className={
                      topic.difficulty === 'easy' ? 'bg-green-100 text-green-800' :
                      topic.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }>
                      {topic.difficulty}
                    </Badge>
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{topic.title}</h3>
                  <p className="text-sm text-slate-600 mb-3">{topic.description}</p>
                  <Button 
                    size="sm" 
                    className="w-full"
                    disabled={ai.loading}
                  >
                    {ai.loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Generate Quiz
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (showResults) {
    return (
      <div className="space-y-6">
        <Card className={quizResults.passed ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {quizResults.passed ? (
                  <>
                    <Trophy className="w-6 h-6 text-green-600" />
                    <span className="text-green-900">Congratulations!</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-6 h-6 text-orange-600" />
                    <span className="text-orange-900">Keep Practicing</span>
                  </>
                )}
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold">{quizResults.score}%</div>
                <div className="text-sm text-slate-600">
                  {quizResults.correctCount} / {quizResults.totalQuestions} correct
                </div>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={quizResults.score} className="h-3" />

            <div className="flex gap-2">
              <Button onClick={handleRetake} variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Retake Quiz
              </Button>
              <Button onClick={handleNewQuiz} className="bg-navy-600 hover:bg-navy-700">
                Try Different Topic
              </Button>
            </div>
          </CardContent>
        </Card>

        {quiz.questions.map((question, qIndex) => {
          const isCorrect = userAnswers[qIndex] === question.correctAnswer;
          return (
            <Card key={qIndex} className={isCorrect ? 'border-green-200' : 'border-red-200'}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  {isCorrect ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600" />
                  )}
                  Question {qIndex + 1}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="font-medium">{question.question}</p>

                <div className="space-y-2">
                  {question.options.map((option, oIndex) => {
                    const isUserAnswer = userAnswers[qIndex] === oIndex;
                    const isCorrectAnswer = question.correctAnswer === oIndex;
                    
                    return (
                      <div
                        key={oIndex}
                        className={`p-3 rounded border ${
                          isCorrectAnswer
                            ? 'bg-green-50 border-green-300'
                            : isUserAnswer
                            ? 'bg-red-50 border-red-300'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {isCorrectAnswer && (
                            <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                          )}
                          {isUserAnswer && !isCorrectAnswer && (
                            <XCircle className="w-4 h-4 text-red-600 mt-0.5" />
                          )}
                          <div className="flex-1">
                            <p className="text-sm">{option}</p>
                            {isCorrectAnswer && (
                              <Badge className="mt-1 bg-green-600 text-white">Correct Answer</Badge>
                            )}
                            {isUserAnswer && !isCorrectAnswer && (
                              <Badge className="mt-1 bg-red-600 text-white">Your Answer</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <h4 className="font-semibold text-blue-900 mb-2">Explanation:</h4>
                  <p className="text-sm text-slate-700 mb-2">{question.explanation}</p>
                  <p className="text-xs text-slate-600 italic">Reference: {question.references}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  const currentQuestion = quiz.questions[currentQuestionIndex];
  const progress = ((currentQuestionIndex + 1) / quiz.questions.length) * 100;
  const allAnswered = Object.keys(userAnswers).length === quiz.questions.length;

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-r from-navy-50 to-gold-50 border-navy-200">
        <CardHeader>
          <div className="flex items-center justify-between mb-2">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-navy-600" />
              {selectedTopic.title} Quiz
            </CardTitle>
            <Badge>{selectedTopic.difficulty}</Badge>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Question {currentQuestionIndex + 1} of {quiz.questions.length}</span>
              <span>{Object.keys(userAnswers).length} answered</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Question {currentQuestionIndex + 1}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-slate-900 font-medium">{currentQuestion.question}</p>

          <RadioGroup
            value={userAnswers[currentQuestionIndex]?.toString()}
            onValueChange={(value) => handleAnswerSelect(currentQuestionIndex, parseInt(value))}
          >
            <div className="space-y-3">
              {currentQuestion.options.map((option, index) => (
                <div key={index} className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-slate-50 cursor-pointer">
                  <RadioGroupItem value={index.toString()} id={`q${currentQuestionIndex}-option${index}`} />
                  <Label htmlFor={`q${currentQuestionIndex}-option${index}`} className="flex-1 cursor-pointer">
                    {option}
                  </Label>
                </div>
              ))}
            </div>
          </RadioGroup>

          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
              disabled={currentQuestionIndex === 0}
            >
              Previous
            </Button>

            {currentQuestionIndex < quiz.questions.length - 1 ? (
              <Button
                onClick={() => setCurrentQuestionIndex(currentQuestionIndex + 1)}
              >
                Next Question
              </Button>
            ) : (
              <Button
                onClick={handleSubmitQuiz}
                disabled={!allAnswered}
                className="bg-navy-600 hover:bg-navy-700"
              >
                Submit Quiz
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Question Navigator */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Question Navigator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {quiz.questions.map((_, index) => (
              <Button
                key={index}
                variant={index === currentQuestionIndex ? "default" : "outline"}
                size="sm"
                className={`w-10 h-10 ${userAnswers[index] !== undefined ? 'bg-green-100 border-green-300' : ''}`}
                onClick={() => setCurrentQuestionIndex(index)}
              >
                {index + 1}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}