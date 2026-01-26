import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import { CheckCircle2, XCircle, HelpCircle, Trophy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import confetti from "canvas-confetti";

export default function ComplianceQuizSimulator({ quizQuestions, moduleId, moduleTitle, userEmail }) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [answeredQuestions, setAnsweredQuestions] = useState([]);
  const [showExplanation, setShowExplanation] = useState(false);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const queryClient = useQueryClient();

  const currentQuestion = quizQuestions[currentQuestionIndex];
  const progress = ((currentQuestionIndex + 1) / quizQuestions.length * 100).toFixed(0);

  const updateProgressMutation = useMutation({
    mutationFn: (progressData) => {
      const progressRecords = base44.entities.ComplianceTrainingProgress.filter({
        user_email: userEmail,
        training_module_id: moduleId
      });
      
      return progressRecords.then(records => {
        if (records.length > 0) {
          return base44.entities.ComplianceTrainingProgress.update(records[0].id, progressData);
        } else {
          return base44.entities.ComplianceTrainingProgress.create({
            user_email: userEmail,
            training_module_id: moduleId,
            module_title: moduleTitle,
            ...progressData
          });
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complianceTrainingProgress', userEmail] });
    }
  });

  const handleAnswerSelect = (answer) => {
    setSelectedAnswer(answer);
    setShowExplanation(false);
  };

  const handleSubmitAnswer = () => {
    if (!selectedAnswer) return;

    const isCorrect = selectedAnswer === currentQuestion.correct_answer;
    
    setAnsweredQuestions([
      ...answeredQuestions,
      {
        question: currentQuestion.question,
        user_answer: selectedAnswer,
        correct_answer: currentQuestion.correct_answer,
        is_correct: isCorrect,
        timestamp: new Date().toISOString()
      }
    ]);

    setShowExplanation(true);

    if (isCorrect) {
      toast.success("Correct!");
    } else {
      toast.error("Incorrect - Review the explanation");
    }
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedAnswer(null);
      setShowExplanation(false);
    } else {
      // Quiz complete
      completeQuiz();
    }
  };

  const completeQuiz = () => {
    const correctCount = answeredQuestions.filter(q => q.is_correct).length + 
      (selectedAnswer === currentQuestion.correct_answer ? 1 : 0);
    const score = Math.round((correctCount / quizQuestions.length) * 100);

    updateProgressMutation.mutate({
      quiz_score: score,
      quiz_attempts: 1,
      quiz_responses: [...answeredQuestions, {
        question: currentQuestion.question,
        user_answer: selectedAnswer,
        correct_answer: currentQuestion.correct_answer,
        is_correct: selectedAnswer === currentQuestion.correct_answer,
        timestamp: new Date().toISOString()
      }],
      status: score >= 80 ? 'completed' : 'in_progress',
      completion_date: score >= 80 ? new Date().toISOString() : null
    });

    setQuizCompleted(true);

    if (score >= 80) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      toast.success(`Excellent! You scored ${score}%`);
    } else {
      toast.info(`You scored ${score}%. Review and try again to master the content.`);
    }
  };

  const restartQuiz = () => {
    setCurrentQuestionIndex(0);
    setSelectedAnswer(null);
    setAnsweredQuestions([]);
    setShowExplanation(false);
    setQuizCompleted(false);
  };

  if (quizCompleted) {
    const correctCount = answeredQuestions.filter(q => q.is_correct).length;
    const score = Math.round((correctCount / quizQuestions.length) * 100);
    const passed = score >= 80;

    return (
      <Card className={passed ? "border-green-200 bg-green-50" : "border-yellow-200 bg-yellow-50"}>
        <CardContent className="p-8 text-center">
          <div className="mb-4">
            {passed ? (
              <Trophy className="w-16 h-16 text-green-600 mx-auto mb-3" />
            ) : (
              <HelpCircle className="w-16 h-16 text-yellow-600 mx-auto mb-3" />
            )}
            <h3 className="text-2xl font-bold mb-2">{passed ? "Congratulations!" : "Keep Learning"}</h3>
            <p className="text-lg mb-4">Your Score: {score}%</p>
            <p className="text-sm text-gray-700">
              {correctCount} out of {quizQuestions.length} questions correct
            </p>
          </div>

          <div className="space-y-2">
            {passed ? (
              <div className="p-3 bg-white rounded-lg border border-green-200">
                <p className="text-sm text-green-900">
                  ✓ You've mastered this compliance training! Your improved knowledge will help prevent future violations.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-white rounded-lg border border-yellow-200">
                <p className="text-sm text-yellow-900">
                  Review the learning content and try again to achieve 80% or higher.
                </p>
              </div>
            )}

            <Button
              onClick={restartQuiz}
              variant="outline"
              className="w-full"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Retake Quiz
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Compliance Knowledge Check</CardTitle>
          <Badge variant="outline">
            Question {currentQuestionIndex + 1} of {quizQuestions.length}
          </Badge>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
          <div 
            className="bg-purple-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 bg-gray-50 rounded-lg border">
          <p className="text-sm font-medium text-gray-900">{currentQuestion.question}</p>
        </div>

        <div className="space-y-2">
          {currentQuestion.options.map((option, idx) => {
            const isSelected = selectedAnswer === option;
            const isCorrect = option === currentQuestion.correct_answer;
            const showCorrectness = showExplanation;

            return (
              <button
                key={idx}
                onClick={() => !showExplanation && handleAnswerSelect(option)}
                disabled={showExplanation}
                className={`w-full p-3 text-left rounded-lg border-2 transition-all ${
                  showCorrectness && isCorrect
                    ? 'border-green-500 bg-green-50'
                    : showCorrectness && isSelected && !isCorrect
                    ? 'border-red-500 bg-red-50'
                    : isSelected
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-purple-300 bg-white'
                } ${showExplanation ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">{option}</span>
                  {showCorrectness && isCorrect && (
                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                  )}
                  {showCorrectness && isSelected && !isCorrect && (
                    <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {showExplanation && (
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs font-semibold text-blue-900 mb-1">Explanation:</p>
            <p className="text-sm text-blue-800">{currentQuestion.explanation}</p>
          </div>
        )}

        <div className="flex gap-2">
          {!showExplanation ? (
            <Button
              onClick={handleSubmitAnswer}
              disabled={!selectedAnswer}
              className="flex-1 bg-purple-600 hover:bg-purple-700"
            >
              Submit Answer
            </Button>
          ) : (
            <Button
              onClick={handleNextQuestion}
              className="flex-1 bg-purple-600 hover:bg-purple-700"
            >
              {currentQuestionIndex < quizQuestions.length - 1 ? 'Next Question' : 'Complete Quiz'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}