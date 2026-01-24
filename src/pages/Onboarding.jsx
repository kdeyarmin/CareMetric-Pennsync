import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import ProviderOnboardingFlow from "../components/onboarding/ProviderOnboardingFlow";
import { Loader2 } from "lucide-react";

export const publicPage = true;

export default function Onboarding() {
  const navigate = useNavigate();
  
  const { data: currentUser, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin(window.location.pathname);
        return null;
      }
    }
  });

  // Redirect if already onboarded
  React.useEffect(() => {
    if (currentUser?.onboarding_completed) {
      navigate(createPageUrl('Dashboard'));
    }
  }, [currentUser, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-purple-50">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  return (
    <ProviderOnboardingFlow 
      currentUser={currentUser}
      onComplete={() => navigate(createPageUrl('Dashboard'))}
    />
  );
}