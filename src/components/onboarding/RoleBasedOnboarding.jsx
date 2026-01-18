import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { 
  Target, 
  Brain,
  Mic,
  FileText,
  Shield,
  GraduationCap,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  Users,
  BarChart3
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

const roleGoals = {
  RN: [
    { id: 'skilled_notes', label: 'Document skilled nursing visits', icon: Brain },
    { id: 'oasis', label: 'Complete OASIS assessments', icon: Shield },
    { id: 'care_plans', label: 'Manage care plans', icon: Target },
    { id: 'compliance', label: 'Ensure Medicare compliance', icon: Shield }
  ],
  LPN: [
    { id: 'visit_notes', label: 'Document routine visits', icon: FileText },
    { id: 'vitals', label: 'Track patient vitals', icon: BarChart3 },
    { id: 'care_coordination', label: 'Coordinate with RN/team', icon: Users }
  ],
  PT: [
    { id: 'therapy_notes', label: 'Document therapy sessions', icon: Brain },
    { id: 'functional_goals', label: 'Track functional outcomes', icon: Target },
    { id: 'progress_reports', label: 'Generate progress reports', icon: FileText }
  ],
  OT: [
    { id: 'therapy_notes', label: 'Document OT sessions', icon: Brain },
    { id: 'adl_assessment', label: 'Assess ADL independence', icon: Target },
    { id: 'home_safety', label: 'Home safety evaluations', icon: Shield }
  ],
  MSW: [
    { id: 'psychosocial', label: 'Psychosocial assessments', icon: Brain },
    { id: 'resources', label: 'Community resource coordination', icon: Users },
    { id: 'counseling_notes', label: 'Counseling documentation', icon: FileText }
  ],
  admin: [
    { id: 'user_management', label: 'Manage team members', icon: Users },
    { id: 'compliance_monitoring', label: 'Monitor compliance', icon: Shield },
    { id: 'analytics', label: 'Review analytics & reports', icon: BarChart3 },
    { id: 'training', label: 'Oversee staff training', icon: GraduationCap }
  ]
};

export default function RoleBasedOnboarding({ user, onComplete }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1); // 1: goals, 2: features, 3: complete
  const [selectedGoals, setSelectedGoals] = useState([]);
  
  const userGoals = roleGoals[user?.credential_type] || roleGoals[user?.role] || roleGoals.RN;

  const toggleGoal = (goalId) => {
    setSelectedGoals(prev => 
      prev.includes(goalId) 
        ? prev.filter(g => g !== goalId)
        : [...prev, goalId]
    );
  };

  const completeOnboardingMutation = useMutation({
    mutationFn: async () => {
      await base44.auth.updateMe({ 
        onboarding_completed: true,
        onboarding_goals: selectedGoals
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      if (onComplete) onComplete();
    }
  });

  const handleComplete = () => {
    completeOnboardingMutation.mutate();
  };

  const getRecommendedPage = () => {
    if (selectedGoals.includes('skilled_notes') || selectedGoals.includes('visit_notes')) {
      return 'SmartNoteAssistant';
    } else if (selectedGoals.includes('therapy_notes')) {
      return 'MedicalScribe';
    } else if (selectedGoals.includes('care_plans')) {
      return 'CarePlanManagement';
    } else if (selectedGoals.includes('user_management')) {
      return 'UserManagement';
    }
    return 'Dashboard';
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-blue-50 to-purple-50 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
      <Card className="w-full max-w-3xl shadow-2xl">
        <CardHeader className="border-b bg-gradient-to-r from-blue-600 to-purple-600 text-white">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="w-6 h-6" />
              <span>Welcome to CareMetric AI</span>
            </div>
            <Badge className="bg-white/20 text-white border-white/30">
              Step {step} of 3
            </Badge>
          </CardTitle>
          <Progress value={(step / 3) * 100} className="mt-3 bg-white/20" />
        </CardHeader>

        <CardContent className="p-8">
          {step === 1 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  What are your main goals? 🎯
                </h3>
                <p className="text-gray-600">
                  Select what you'd like to accomplish with CareMetric AI. We'll personalize your experience!
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                {userGoals.map((goal) => {
                  const GoalIcon = goal.icon;
                  const isSelected = selectedGoals.includes(goal.id);
                  
                  return (
                    <button
                      key={goal.id}
                      onClick={() => toggleGoal(goal.id)}
                      className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left ${
                        isSelected 
                          ? 'border-blue-500 bg-blue-50 shadow-md' 
                          : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        isSelected ? 'bg-blue-500' : 'bg-gray-100'
                      }`}>
                        <GoalIcon className={`w-5 h-5 ${isSelected ? 'text-white' : 'text-gray-600'}`} />
                      </div>
                      <div className="flex-1">
                        <p className={`font-medium ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                          {goal.label}
                        </p>
                      </div>
                      {isSelected && <CheckCircle2 className="w-5 h-5 text-blue-600" />}
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => setStep(2)}
                  disabled={selectedGoals.length === 0}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Continue
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Here's what you can do 🚀
                </h3>
                <p className="text-gray-600">
                  Based on your goals, here are the key features you'll use most
                </p>
              </div>

              <div className="space-y-3">
                <FeatureCard
                  icon={Brain}
                  title="Smart Notes Assistant"
                  description="Paste rough notes and get Medicare-compliant documentation instantly"
                  color="blue"
                />
                <FeatureCard
                  icon={Mic}
                  title="Voice Scribe"
                  description="Dictate hands-free and AI transcribes + formats your notes"
                  color="purple"
                />
                <FeatureCard
                  icon={Target}
                  title="AI Care Plans"
                  description="Get evidence-based intervention suggestions automatically"
                  color="green"
                />
                <FeatureCard
                  icon={Shield}
                  title="Compliance Monitoring"
                  description="Real-time compliance scoring and OASIS validation"
                  color="orange"
                />
              </div>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                >
                  <ChevronRight className="w-4 h-4 mr-2 rotate-180" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Continue
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  You're All Set! 🎉
                </h3>
                <p className="text-gray-600">
                  Ready to start using CareMetric AI? We've personalized your experience based on your goals.
                </p>
              </div>

              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-200">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  Quick Start Tips:
                </h4>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 flex-shrink-0" />
                    <span>Try the <strong>Smart Notes</strong> feature with your next visit</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 flex-shrink-0" />
                    <span>Enable <strong>offline mode</strong> in Settings for rural visits</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 flex-shrink-0" />
                    <span>Check the <strong>Features</strong> page for video tutorials</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 flex-shrink-0" />
                    <span>You have <strong>14 days</strong> to explore everything for free</span>
                  </li>
                </ul>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    handleComplete();
                    navigate(createPageUrl('Features'));
                  }}
                  className="flex-1"
                >
                  <GraduationCap className="w-4 h-4 mr-2" />
                  View Tutorials
                </Button>
                <Button
                  onClick={() => {
                    handleComplete();
                    navigate(createPageUrl(getRecommendedPage()));
                  }}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  Start Using CareMetric AI
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description, color }) {
  const colorClasses = {
    blue: 'from-blue-500 to-blue-600',
    purple: 'from-purple-500 to-purple-600',
    green: 'from-green-500 to-green-600',
    orange: 'from-orange-500 to-orange-600'
  };

  return (
    <div className="flex items-start gap-4 p-4 bg-white rounded-lg border hover:shadow-md transition-all">
      <div className={`w-12 h-12 bg-gradient-to-br ${colorClasses[color]} rounded-xl flex items-center justify-center flex-shrink-0`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <h4 className="font-semibold text-gray-900 mb-1">{title}</h4>
        <p className="text-sm text-gray-600">{description}</p>
      </div>
    </div>
  );
}