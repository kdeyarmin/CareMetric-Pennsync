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

  const { data: subscription, isLoading: subLoading, isFetching } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: async () => {
      const response = await base44.functions.invoke('getMySubscription', {});
      const sub = response?.data?.subscription || response?.subscription;
      
      // Cache in localStorage as backup
      if (sub && sub.status === 'active') {
        localStorage.setItem('cached_subscription', JSON.stringify(sub));
      }
      
      return sub;
    },
    enabled: !!currentUser?.email,
    staleTime: 300000,
    initialData: () => {
      // Try to get from localStorage first
      try {
        const cached = localStorage.getItem('cached_subscription');
        return cached ? JSON.parse(cached) : undefined;
      } catch {
        return undefined;
      }
    }
  });

  // Show loading state (including isFetching to prevent paywall flash)
  if (userLoading || subLoading || isFetching) {
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
  const hasLifetimeFree = subscription && subscription.status === 'lifetime_free';
  const hasAccess = isAdmin || hasActiveSubscription || hasTrialAccess || hasLifetimeFree;
  
  console.log('PremiumFeatureGate: Access check for', featureName);
  console.log('  - isAdmin:', isAdmin);
  console.log('  - subscription:', subscription);
  console.log('  - subscription.status:', subscription?.status);
  console.log('  - hasActiveSubscription:', hasActiveSubscription);
  console.log('  - hasTrialAccess:', hasTrialAccess);
  console.log('  - hasLifetimeFree:', hasLifetimeFree);
  console.log('  - hasAccess:', hasAccess);

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