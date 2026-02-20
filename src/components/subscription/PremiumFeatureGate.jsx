import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();

  // Clear cache if subscription was just activated
  React.useEffect(() => {
    const justActivated = localStorage.getItem('subscription_just_activated');
    if (justActivated === 'true') {
      localStorage.removeItem('subscription_just_activated');
      queryClient.clear();
    }
  }, [queryClient]);

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: async () => {
      const response = await base44.functions.invoke('getMySubscription', {});
      return response?.data?.subscription || response?.subscription;
    },
    enabled: !!currentUser?.email,
    staleTime: 0, // Always fetch fresh - user might have just restored
    refetchOnMount: 'always' // Always refetch when component mounts
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
  const hasLifetimeFree = subscription && subscription.status === 'lifetime_free';
  
  // Check trial: must be trialing AND within 14-day window
  let hasTrialAccess = false;
  if (subscription && subscription.status === 'trialing' && subscription.trial_end) {
    const trialEnd = new Date(subscription.trial_end);
    const now = new Date();
    hasTrialAccess = now <= trialEnd;
    console.log('[PremiumFeatureGate] Trial check:', { 
      trialEnd: trialEnd.toISOString(), 
      now: now.toISOString(), 
      hasAccess: hasTrialAccess 
    });
  }
  
  // User has access ONLY if:
  // - They're an admin, OR
  // - They have an active paid subscription, OR  
  // - They have a lifetime free subscription, OR
  // - They have a valid trial (trialing status AND within 14-day window)
  // 
  // BLOCKED if:
  // - No subscription at all
  // - Subscription is expired, canceled, past_due, unpaid, incomplete, or paused
  // - Trial period has ended (even if status is still 'trialing')
  const hasAccess = isAdmin || hasActiveSubscription || hasTrialAccess || hasLifetimeFree;

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