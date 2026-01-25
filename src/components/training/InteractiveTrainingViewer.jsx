import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle, XCircle, ArrowRight, Award, Loader2 } from "lucide-react";

export default function InteractiveTrainingViewer({ module, completion, userEmail }) {
  const queryClient = useQueryClient();
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [quizComplete, setQuizComplete] = useState(false);
  const [score, setScore] = useState(null);

  const questions = module.content?.quiz_questions || [];
  const hasQuiz = questions.length > 0;

  const completeTrainingMutation = useMutation({
    mutationFn: async ({ score, status }) => {
      if (completion) {
        await base44.entities.TrainingCompletion.update(completion.id, {
          status: status,
          score: score,
          completion_date: new Date().toISOString().split('T')[0]
        });
      } else {
        await base44.entities.TrainingCompletion.create({
          nurse_email: userEmail,
          training_module_id: module.id,
          status: status,
          score: score,
          completion_date: new Date().toISOString().split('T')[0]
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainingCompletions'] });
      queryClient.invalidateQueries({ queryKey: ['myTraining'] });
      toast.success('Training completed!');
    }
  });

  const handleAnswerSelect = (answer) => {
    setSelectedAnswers({
      ...selectedAnswers,
      [currentQuestion]: answer
    });
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const handleSubmitQuiz = () => {
    let correct = 0;
    questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correct_answer) {
        correct++;
      }
    });

    const finalScore = Math.round((correct / questions.length) * 100);
    setScore(finalScore);
    setQuizComplete(true);

    const passed = finalScore >= module.passing_score;
    completeTrainingMutation.mutate({
      score: finalScore,
      status: passed ? 'completed' : 'in_progress'
    });
  };

  const handleMarkComplete = () => {
    completeTrainingMutation.mutate({
      score: 100,
      status: 'completed'
    });
  };

  const currentQ = questions[currentQuestion];
  const progress = ((currentQuestion + 1) / questions.length) * 100;

  if (quizComplete && score !== null) {
    const passed = score >= module.passing_score;
    return (
      <Card>
        <CardContent className="py-8 text-center">
          {passed ? (
            <div className="space-y-4">
              <Award className="w-16 h-16 text-green-600 mx-auto" />
              <h3 className="text-2xl font-bold text-green-900">Congratulations!</h3>
              <p className="text-lg">You scored {score}% and passed this training.</p>
              <Badge className="bg-green-600 text-lg py-2 px-4">
                <CheckCircle className="w-5 h-5 mr-2" />
                Training Completed
              </Badge>
            </div>
          ) : (
            <div className="space-y-4">
              <XCircle className="w-16 h-16 text-orange-600 mx-auto" />
              <h3 className="text-2xl font-bold text-orange-900">Keep Learning</h3>
              <p className="text-lg">You scored {score}%. The passing score is {module.passing_score}%.</p>
              <Button onClick={() => {
                setQuizComplete(false);
                setCurrentQuestion(0);
                setSelectedAnswers({});
                setScore(null);
              }}>
                Retry Quiz
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Content Display */}
      {module.content_type === 'video' && module.content?.video_url && (
        <Card>
          <CardContent className="pt-6">
            <video controls className="w-full rounded-lg">
              <source src={module.content.video_url} />
            </video>
          </CardContent>
        </Card>
      )}

      {module.content_type === 'document' && module.content?.document_url && (
        <Card>
          <CardContent className="pt-6">
            <a 
              href={module.content.document_url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-blue-600 hover:underline"
            >
              <FileText className="w-5 h-5" />
              Download Training Material
            </a>
          </CardContent>
        </Card>
      )}

      {/* Quiz Section */}
      {hasQuiz && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Quiz: Question {currentQuestion + 1} of {questions.length}</CardTitle>
              <Badge variant="outline">{Math.round(progress)}%</Badge>
            </div>
            <Progress value={progress} className="mt-2" />
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="font-medium text-lg">{currentQ?.question}</p>
            
            <div className="space-y-2">
              {currentQ?.options.map((option, idx) => (
                <button
                  key={idx}
                  onClick={() => handleAnswerSelect(idx)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    selectedAnswers[currentQuestion] === idx
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span className="font-medium">{String.fromCharCode(65 + idx)}.</span> {option}
                </button>
              ))}
            </div>

            <div className="flex justify-between pt-4">
              {currentQuestion < questions.length - 1 ? (
                <Button 
                  onClick={handleNext}
                  disabled={selectedAnswers[currentQuestion] === undefined}
                  className="ml-auto"
                >
                  Next Question
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <Button 
                  onClick={handleSubmitQuiz}
                  disabled={Object.keys(selectedAnswers).length !== questions.length || completeTrainingMutation.isPending}
                  className="ml-auto bg-green-600 hover:bg-green-700"
                >
                  {completeTrainingMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  Submit Quiz
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mark Complete for content-only modules */}
      {!hasQuiz && (
        <Button 
          onClick={handleMarkComplete}
          disabled={completeTrainingMutation.isPending}
          className="w-full bg-green-600 hover:bg-green-700"
        >
          {completeTrainingMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <CheckCircle className="w-4 h-4 mr-2" />
          )}
          Mark as Complete
        </Button>
      )}
    </div>
  );
}