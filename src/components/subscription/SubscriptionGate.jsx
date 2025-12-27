import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Crown, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function SubscriptionGate({ 
  requiredPlan = 'basic', 
  feature = 'this feature',
  children 
}) {
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

  // Check if user has active subscription
  const hasAccess = subscription && subscription.status === 'active';

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-gray-500">
          Checking subscription...
        </CardContent>
      </Card>
    );
  }

  if (!hasAccess) {
    return (
      <Card className="border-2 border-yellow-300 bg-gradient-to-br from-yellow-50 to-orange-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-900">
            <Lock className="w-6 h-6" />
            Premium Feature
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-700 mb-4">
            {feature} requires an active subscription.
          </p>
          <p className="text-sm text-gray-600 mb-6">
            Subscribe now to unlock all AI-powered features with unlimited usage.
          </p>
          <Link to={createPageUrl("SubscriptionPlans")}>
            <Button className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700">
              <Crown className="w-4 h-4 mr-2" />
              Subscribe Now
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}