import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Calendar, AlertCircle, ExternalLink, Crown, Apple } from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import TrialStatusBanner from "../components/subscription/TrialStatusBanner";
import { isApplePlatform } from "@/components/utils/platformDetection";
import { useAppleIAP } from "@/components/subscription/AppleIAPManager";

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
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Billing & Subscription</h1>
        <p className="text-gray-600">Manage your subscription and payment methods</p>
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

      {/* Legal Links */}
      <Card className="mt-6">
        <CardContent className="p-6">
          <div className="flex flex-wrap justify-center gap-4 text-sm text-gray-600">
            <Link to={createPageUrl("TermsOfUse")} className="hover:text-blue-600 hover:underline">
              Terms of Use
            </Link>
            <span className="text-gray-400">•</span>
            <Link to={createPageUrl("PrivacyPolicy")} className="hover:text-blue-600 hover:underline">
              Privacy Policy
            </Link>
            <span className="text-gray-400">•</span>
            <Link to={createPageUrl("EULA")} className="hover:text-blue-600 hover:underline">
              EULA
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}