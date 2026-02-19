import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  BookOpen, 
  CheckCircle,
  Play,
  Award,
  Clock,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function ComplianceTrainingModule({ module, onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [showResults, setShowResults] = useState(false);
  const queryClient = useQueryClient();

  const completeModuleMutation = useMutation({
    mutationFn: async (score) => {
      const user = await base44.auth.me();
      
      return await base44.entities.TrainingCompletion.create({
        user_email: user.email,
        module_id: module.id,
        module_name: module.module_name,
        completion_date: new Date().toISOString(),
        score,
        time_spent_minutes: 0, // Would track actual time
        status: score >= 80 ? 'passed' : 'failed'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['training-completions']);
      toast.success('Training module completed!');
      onComplete?.();
    }
  });

  if (!module) return null;

  const sections = module.content?.sections || [];
  const totalSteps = sections.length + (module.quiz_questions?.length || 0);
  const progress = (currentStep / totalSteps) * 100;

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleQuizSubmit = () => {
    const questions = module.quiz_questions || [];
    let correctCount = 0;

    questions.forEach((q, idx) => {
      if (answers[idx] === q.correct_answer) {
        correctCount++;
      }
    });

    const score = (correctCount / questions.length) * 100;
    setShowResults(true);
    completeModuleMutation.mutate(score);
  };

  const isContentStep = currentStep < sections.length;
  const isQuizStep = currentStep >= sections.length;
  const quizIndex = currentStep - sections.length;

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-blue-600" />
            {module.module_name}
          </CardTitle>
          <Badge>{module.category}</Badge>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-600">Progress</span>
            <span className="text-sm font-bold">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Content Section */}
        {isContentStep && (
          <div>
            <h3 className="text-lg font-semibold mb-3">
              {sections[currentStep]?.title}
            </h3>
            <div className="prose prose-sm max-w-none">
              <p className="text-slate-700 whitespace-pre-wrap">
                {sections[currentStep]?.content}
              </p>
            </div>

            {sections[currentStep]?.key_points && (
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="font-medium text-blue-900 mb-2">Key Points:</p>
                <ul className="list-disc list-inside space-y-1">
                  {sections[currentStep].key_points.map((point, idx) => (
                    <li key={idx} className="text-sm text-blue-800">{point}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Quiz Section */}
        {isQuizStep && !showResults && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Award className="h-5 w-5 text-yellow-600" />
              <h3 className="text-lg font-semibold">
                Quiz Question {quizIndex + 1} of {module.quiz_questions?.length}
              </h3>
            </div>

            <p className="text-slate-900 mb-4 font-medium">
              {module.quiz_questions[quizIndex]?.question}
            </p>

            <div className="space-y-2">
              {module.quiz_questions[quizIndex]?.options.map((option, idx) => (
                <button
                  key={idx}
                  onClick={() => setAnswers({ ...answers, [quizIndex]: idx })}
                  className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                    answers[quizIndex] === idx
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-slate-200 hover:border-blue-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      answers[quizIndex] === idx
                        ? 'border-blue-600 bg-blue-600'
                        : 'border-slate-300'
                    }`}>
                      {answers[quizIndex] === idx && (
                        <CheckCircle className="h-3 w-3 text-white" />
                      )}
                    </div>
                    <span className="text-sm">{option}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quiz Results */}
        {showResults && (
          <div className="text-center py-8">
            <Award className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
            <h3 className="text-2xl font-bold mb-2">Module Completed!</h3>
            <p className="text-slate-600">
              You've successfully completed this training module
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 0}
          >
            Previous
          </Button>

          {currentStep === totalSteps - 1 && isQuizStep ? (
            <Button
              onClick={handleQuizSubmit}
              disabled={completeModuleMutation.isPending || showResults}
              className="bg-green-600 hover:bg-green-700"
            >
              {completeModuleMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Submit Quiz
                </>
              )}
            </Button>
          ) : (
            <Button onClick={handleNext}>
              Next
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}