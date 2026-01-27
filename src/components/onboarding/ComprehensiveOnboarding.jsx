import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Zap } from "lucide-react";
import OnboardingChecklist from "./OnboardingChecklist";
import GuidedFeatureTour from "./GuidedFeatureTour";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";

export default function ComprehensiveOnboarding({ currentUser, onComplete }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('checklist');
  const [showTour, setShowTour] = useState(false);

  const completeOnboardingMutation = useMutation({
    mutationFn: async () => {
      return await base44.auth.updateMe({
        onboarding_completed: true
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      onComplete?.();
    }
  });

  const handleTaskClick = (target) => {
    if (target === 'tour') {
      setShowTour(true);
    } else if (target === 'Settings' || target === 'SubscriptionPlans') {
      completeOnboardingMutation.mutateAsync().then(() => {
        navigate(createPageUrl(target));
      });
    }
  };

  const handleTourComplete = () => {
    setShowTour(false);
    // Mark tour as seen if we want to track it separately
  };

  if (showTour) {
    return <GuidedFeatureTour onComplete={handleTourComplete} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
            Welcome to CareMetric AI!
          </h1>
          <p className="text-lg text-gray-600">
            Let's get you set up in just a few minutes
          </p>
        </div>

        {/* Welcome Card */}
        <Card className="mb-8 border-2 border-blue-200 bg-white shadow-lg">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="bg-blue-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Zap className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">14-Day Trial</h3>
                <p className="text-sm text-gray-600">Full access to all features</p>
              </div>
              <div className="text-center">
                <div className="bg-green-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">Auto-Approved</h3>
                <p className="text-sm text-gray-600">Instant access to your account</p>
              </div>
              <div className="text-center">
                <div className="bg-purple-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl">🚀</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">Get Started</h3>
                <p className="text-sm text-gray-600">Complete your setup below</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <Card className="shadow-lg border-0">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-t-lg">
            <CardTitle>Let's Get You Ready</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="checklist">Setup Checklist</TabsTrigger>
                <TabsTrigger value="welcome">Quick Tips</TabsTrigger>
              </TabsList>

              <TabsContent value="checklist" className="space-y-4">
                <OnboardingChecklist 
                  currentUser={currentUser}
                  onTaskClick={handleTaskClick}
                />
              </TabsContent>

              <TabsContent value="welcome" className="space-y-4">
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h4 className="font-semibold text-blue-900 mb-2">🎯 Getting Started</h4>
                    <ul className="text-sm text-blue-800 space-y-2">
                      <li>✓ Complete your profile with professional details</li>
                      <li>✓ Explore the dashboard and available tools</li>
                      <li>✓ Try creating your first smart note</li>
                      <li>✓ Add a patient record to see the full workflow</li>
                    </ul>
                  </div>

                  <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <h4 className="font-semibold text-purple-900 mb-2">✨ Key Features</h4>
                    <ul className="text-sm text-purple-800 space-y-2">
                      <li>📝 <strong>Smart Notes:</strong> AI-powered documentation assistant</li>
                      <li>👥 <strong>Patient Management:</strong> Centralized patient records</li>
                      <li>📋 <strong>Care Plans:</strong> Automated care plan generation</li>
                      <li>📊 <strong>Analytics:</strong> Track your progress and insights</li>
                    </ul>
                  </div>

                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h4 className="font-semibold text-green-900 mb-2">❓ Need Help?</h4>
                    <p className="text-sm text-green-800 mb-3">
                      Check out our help section or start the guided feature tour from your dashboard.
                    </p>
                    <Button
                      onClick={() => setShowTour(true)}
                      variant="outline"
                      size="sm"
                      className="text-green-700 border-green-300 hover:bg-green-100"
                    >
                      Start Feature Tour
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Action Footer */}
        <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            onClick={() => navigate(createPageUrl('Dashboard'))}
            variant="outline"
            size="lg"
            disabled={completeOnboardingMutation.isPending}
          >
            Skip for Now
          </Button>
          <Button
            onClick={() => completeOnboardingMutation.mutate()}
            disabled={completeOnboardingMutation.isPending}
            size="lg"
            className="bg-blue-600 hover:bg-blue-700"
          >
            {completeOnboardingMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              'Complete Onboarding & Go to Dashboard'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}