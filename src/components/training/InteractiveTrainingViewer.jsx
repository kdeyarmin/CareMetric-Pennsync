import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle, XCircle, ArrowRight, Award, Loader2, BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";

export default function InteractiveTrainingViewer({ module, completion, onComplete }) {
  const queryClient = useQueryClient();
  const [currentSection, setCurrentSection] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [showResults, setShowResults] = useState(false);
  const [quizScore, setQuizScore] = useState(0);

  const hasQuiz = module.content?.quiz_questions && module.content.quiz_questions.length > 0;
  const totalSections = hasQuiz ? 2 : 1; // Content + Quiz
  const progress = Math.round(((currentSection + 1) / totalSections) * 100);

  const completeTrainingMutation = useMutation({
    mutationFn: async ({ score, status }) => {
      await base44.entities.TrainingCompletion.update(completion.id, {
        status,
        completion_date: new Date().toISOString(),
        score
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainingCompletions'] });
      queryClient.invalidateQueries({ queryKey: ['myTraining'] });
      toast.success('Training completed successfully!');
      if (onComplete) onComplete();
    }
  });

  const handleQuizSubmit = () => {
    if (!hasQuiz) return;

    const questions = module.content.quiz_questions;
    let correct = 0;

    questions.forEach((q, idx) => {
      if (quizAnswers[idx] === q.correct_answer) {
        correct++;
      }
    });

    const score = Math.round((correct / questions.length) * 100);
    setQuizScore(score);
    setShowResults(true);

    const passing = score >= (module.passing_score || 80);
    completeTrainingMutation.mutate({
      score,
      status: passing ? 'completed' : 'in_progress'
    });
  };

  const handleMarkComplete = () => {
    completeTrainingMutation.mutate({
      score: 100,
      status: 'completed'
    });
  };

  const renderContent = () => {
    if (currentSection === 0) {
      return (
        <div className="space-y-6">
          <div className="prose prose-slate max-w-none">
            {module.content?.text ? (
              <ReactMarkdown>{module.content.text}</ReactMarkdown>
            ) : (
              <p className="text-slate-600">No content available for this module.</p>
            )}
          </div>

          {module.content?.video_url && (
            <div className="aspect-video bg-slate-100 rounded-lg flex items-center justify-center">
              <iframe
                src={module.content.video_url}
                className="w-full h-full rounded-lg"
                allowFullScreen
              />
            </div>
          )}

          {module.content?.document_url && (
            <Alert>
              <BookOpen className="w-4 h-4" />
              <AlertDescription>
                <a href={module.content.document_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  View supplemental document →
                </a>
              </AlertDescription>
            </Alert>
          )}
        </div>
      );
    }

    if (currentSection === 1 && hasQuiz) {
      return (
        <div className="space-y-6">
          <Alert className="bg-blue-50 border-blue-200">
            <BookOpen className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              Complete this assessment to finish the training. Passing score: {module.passing_score || 80}%
            </AlertDescription>
          </Alert>

          {!showResults ? (
            <div className="space-y-6">
              {module.content.quiz_questions.map((question, idx) => (
                <Card key={idx} className="border-2">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      Question {idx + 1} of {module.content.quiz_questions.length}
                    </CardTitle>
                    <p className="text-sm text-slate-700">{question.question}</p>
                  </CardHeader>
                  <CardContent>
                    <RadioGroup 
                      value={quizAnswers[idx]?.toString()} 
                      onValueChange={(value) => setQuizAnswers({ ...quizAnswers, [idx]: parseInt(value) })}
                    >
                      <div className="space-y-2">
                        {question.options.map((option, optionIdx) => (
                          <label
                            key={optionIdx}
                            className="flex items-center space-x-3 p-3 rounded-lg border cursor-pointer hover:bg-slate-50"
                          >
                            <RadioGroupItem value={optionIdx.toString()} id={`q${idx}-${optionIdx}`} />
                            <span className="text-sm text-slate-700">{option}</span>
                          </label>
                        ))}
                      </div>
                    </RadioGroup>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              <Card className={quizScore >= (module.passing_score || 80) ? "border-green-200 bg-green-50" : "border-yellow-200 bg-yellow-50"}>
                <CardContent className="pt-6 text-center">
                  {quizScore >= (module.passing_score || 80) ? (
                    <>
                      <Award className="w-16 h-16 text-green-600 mx-auto mb-4" />
                      <h3 className="text-2xl font-bold text-green-900 mb-2">Congratulations!</h3>
                      <p className="text-green-800">You passed with a score of {quizScore}%</p>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-16 h-16 text-yellow-600 mx-auto mb-4" />
                      <h3 className="text-2xl font-bold text-yellow-900 mb-2">Keep Learning</h3>
                      <p className="text-yellow-800">You scored {quizScore}%. Review the material and try again.</p>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Show correct/incorrect answers */}
              <div className="space-y-4">
                {module.content.quiz_questions.map((question, idx) => {
                  const userAnswer = quizAnswers[idx];
                  const isCorrect = userAnswer === question.correct_answer;

                  return (
                    <Card key={idx} className={isCorrect ? "border-green-200" : "border-red-200"}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-2">
                          {isCorrect ? (
                            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                          ) : (
                            <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                          )}
                          <div>
                            <CardTitle className="text-sm">{question.question}</CardTitle>
                            <p className="text-xs text-slate-500 mt-1">
                              Your answer: {question.options[userAnswer]}
                            </p>
                            {!isCorrect && (
                              <p className="text-xs text-green-700 mt-1">
                                Correct: {question.options[question.correct_answer]}
                              </p>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      {question.explanation && (
                        <CardContent>
                          <p className="text-sm text-slate-600">{question.explanation}</p>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Progress Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">Training Progress</span>
            <span className="text-sm font-bold text-blue-600">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
            <span>Section {currentSection + 1} of {totalSections}</span>
            {completion?.due_date && (
              <span>Due: {format(new Date(completion.due_date), 'MMM d, yyyy')}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge>{module.category}</Badge>
            {module.difficulty_level && (
              <Badge variant="outline">{module.difficulty_level}</Badge>
            )}
          </div>
          <CardTitle className="text-2xl mt-2">{module.title}</CardTitle>
          {module.description && (
            <CardDescription className="text-base">{module.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentSection(Math.max(0, currentSection - 1))}
          disabled={currentSection === 0}
        >
          ← Previous
        </Button>

        {currentSection === 0 && hasQuiz ? (
          <Button onClick={() => setCurrentSection(1)} className="bg-blue-600 hover:bg-blue-700">
            Continue to Assessment
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : currentSection === 1 && hasQuiz && !showResults ? (
          <Button 
            onClick={handleQuizSubmit}
            disabled={Object.keys(quizAnswers).length < module.content.quiz_questions.length}
            className="bg-green-600 hover:bg-green-700"
          >
            Submit Assessment
            <CheckCircle className="w-4 h-4 ml-2" />
          </Button>
        ) : !hasQuiz ? (
          <Button 
            onClick={handleMarkComplete}
            disabled={completeTrainingMutation.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            {completeTrainingMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              <>
                Mark Complete
                <CheckCircle className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}