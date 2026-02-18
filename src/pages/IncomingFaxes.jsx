import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Inbox, Sparkles } from "lucide-react";
import IncomingFaxInbox from "@/components/fax/IncomingFaxInbox";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";

export default function IncomingFaxes() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  return (
    <PremiumFeatureGate featureName="Incoming Fax AI" featureDescription="AI-powered incoming fax analysis and routing" allowTrial={true}>
      <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto pb-20 sm:pb-6 bg-gradient-to-br from-slate-200 via-blue-100 to-slate-300">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="w-6 h-6 text-blue-600" />
            Incoming Faxes
          </h1>
          <p className="text-sm text-slate-600 mt-1 flex items-center gap-1">
            <Sparkles className="w-4 h-4 text-blue-500" />
            AI-powered analysis, categorization, and smart routing
          </p>
        </div>

        <Card className="mb-4 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-slate-900 mb-1">AI-Powered Fax Intelligence</p>
                <ul className="text-xs text-slate-600 space-y-1">
                  <li>• Automatic OCR and text extraction from image faxes</li>
                  <li>• Smart categorization (lab results, referrals, prescriptions, etc.)</li>
                  <li>• Key information extraction (patient ID, dates, providers)</li>
                  <li>• Urgency detection and critical finding alerts</li>
                  <li>• Intelligent routing suggestions to appropriate staff</li>
                  <li>• Patient record matching and auto-linking</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <IncomingFaxInbox userEmail={currentUser?.email} />
      </div>
    </PremiumFeatureGate>
  );
}