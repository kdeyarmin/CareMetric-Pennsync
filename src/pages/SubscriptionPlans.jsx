import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Crown, Zap, Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function SubscriptionPlans() {
  const navigate = useNavigate();
  const [loadingPlan, setLoadingPlan] = useState(null);

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

  const checkoutMutation = useMutation({
    mutationFn: async (plan) => {
      const response = await base44.functions.invoke('createStripeCheckout', { plan });
      return response.data;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => {
      alert('Failed to start checkout: ' + error.message);
      setLoadingPlan(null);
    }
  });

  const handleSubscribe = (plan) => {
    setLoadingPlan(plan);
    checkoutMutation.mutate(plan);
  };

  const plans = [
    {
      id: 'basic',
      name: 'Basic',
      icon: Crown,
      price: '$29',
      period: '/month',
      description: 'Perfect for individual nurses',
      features: [
        'Up to 25 patients',
        'AI-powered documentation',
        'Basic compliance checking',
        'Voice dictation',
        'Email support'
      ],
      color: 'blue'
    },
    {
      id: 'pro',
      name: 'Pro',
      icon: Zap,
      price: '$79',
      period: '/month',
      description: 'For growing practices',
      features: [
        'Unlimited patients',
        'Advanced AI features',
        'Real-time compliance monitoring',
        'Predictive analytics',
        'Care plan automation',
        'Priority support',
        'OASIS integration'
      ],
      color: 'purple',
      popular: true
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      icon: Building2,
      price: '$199',
      period: '/month',
      description: 'For large agencies',
      features: [
        'Everything in Pro',
        'Multi-user management',
        'Custom integrations',
        'Advanced analytics',
        'Dedicated account manager',
        'Custom training',
        'SLA guarantee'
      ],
      color: 'indigo'
    }
  ];

  const currentPlan = subscription?.plan || 'free';

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Choose Your Plan</h1>
        <p className="text-xl text-gray-600">Unlock powerful AI features for your home health practice</p>
        {subscription && (
          <Badge className="mt-4 bg-green-600 text-lg px-4 py-2">
            Current Plan: {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
        {plans.map((plan) => {
          const Icon = plan.icon;
          const isCurrentPlan = currentPlan === plan.id;
          const colorClasses = {
            blue: 'from-blue-500 to-blue-600',
            purple: 'from-purple-500 to-purple-600',
            indigo: 'from-indigo-500 to-indigo-600'
          };

          return (
            <Card 
              key={plan.id}
              className={`relative ${plan.popular ? 'border-4 border-purple-500 shadow-2xl scale-105' : 'border-2'}`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-purple-600 text-white px-6 py-1 text-sm">
                    Most Popular
                  </Badge>
                </div>
              )}
              
              <CardHeader className={`bg-gradient-to-br ${colorClasses[plan.color]} text-white rounded-t-lg`}>
                <div className="text-center">
                  <Icon className="w-12 h-12 mx-auto mb-3" />
                  <CardTitle className="text-2xl font-bold mb-2">{plan.name}</CardTitle>
                  <p className="text-white/90 text-sm mb-4">{plan.description}</p>
                  <div className="text-5xl font-bold mb-1">{plan.price}</div>
                  <div className="text-white/90">{plan.period}</div>
                </div>
              </CardHeader>

              <CardContent className="p-6">
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={isCurrentPlan || loadingPlan === plan.id}
                  className={`w-full ${
                    isCurrentPlan 
                      ? 'bg-gray-400' 
                      : `bg-gradient-to-r ${colorClasses[plan.color]} hover:opacity-90`
                  }`}
                  size="lg"
                >
                  {loadingPlan === plan.id ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : isCurrentPlan ? (
                    'Current Plan'
                  ) : (
                    'Subscribe Now'
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="text-center">
        <Card className="inline-block bg-gray-50 border-2 border-dashed">
          <CardContent className="p-6">
            <p className="text-gray-700 mb-4">
              Already subscribed? Manage your subscription in billing settings.
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
    </div>
  );
}