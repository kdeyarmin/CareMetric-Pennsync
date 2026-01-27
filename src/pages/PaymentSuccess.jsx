import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import confetti from "canvas-confetti";

export default function PaymentSuccess() {
  const [sessionVerified, setSessionVerified] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: subscription, refetch } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: async () => {
      const response = await base44.functions.invoke('getMySubscription', {});
      return response?.data?.subscription || response?.subscription;
    },
    enabled: !!currentUser?.email,
    refetchInterval: sessionVerified ? false : 2000 // Poll every 2s until verified
  });

  useEffect(() => {
    // Get session ID from URL
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');

    if (subscription && (subscription.status === 'active' || subscription.status === 'trialing')) {
      setSessionVerified(true);
      
      // Celebrate!
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  }, [subscription]);

  if (!subscription || !sessionVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-12 pb-12 text-center">
            <Loader2 className="w-16 h-16 animate-spin text-blue-600 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Processing Your Subscription...</h2>
            <p className="text-gray-600">Please wait while we confirm your payment</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isTrial = subscription.status === 'trialing';
  const trialEndDate = subscription.trial_end ? new Date(subscription.trial_end).toLocaleDateString() : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-2xl w-full">
        <CardHeader className="text-center pb-6">
          <div className="mb-4">
            <CheckCircle2 className="w-20 h-20 text-green-500 mx-auto" />
          </div>
          <CardTitle className="text-3xl font-bold text-gray-900">
            {isTrial ? '🎉 Welcome to Your Free Trial!' : '🎉 Subscription Activated!'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isTrial ? (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                <p className="text-lg font-semibold text-blue-900 mb-2">
                  Your 14-Day Free Trial Has Started
                </p>
                <p className="text-sm text-blue-700">
                  Trial ends: <strong>{trialEndDate}</strong>
                </p>
                <p className="text-xs text-blue-600 mt-2">
                  Cancel anytime before {trialEndDate} to avoid charges
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900">What's Included:</h3>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span>AI-powered clinical documentation and smart notes</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span>Real-time compliance monitoring and OASIS support</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span>Clinical decision support and differential diagnosis</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span>Unlimited patients and documentation</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span>24/7 support and training resources</span>
                  </li>
                </ul>
              </div>
            </>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <p className="text-lg font-semibold text-green-900 mb-2">
                Thank You for Subscribing!
              </p>
              <p className="text-sm text-green-700">
                Plan: <strong>{subscription.plan_name}</strong>
              </p>
              <p className="text-sm text-green-700">
                Next billing: <strong>{new Date(subscription.current_period_end).toLocaleDateString()}</strong>
              </p>
            </div>
          )}

          <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-6 h-6 text-purple-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-purple-900 mb-1">Get Started Now</h3>
                <p className="text-sm text-purple-700">
                  Head to your dashboard to start creating compliant clinical documentation with AI assistance!
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Link to={createPageUrl("Dashboard")} className="flex-1">
              <Button className="w-full bg-blue-600 hover:bg-blue-700">
                Go to Dashboard
              </Button>
            </Link>
            <Link to={createPageUrl("SmartNoteAssistant")} className="flex-1">
              <Button className="w-full bg-purple-600 hover:bg-purple-700">
                Create First Note
              </Button>
            </Link>
          </div>

          <div className="text-center pt-4 border-t">
            <p className="text-xs text-gray-500">
              Questions? Contact us at support@caremetricai.com
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}