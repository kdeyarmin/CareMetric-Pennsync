import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Brain, Users, Target, FileText, GraduationCap, CheckCircle2, 
  ArrowRight, Play, X, Lightbulb, Sparkles 
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const onboardingSteps = [
  {
    id: "welcome",
    title: "Welcome to CareMetric AI! 👋",
    description: "Let's get you started with a quick tour of the most important features.",
    icon: Sparkles,
    color: "blue"
  },
  {
    id: "smart_notes",
    title: "AI Smart Notes",
    description: "Transform rough notes into Medicare-compliant documentation in seconds. Just dictate or type your observations, and AI handles the rest.",
    icon: Brain,
    page: "SmartNoteAssistant",
    videoUrl: "https://www.youtube.com/embed/example1",
    tips: [
      "Use voice dictation for faster input",
      "Review AI suggestions before finalizing",
      "All notes are automatically checked for compliance"
    ],
    color: "purple"
  },
  {
    id: "patients",
    title: "Patient Management",
    description: "Easily manage your patient caseload, track vitals, medications, and care plans all in one place.",
    icon: Users,
    page: "Patients",
    tips: [
      "Use search to quickly find patients",
      "Filter by status or care type",
      "Add favorites for quick access"
    ],
    color: "green"
  },
  {
    id: "care_plans",
    title: "AI Care Plans",
    description: "Generate personalized care plans automatically based on diagnoses and patient history.",
    icon: Target,
    page: "CarePlanManagement",
    tips: [
      "Care plans auto-populate from diagnoses",
      "Track progress and adjust goals",
      "Share updates with the care team"
    ],
    color: "orange"
  },
  {
    id: "training",
    title: "Training & Education",
    description: "Access personalized training modules and stay updated on Medicare regulations.",
    icon: GraduationCap,
    page: "StaffTrainingHub",
    tips: [
      "Complete recommended training for your role",
      "Track certifications and renewals",
      "Get AI-powered learning recommendations"
    ],
    color: "indigo"
  }
];

export default function InteractiveOnboarding() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showTutorial, setShowTutorial] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const updateUserMutation = useMutation({
    mutationFn: (data) => base44.auth.updateMe(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    }
  });

  useEffect(() => {
    // Show onboarding for new users (within 24 hours of signup)
    if (currentUser && !currentUser.onboarding_completed) {
      const accountAge = new Date() - new Date(currentUser.created_date);
      const oneDayMs = 24 * 60 * 60 * 1000;
      
      if (accountAge < oneDayMs) {
        setOpen(true);
      }
    }
  }, [currentUser]);

  const handleComplete = () => {
    updateUserMutation.mutate({ onboarding_completed: true });
    setOpen(false);
  };

  const handleSkip = () => {
    updateUserMutation.mutate({ onboarding_completed: true });
    setOpen(false);
  };

  const step = onboardingSteps[currentStep];
  const progress = ((currentStep + 1) / onboardingSteps.length) * 100;

  const colorClasses = {
    blue: "bg-blue-100 text-blue-600 border-blue-200",
    purple: "bg-purple-100 text-purple-600 border-purple-200",
    green: "bg-green-100 text-green-600 border-green-200",
    orange: "bg-orange-100 text-orange-600 border-orange-200",
    indigo: "bg-indigo-100 text-indigo-600 border-indigo-200"
  };

  return (
    <>
      {/* Reopen Tutorial Button */}
      {currentUser?.onboarding_completed && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setCurrentStep(0);
            setOpen(true);
          }}
          className="fixed bottom-20 right-6 z-40 shadow-lg"
        >
          <Lightbulb className="w-4 h-4 mr-2" />
          View Tutorial
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-2xl flex items-center gap-2">
                <step.icon className={`w-8 h-8 ${step.color === 'blue' ? 'text-blue-600' : step.color === 'purple' ? 'text-purple-600' : step.color === 'green' ? 'text-green-600' : step.color === 'orange' ? 'text-orange-600' : 'text-indigo-600'}`} />
                {step.title}
              </DialogTitle>
              <Button variant="ghost" size="icon" onClick={handleSkip}>
                <X className="w-5 h-5" />
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            {/* Progress Bar */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600">Step {currentStep + 1} of {onboardingSteps.length}</span>
                <span className="font-medium text-gray-900">{Math.round(progress)}% Complete</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {/* Content */}
            <Card className={`border-2 ${colorClasses[step.color]}`}>
              <CardContent className="p-6">
                <p className="text-lg text-gray-700 mb-4">{step.description}</p>

                {/* Video/Demo Section */}
                {step.videoUrl && (
                  <div className="mb-4 bg-gray-100 rounded-lg p-4 text-center">
                    <Play className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">Video tutorial coming soon</p>
                  </div>
                )}

                {/* Tips */}
                {step.tips && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                      <Lightbulb className="w-5 h-5 text-yellow-600" />
                      Pro Tips:
                    </h4>
                    <ul className="space-y-2">
                      {step.tips.map((tip, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-gray-700">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Try It Now Link */}
                {step.page && (
                  <Link to={createPageUrl(step.page)} onClick={() => setOpen(false)}>
                    <Button variant="outline" className="w-full mt-4">
                      <Play className="w-4 h-4 mr-2" />
                      Try {step.title} Now
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>

            {/* Navigation */}
            <div className="flex justify-between items-center pt-4">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                disabled={currentStep === 0}
              >
                Previous
              </Button>

              <div className="flex gap-2">
                {onboardingSteps.map((_, idx) => (
                  <div
                    key={idx}
                    className={`w-2 h-2 rounded-full ${idx <= currentStep ? 'bg-blue-600' : 'bg-gray-300'}`}
                  />
                ))}
              </div>

              {currentStep < onboardingSteps.length - 1 ? (
                <Button onClick={() => setCurrentStep(currentStep + 1)}>
                  Next
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <Button onClick={handleComplete} className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Get Started!
                </Button>
              )}
            </div>

            <Button variant="ghost" onClick={handleSkip} className="w-full text-gray-500">
              Skip Tutorial
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}