import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  X, 
  ChevronRight, 
  ChevronLeft, 
  CheckCircle2, 
  Sparkles,
  Brain,
  Mic,
  Target,
  FileText,
  BarChart3,
  Shield
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";

const onboardingSteps = {
  admin: [
    {
      id: 'welcome',
      title: 'Welcome, Administrator! 👋',
      description: 'As an admin, you have full access to manage users, configure settings, and oversee all system operations.',
      icon: Sparkles,
      action: null,
      tips: [
        'Invite team members from User Management',
        'Configure AI settings and compliance rules',
        'Monitor system analytics and security'
      ]
    },
    {
      id: 'user-management',
      title: 'User Management Hub',
      description: 'Invite and manage your healthcare team members.',
      icon: Shield,
      page: 'UserManagement',
      tips: [
        'Bulk invite multiple users at once',
        'Set custom invitation expiry periods',
        'Track user activity and performance'
      ]
    },
    {
      id: 'compliance',
      title: 'Compliance & Security',
      description: 'Monitor compliance, configure rules, and review security logs.',
      icon: Shield,
      page: 'ComplianceRegulatory',
      tips: [
        'Set up custom compliance rules',
        'Review audit trails regularly',
        'Configure automated monitoring'
      ]
    },
    {
      id: 'analytics',
      title: 'Analytics Dashboard',
      description: 'Track team performance, documentation quality, and system usage.',
      icon: BarChart3,
      page: 'AdvancedAnalyticsDashboard',
      tips: [
        'Export reports for stakeholders',
        'Monitor AI accuracy trends',
        'Track ROI and time savings'
      ]
    }
  ],
  user: [
    {
      id: 'welcome',
      title: 'Welcome to CareMetric AI! 🎉',
      description: 'Let\'s get you started with the essentials. We\'ll guide you through the key features to help you document faster and more accurately.',
      icon: Sparkles,
      action: null,
      tips: [
        'AI assistance available on every page',
        'All your data is HIPAA-compliant and encrypted',
        'Mobile-optimized for on-the-go documentation'
      ]
    },
    {
      id: 'smart-notes',
      title: 'Smart Notes Assistant',
      description: 'Transform rough notes into Medicare-compliant documentation with AI.',
      icon: Brain,
      page: 'SmartNoteAssistant',
      tips: [
        'Paste or type rough notes in the text area',
        'AI enhances them for compliance and clarity',
        'Review and edit before saving to patient chart'
      ]
    },
    {
      id: 'voice-scribe',
      title: 'Voice Scribe',
      description: 'Dictate your visit notes hands-free and let AI transcribe and format them.',
      icon: Mic,
      page: 'MedicalScribe',
      tips: [
        'Click record and speak naturally',
        'AI extracts vitals, assessments, and plans',
        'Works offline for rural areas'
      ]
    },
    {
      id: 'care-plans',
      title: 'Care Plan Management',
      description: 'AI-suggested care plans based on patient diagnoses and goals.',
      icon: Target,
      page: 'CarePlanManagement',
      tips: [
        'AI suggests interventions automatically',
        'Track progress toward goals',
        'Collaborate with your team'
      ]
    },
    {
      id: 'patients',
      title: 'Patient Management',
      description: 'Manage your patient roster with AI-powered insights.',
      icon: FileText,
      page: 'Patients',
      tips: [
        'Add patients with quick forms',
        'View AI-generated summaries',
        'Track alerts and risk factors'
      ]
    }
  ]
};

export default function InteractiveOnboardingFlow({ user, onComplete }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  const steps = onboardingSteps[user?.role] || onboardingSteps.user;
  const progress = ((currentStep + 1) / steps.length) * 100;
  const step = steps[currentStep];
  const StepIcon = step.icon;

  useEffect(() => {
    // Show onboarding if user hasn't completed it
    if (user && !user.onboarding_completed) {
      setIsVisible(true);
    }
  }, [user]);

  const completeOnboardingMutation = useMutation({
    mutationFn: async () => {
      await base44.auth.updateMe({ onboarding_completed: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      setIsVisible(false);
      if (onComplete) onComplete();
    }
  });

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
      
      // Navigate to the step's page if specified
      if (steps[currentStep + 1].page) {
        navigate(createPageUrl(steps[currentStep + 1].page));
      }
    } else {
      completeOnboardingMutation.mutate();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      if (steps[currentStep - 1].page) {
        navigate(createPageUrl(steps[currentStep - 1].page));
      }
    }
  };

  const handleSkip = () => {
    if (confirm('Skip the onboarding tour? You can always restart it from Settings.')) {
      completeOnboardingMutation.mutate();
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[10000] flex items-center justify-center p-4 animate-in fade-in">
      <Card className="w-full max-w-2xl shadow-2xl border-2 border-blue-500">
        <CardContent className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                <StepIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{step.title}</h2>
                <Badge className="mt-1 bg-blue-100 text-blue-800">
                  Step {currentStep + 1} of {steps.length}
                </Badge>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSkip}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Progress Bar */}
          <Progress value={progress} className="mb-6" />

          {/* Content */}
          <div className="space-y-4 mb-6">
            <p className="text-gray-700 text-lg">{step.description}</p>

            {step.tips && step.tips.length > 0 && (
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Quick Tips:
                </h4>
                <ul className="space-y-2">
                  {step.tips.map((tip, idx) => (
                    <li key={idx} className="text-sm text-blue-900 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-600" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step.page && (
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-200">
                <p className="text-sm text-purple-900">
                  📍 This tutorial will guide you through the <strong>{step.page}</strong> page
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={currentStep === 0}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>

            <div className="flex gap-2">
              {steps.map((_, idx) => (
                <div
                  key={idx}
                  className={`w-2 h-2 rounded-full transition-all ${
                    idx === currentStep
                      ? 'bg-blue-600 w-6'
                      : idx < currentStep
                      ? 'bg-blue-400'
                      : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>

            <Button
              onClick={handleNext}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {currentStep === steps.length - 1 ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Finish Tour
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </>
              )}
            </Button>
          </div>

          {/* Skip Button */}
          <div className="text-center mt-4">
            <button
              onClick={handleSkip}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Skip tour
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}