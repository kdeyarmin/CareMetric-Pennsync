import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader, AlertCircle, Settings } from "lucide-react";
import ProviderPreferencesForm from "../components/settings/ProviderPreferencesForm";

export default function ProviderSettings() {
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        return null;
      }
    }
  });

  const { data: preferences, isLoading: prefsLoading, refetch } = useQuery({
    queryKey: ["providerPreferences", currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return null;
      const prefs = await base44.entities.ProviderPreferences.filter({
        provider_email: currentUser.email
      });
      return prefs[0] || null;
    },
    enabled: !!currentUser?.email
  });

  if (userLoading || prefsLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <Loader className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <Alert className="bg-red-50 border-red-200">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800">
            You must be logged in to access provider settings
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Settings className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Provider Settings</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Customize your documentation preferences and AI personalization
              </p>
            </div>
          </div>
        </div>

        {/* Info Alert */}
        <Alert className="mb-6 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
          <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-sm text-blue-800 dark:text-blue-200">
            These settings personalize your AI-generated notes and documentation feedback. Your preferences will be applied to all future notes and help fine-tune the AI to match your style.
          </AlertDescription>
        </Alert>

        {/* Settings Card */}
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader>
            <CardTitle>Documentation Preferences</CardTitle>
          </CardHeader>
          <CardContent>
            <ProviderPreferencesForm 
              preferences={preferences}
              onSaved={() => refetch()}
            />
          </CardContent>
        </Card>

        {/* Usage Tips */}
        <Card className="mt-6 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
          <CardHeader>
            <CardTitle className="text-base">💡 Tips for Best Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
            <p>• <strong>Preferred Phrasing:</strong> Be specific about how you like to document vital signs, assessments, and interventions. The AI will learn your style.</p>
            <p>• <strong>Priorities:</strong> Select elements you always want emphasized. These will be highlighted in AI-generated notes.</p>
            <p>• <strong>Defaults:</strong> Set your most common visit types and diagnoses for quicker note generation.</p>
            <p>• <strong>AI Settings:</strong> Adjust writing style, tone, and detail level to match your documentation approach.</p>
            <p>• <strong>Feedback:</strong> Use inline feedback on notes to continuously improve AI personalization.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}