import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Sparkles, Clock, ArrowRight } from "lucide-react";

export const publicPage = true;

export default function Pricing() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        return null;
      }
    }
  });

  const { data: subscription } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: () => base44.entities.Subscription.filter({ user_email: currentUser.email }),
    enabled: !!currentUser?.email,
    select: (data) => data[0]
  });

  const hasActiveSubscription = subscription && subscription.status === 'active';

  const plans = [
    {
      name: "Monthly",
      price: 39.99,
      interval: "month",
      description: "Perfect for trying out",
      priceId: "price_1SioNUCEZXcVOdjd7EzodOpc",
      popular: false,
      savings: null,
      monthlyEquiv: null
    },
    {
      name: "Quarterly",
      price: 114.99,
      interval: "3 months",
      description: "Save 4% vs monthly",
      priceId: "price_1SioSoCEZXcVOdjdPYzUvQiX",
      popular: false,
      savings: "Save $5",
      monthlyEquiv: "$38.33/mo"
    },
    {
      name: "Semi-Annual",
      price: 209.99,
      interval: "6 months",
      description: "Save 13% vs monthly",
      priceId: "price_1SioOnCEZXcVOdjdM5Ou6Wqj",
      popular: true,
      savings: "Save $30",
      monthlyEquiv: "$35/mo"
    },
    {
      name: "Annual",
      price: 349.99,
      interval: "year",
      description: "Best value - Save 27%",
      priceId: "price_1SioPVCEZXcVOdjdLjX5A9AR",
      popular: false,
      savings: "Save $130",
      monthlyEquiv: "$29.17/mo"
    }
  ];

  const features = [
    "Unlimited patients",
    "AI-powered documentation",
    "Real-time compliance monitoring",
    "Voice dictation",
    "Predictive analytics",
    "Care plan automation",
    "OASIS integration",
    "Priority support",
    "Patient education tools",
    "All premium features"
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-gray-600 mb-6">
            Choose the plan that works best for you
          </p>
          
          {/* Free Trial Banner */}
          <div className="inline-flex items-center gap-2 bg-green-100 text-green-800 px-6 py-3 rounded-full border-2 border-green-300">
            <Clock className="w-5 h-5" />
            <span className="font-bold">14-Day Free Trial • No Credit Card Required</span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {plans.map((plan) => (
            <Card 
              key={plan.name} 
              className={`relative ${plan.popular ? 'border-4 border-indigo-500 shadow-2xl scale-105' : 'border-2'}`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-indigo-600 text-white px-4 py-1 text-sm">
                    Most Popular
                  </Badge>
                </div>
              )}
              
              <CardHeader className={plan.popular ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-t-lg' : ''}>
                <CardTitle className="text-center">
                  <div className={`text-2xl font-bold mb-2 ${plan.popular ? 'text-white' : 'text-gray-900'}`}>
                    {plan.name}
                  </div>
                  <div className={`text-4xl font-bold mb-1 ${plan.popular ? 'text-white' : 'text-gray-900'}`}>
                    ${plan.price}
                  </div>
                  <div className={`text-sm ${plan.popular ? 'text-white/90' : 'text-gray-600'}`}>
                    per {plan.interval}
                  </div>
                  {plan.monthlyEquiv && (
                    <div className={`text-sm mt-1 ${plan.popular ? 'text-white/80' : 'text-gray-500'}`}>
                      ({plan.monthlyEquiv})
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              
              <CardContent className="p-6">
                <p className={`text-center mb-4 ${plan.popular ? 'font-semibold text-indigo-600' : 'text-gray-600'}`}>
                  {plan.description}
                </p>
                
                {plan.savings && (
                  <div className="text-center mb-4">
                    <Badge className={plan.popular ? 'bg-yellow-400 text-yellow-900' : 'bg-green-100 text-green-800'}>
                      {plan.savings}
                    </Badge>
                  </div>
                )}
                
                <Link to={createPageUrl("SubscriptionPlans")}>
                  <Button
                    className={`w-full ${
                      plan.popular 
                        ? 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700' 
                        : 'bg-gray-900 hover:bg-gray-800'
                    }`}
                    disabled={hasActiveSubscription}
                  >
                    {hasActiveSubscription ? 'Current Plan' : 'Select Plan'}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Features */}
        <Card className="border-2 border-blue-200 mb-12">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50">
            <CardTitle className="text-center flex items-center justify-center gap-2 text-2xl">
              <Sparkles className="w-6 h-6 text-indigo-600" />
              All Plans Include
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {features.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Trial Info */}
        <Card className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-0 mb-8">
          <CardContent className="p-8 text-center">
            <h3 className="text-2xl font-bold mb-3">Start Your 14-Day Free Trial Today</h3>
            <p className="text-lg mb-6 text-white/90">
              Experience all premium features risk-free. No credit card required. Cancel anytime.
            </p>
            <Link to={createPageUrl("Dashboard")}>
              <Button size="lg" className="bg-white text-indigo-600 hover:bg-gray-100 text-lg px-8">
                Start Free Trial
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-8 text-gray-900">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            <Card>
              <CardContent className="p-6">
                <h3 className="font-bold text-lg mb-2">Do I need a credit card for the free trial?</h3>
                <p className="text-gray-600">
                  No! Start your 14-day free trial with full access to all features without entering any payment information.
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <h3 className="font-bold text-lg mb-2">Can I cancel anytime?</h3>
                <p className="text-gray-600">
                  Yes, you can cancel your subscription at any time through the billing portal. No commitments or cancellation fees.
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <h3 className="font-bold text-lg mb-2">What happens after my trial ends?</h3>
                <p className="text-gray-600">
                  After your 14-day trial, all features will be locked until you subscribe. Your data remains secure and accessible once you subscribe.
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <h3 className="font-bold text-lg mb-2">Can I switch plans later?</h3>
                <p className="text-gray-600">
                  Yes! You can upgrade or downgrade your plan at any time through your billing settings.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}