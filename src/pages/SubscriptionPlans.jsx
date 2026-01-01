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
  const [selectedPlan, setSelectedPlan] = useState('monthly');

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
    mutationFn: async (priceId) => {
      console.log('Invoking createStripeCheckout with priceId:', priceId);
      const response = await base44.functions.invoke('createStripeCheckout', { priceId });
      console.log('Checkout response:', response);
      return response.data;
    },
    onSuccess: (data) => {
      console.log('Checkout successful, redirecting to:', data.url);
      if (data.url) {
        // Use window.top to break out of iframe (Base44 preview window)
        if (window.top) {
          window.top.location.href = data.url;
        } else {
          window.location.href = data.url;
        }
      } else {
        console.error('No URL in response');
        alert('Failed to get checkout URL');
        setIsLoading(false);
      }
    },
    onError: (error) => {
      console.error('Checkout error:', error);
      alert('Failed to start checkout: ' + (error.message || 'Unknown error'));
      setIsLoading(false);
    }
  });

  const handleSubscribe = async (plan) => {
    setIsLoading(true);
    setSelectedPlan(plan);
    
    const planObj = plans.find(p => p.id === plan);
    if (!planObj || !planObj.priceId) {
      alert('Invalid plan selected');
      setIsLoading(false);
      return;
    }
    checkoutMutation.mutate(planObj.priceId);
  };

  const hasActiveSubscription = subscription && subscription.status === 'active';
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

  const plans = [
    {
      id: 'monthly',
      name: 'Monthly',
      price: settings?.monthly_price || 39.99,
      interval: '/month',
      popular: false,
      savings: null,
      priceId: 'price_1SioNUCEZXcVOdjd7EzodOpc'
    },
    {
      id: 'quarterly',
      name: '3-Month',
      price: settings?.quarterly_price || 114.99,
      interval: '/3 months',
      popular: false,
      savings: 'Save 4%',
      priceId: 'price_1SioSoCEZXcVOdjdPYzUvQiX'
    },
    {
      id: 'biannual',
      name: '6-Month',
      price: settings?.biannual_price || 209.99,
      interval: '/6 months',
      popular: true,
      savings: 'Save 13%',
      monthlyEquiv: '$35/mo',
      priceId: 'price_1SioOnCEZXcVOdjdM5Ou6Wqj'
    },
    {
      id: 'yearly',
      name: 'Annual',
      price: settings?.yearly_price || 349.99,
      interval: '/year',
      popular: false,
      savings: 'Save 27%',
      monthlyEquiv: '$29/mo',
      priceId: 'price_1SioPVCEZXcVOdjdLjX5A9AR'
    }
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Choose Your Plan</h1>
        <p className="text-xl text-gray-600">Flexible pricing for every practice</p>
        {hasActiveSubscription && (
          <Badge className="mt-4 bg-green-600 text-lg px-4 py-2">
            ✓ Currently Subscribed
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {plans.map((plan) => (
          <Card key={plan.id} className={`relative ${plan.popular ? 'border-4 border-indigo-500 shadow-2xl' : 'border-2'}`}>
            {plan.popular && (
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                <Badge className="bg-indigo-600 text-white px-4 py-1">Most Popular</Badge>
              </div>
            )}
            <CardHeader className={plan.popular ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white' : ''}>
              <CardTitle className="text-center">
                <div className={`text-2xl font-bold mb-2 ${plan.popular ? 'text-white' : 'text-gray-900'}`}>{plan.name}</div>
                <div className={`text-4xl font-bold mb-1 ${plan.popular ? 'text-white' : 'text-gray-900'}`}>${plan.price}</div>
                <div className={`text-sm ${plan.popular ? 'text-white/90' : 'text-gray-600'}`}>{plan.interval}</div>
                {plan.monthlyEquiv && (
                  <div className={`text-sm mt-1 ${plan.popular ? 'text-white/80' : 'text-gray-500'}`}>({plan.monthlyEquiv})</div>
                )}
                {plan.savings && (
                  <Badge className={`mt-2 ${plan.popular ? 'bg-yellow-400 text-yellow-900' : 'bg-green-100 text-green-800'}`}>
                    {plan.savings}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <Button
                onClick={() => handleSubscribe(plan.id)}
                disabled={hasActiveSubscription || (isLoading && selectedPlan === plan.id)}
                className={`w-full ${
                  plan.popular 
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700' 
                    : 'bg-gray-900 hover:bg-gray-800'
                }`}
              >
                {isLoading && selectedPlan === plan.id ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : hasActiveSubscription ? (
                  'Current Plan'
                ) : (
                  'Select Plan'
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-2 border-gray-200">
        <CardHeader>
          <CardTitle className="text-center flex items-center justify-center gap-2">
            <Sparkles className="w-6 h-6 text-indigo-600" />
            All Plans Include
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8">
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {features.map((feature, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700">{feature}</span>
              </li>
            ))}
          </ul>
          
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 mt-6">
            <h4 className="font-semibold text-blue-900 mb-2">What You Get:</h4>
            <ul className="space-y-1 text-sm text-blue-800">
              <li>• Start with a {trialDays}-day free trial</li>
              <li>• Cancel anytime, no commitments</li>
              <li>• Full access to all features during trial</li>
              <li>• Automatically converts to paid subscription after trial</li>
            </ul>
          </div>
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

      {/* Legal Links */}
      <Card className="mt-8">
        <CardContent className="p-6">
          <div className="flex flex-wrap justify-center gap-4 text-sm text-gray-600">
            <a href={createPageUrl("TermsOfUse")} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">
              Terms of Use
            </a>
            <span className="text-gray-400">•</span>
            <a href={createPageUrl("PrivacyPolicy")} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">
              Privacy Policy
            </a>
            <span className="text-gray-400">•</span>
            <a href={createPageUrl("EULA")} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">
              EULA
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}