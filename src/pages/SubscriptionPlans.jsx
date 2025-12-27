import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function SubscriptionPlans() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: subscription } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: () => base44.entities.Subscription.filter({ user_email: currentUser.email }),
    enabled: !!currentUser?.email,
    select: (data) => data[0]
  });

  const { data: settings } = useQuery({
    queryKey: ['subscriptionSettings'],
    queryFn: async () => {
      const result = await base44.entities.SubscriptionSettings.list();
      return result[0];
    }
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('createStripeCheckout', {});
      return response.data;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => {
      alert('Failed to start checkout: ' + error.message);
      setIsLoading(false);
    }
  });

  const handleSubscribe = () => {
    setIsLoading(true);
    checkoutMutation.mutate();
  };

  const hasActiveSubscription = subscription && subscription.status === 'active';
  const monthlyPrice = settings?.monthly_price || 99;
  const trialDays = settings?.trial_days || 14;
  const features = settings?.features || [
    'Unlimited patients',
    'AI-powered documentation',
    'Real-time compliance monitoring',
    'Voice dictation',
    'Predictive analytics',
    'Care plan automation',
    'OASIS integration',
    'Priority support',
    'All premium features'
  ];

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">CareMetric AI Subscription</h1>
        <p className="text-xl text-gray-600">Unlimited access to all AI-powered features</p>
        {hasActiveSubscription && (
          <Badge className="mt-4 bg-green-600 text-lg px-4 py-2">
            ✓ Currently Subscribed
          </Badge>
        )}
      </div>

      <Card className="border-4 border-indigo-500 shadow-2xl">
        <CardHeader className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-t-lg">
          <div className="text-center">
            <Sparkles className="w-16 h-16 mx-auto mb-3" />
            <CardTitle className="text-3xl font-bold mb-2">Unlimited Plan</CardTitle>
            <p className="text-white/90 text-lg mb-4">Everything you need to transform your practice</p>
            <div className="text-6xl font-bold mb-2">${monthlyPrice}</div>
            <div className="text-white/90 text-lg">/month</div>
            <Badge className="mt-3 bg-yellow-500 text-yellow-900 px-4 py-1">
              {trialDays}-Day Free Trial
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-8">
          <div className="mb-8">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Everything Included:</h3>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {features.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 mb-6">
            <h4 className="font-semibold text-blue-900 mb-2">What You Get:</h4>
            <ul className="space-y-1 text-sm text-blue-800">
              <li>• Start with a {trialDays}-day free trial - no credit card required</li>
              <li>• Cancel anytime, no commitments</li>
              <li>• Full access to all features during trial</li>
              <li>• Automatically converts to paid subscription after trial</li>
            </ul>
          </div>

          <Button
            onClick={handleSubscribe}
            disabled={hasActiveSubscription || isLoading}
            className={`w-full ${
              hasActiveSubscription 
                ? 'bg-gray-400' 
                : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700'
            }`}
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Loading...
              </>
            ) : hasActiveSubscription ? (
              'Already Subscribed'
            ) : (
              `Start ${trialDays}-Day Free Trial`
            )}
          </Button>

          {!hasActiveSubscription && (
            <p className="text-center text-sm text-gray-500 mt-4">
              No credit card required for trial. Cancel anytime.
            </p>
          )}
        </CardContent>
      </Card>

      {hasActiveSubscription && (
        <div className="text-center mt-8">
          <Card className="inline-block bg-gray-50 border-2 border-dashed">
            <CardContent className="p-6">
              <p className="text-gray-700 mb-4">
                Manage your subscription and billing in settings
              </p>
              <Button 
                variant="outline"
                onClick={() => navigate(createPageUrl("Billing"))}
              >
                Go to Billing
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}