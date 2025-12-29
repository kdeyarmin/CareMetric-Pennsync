import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Loader2 } from "lucide-react";
import PaywallScreen from "./PaywallScreen";

/**
 * Gate component that checks if user has active subscription
 * Shows paywall if not subscribed, shows children if subscribed
 * 
 * Usage:
 * <PremiumFeatureGate featureName="AI Smart Notes">
 *   <YourPremiumComponent />
 * </PremiumFeatureGate>
 */
export default function PremiumFeatureGate({ 
  children, 
  featureName = "Premium Feature",
  featureDescription = "This feature requires an active subscription.",
  compact = false,
  allowTrial = true
}) {
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: async () => {
      const subs = await base44.entities.Subscription.filter({ user_email: currentUser.email });
      return subs[0];
    },
    enabled: !!currentUser?.email
  });

  // Show loading state
  if (userLoading || subLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Check if user has access
  const isAdmin = currentUser?.role === 'admin';
  const hasActiveSubscription = subscription && subscription.status === 'active';
  const hasTrialAccess = allowTrial && subscription && subscription.status === 'trialing';
  const hasAccess = isAdmin || hasActiveSubscription || hasTrialAccess;

  // Show paywall if no access
  if (!hasAccess) {
    return (
      <PaywallScreen
        featureName={featureName}
        featureDescription={featureDescription}
        compact={compact}
      />
    );
  }

  // User has access, show the premium content
  return <>{children}</>;
}