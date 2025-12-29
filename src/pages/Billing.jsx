import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Calendar, AlertCircle, ExternalLink, Crown, Apple, Sparkles, Clock, ArrowRight, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import TrialStatusBanner from "../components/subscription/TrialStatusBanner";
import { isApplePlatform } from "@/components/utils/platformDetection";
import { useAppleIAP } from "@/components/subscription/AppleIAPManager";

export const publicPage = true;

export default function Billing() {
  const isApple = isApplePlatform();
  const { restorePurchases } = useAppleIAP();
  
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: subscription, isLoading } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: () => base44.entities.Subscription.filter({ user_email: currentUser.email }),
    enabled: !!currentUser?.email,
    select: (data) => data[0]
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('createStripePortal', {});
      return response.data;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => {
      alert('Failed to open portal: ' + error.message);
    }
  });

  const handleManageBilling = () => {
    if (isApple) {
      // Open iOS Settings for subscription management
      alert('To manage your Apple subscription, please go to:\n\nSettings → [Your Name] → Subscriptions → CareMetric AI');
    } else {
      portalMutation.mutate();
    }
  };

  const handleRestorePurchases = async () => {
    try {
      await restorePurchases();
      alert('Purchases restored successfully!');
      window.location.reload();
    } catch (error) {
      alert('Failed to restore purchases: ' + error.message);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      active: 'bg-green-100 text-green-800',
      trialing: 'bg-blue-100 text-blue-800',
      past_due: 'bg-red-100 text-red-800',
      canceled: 'bg-gray-100 text-gray-800',
      incomplete: 'bg-yellow-100 text-yellow-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getPlanName = (plan) => {
    return plan?.charAt(0).toUpperCase() + plan?.slice(1) || 'Free';
  };

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

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center text-gray-500">
            Loading billing information...
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasSubscription = subscription && (subscription.status === 'active' || subscription.status === 'trialing');

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Billing & Subscription</h1>
        <p className="text-gray-600">Manage your subscription and view pricing options</p>
      </div>

      {/* Trial Status Banner */}
      {subscription && <TrialStatusBanner subscription={subscription} />}

      {/* Apple IAP Notice */}
      {isApple && (
        <Alert className="mb-6 bg-gray-900 border-gray-700">
          <Apple className="w-4 h-4 text-white" />
          <AlertDescription className="text-white">
            Your subscription is managed through Apple. Changes must be made in iOS/macOS Settings.
          </AlertDescription>
        </Alert>
      )}

      {/* Current Plan */}
      <Card className="mb-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-2">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Crown className="w-6 h-6 text-indigo-600" />
              Subscription Status
            </span>
            <Badge className={getStatusColor(subscription?.status || 'inactive')} variant="outline">
              {subscription?.status || 'No Active Subscription'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {hasSubscription && (
              <>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Monthly Amount</p>
                  <p className="text-2xl font-bold text-gray-900">${subscription?.monthly_amount || 'N/A'}/month</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600 mb-1 flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      Current Period Start
                    </p>
                    <p className="font-medium">
                      {format(new Date(subscription.current_period_start), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 mb-1 flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      Next Billing Date
                    </p>
                    <p className="font-medium">
                      {format(new Date(subscription.current_period_end), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>

                {subscription.cancel_at_period_end && (
                  <Alert className="bg-yellow-50 border-yellow-300">
                    <AlertCircle className="w-4 h-4 text-yellow-600" />
                    <AlertDescription className="text-yellow-800">
                      Your subscription will cancel on {format(new Date(subscription.current_period_end), 'MMM d, yyyy')}
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}

            <div className="flex gap-3 pt-4 border-t flex-wrap">
              {!hasSubscription ? (
                <Link to={createPageUrl("SubscriptionPlans")} className="flex-1">
                  <Button className="w-full bg-indigo-600 hover:bg-indigo-700" size="lg">
                    {isApple && <Apple className="w-4 h-4 mr-2" />}
                    Upgrade to Premium
                  </Button>
                </Link>
              ) : (
                <Button
                  onClick={handleManageBilling}
                  disabled={!isApple && portalMutation.isPending}
                  className="flex-1"
                  size="lg"
                >
                  {isApple ? <Apple className="w-4 h-4 mr-2" /> : <CreditCard className="w-4 h-4 mr-2" />}
                  {!isApple && portalMutation.isPending ? 'Loading...' : 'Manage Subscription'}
                </Button>
              )}
              {isApple && (
                <Button
                  onClick={handleRestorePurchases}
                  variant="outline"
                  size="lg"
                >
                  Restore Purchases
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billing Portal Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isApple ? <Apple className="w-5 h-5 text-gray-700" /> : <CreditCard className="w-5 h-5 text-gray-700" />}
            Payment & Billing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isApple ? (
              <>
                <p className="text-gray-600">
                  Manage your Apple subscription:
                </p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span className="text-gray-700">View and manage subscriptions in iOS/macOS Settings</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span className="text-gray-700">Change or cancel subscription plans</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span className="text-gray-700">View purchase history</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span className="text-gray-700">Restore purchases on new devices</span>
                  </li>
                </ul>
                <Alert className="bg-blue-50 border-blue-200 mt-4">
                  <AlertCircle className="w-4 h-4 text-blue-600" />
                  <AlertDescription className="text-blue-800">
                    To manage your subscription: Settings → [Your Name] → Subscriptions → CareMetric AI
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <>
                <p className="text-gray-600">
                  Use the Stripe Customer Portal to:
                </p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span className="text-gray-700">Update payment methods</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span className="text-gray-700">View billing history and invoices</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span className="text-gray-700">Update billing information</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span className="text-gray-700">Cancel your subscription</span>
                  </li>
                </ul>

                {hasSubscription && (
                  <Button
                    onClick={handleManageBilling}
                    disabled={portalMutation.isPending}
                    variant="outline"
                    className="w-full mt-4"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open Billing Portal
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {!hasSubscription && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Ready to get started?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              Subscribe now to unlock all AI-powered features with unlimited usage.
            </p>
            <Link to={createPageUrl("SubscriptionPlans")}>
              <Button className="bg-indigo-600 hover:bg-indigo-700">
                View Subscription Details
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Divider */}
      <div className="my-12 border-t-2 border-gray-200"></div>

      {/* Pricing Plans Section */}
      <div className="mb-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">
            Simple, Transparent Pricing
          </h2>
          <p className="text-lg text-gray-600 mb-4">
            Choose the plan that works best for you
          </p>
          
          {/* Free Trial Banner */}
          <div className="inline-flex items-center gap-2 bg-green-100 text-green-800 px-5 py-2 rounded-full border-2 border-green-300">
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
                    disabled={subscription?.status === 'active'}
                  >
                    {subscription?.status === 'active' ? 'Current Plan' : 'Select Plan'}
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