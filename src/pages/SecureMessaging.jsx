import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Shield, Loader2 } from "lucide-react";
import MessagingInbox from "@/components/messaging/MessagingInbox";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";

export default function SecureMessaging() {
  const { data: currentUser, isLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <PremiumFeatureGate featureName="Secure Messaging" featureDescription="HIPAA-compliant messaging for care team and patient communication." allowTrial={true}>
      <div className="p-3 sm:p-4 md:p-6 max-w-4xl mx-auto pb-20 sm:pb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-blue-600" />
              Secure Messaging
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              HIPAA-compliant care team and patient communication
            </p>
          </div>
          <Badge className="bg-green-100 text-green-700 text-xs">
            <Shield className="w-3 h-3 mr-1" /> HIPAA Secure
          </Badge>
        </div>

        <MessagingInbox userEmail={currentUser?.email} />
      </div>
    </PremiumFeatureGate>
  );
}