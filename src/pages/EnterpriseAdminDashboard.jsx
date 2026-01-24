import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Building2, Users, TrendingUp, Settings, Brain } from "lucide-react";
import ProviderPerformanceTable from "../components/enterprise/ProviderPerformanceTable";
import AgencyAIConfiguration from "../components/enterprise/AgencyAIConfiguration";
import AgencyAnalyticsDashboard from "../components/enterprise/AgencyAnalyticsDashboard";
import EnterpriseSetupPanel from "../components/enterprise/EnterpriseSetupPanel";

export default function EnterpriseAdminDashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: async () => {
      return await base44.entities.User.list();
    },
    enabled: currentUser?.role === 'admin'
  });

  const { data: agencySettings } = useQuery({
    queryKey: ['agencySettings'],
    queryFn: async () => {
      const settings = await base44.entities.AgencySettings.list();
      return settings[0] || null;
    },
    enabled: currentUser?.role === 'admin'
  });

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-slate-600">Access denied. Admin privileges required.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const providers = allUsers.filter(u => u.role !== 'admin');
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
              <Building2 className="w-8 h-8 text-blue-600" />
              Enterprise Dashboard
            </h1>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Manage your agency's providers, performance, and AI configuration
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Total Providers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                {providers.length}
              </div>
              <p className="text-xs text-slate-500 mt-1">Active accounts</p>
            </CardContent>
          </Card>

          <Card className="border-green-200 bg-green-50 dark:bg-green-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Agency Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                Enterprise
              </div>
              <p className="text-xs text-slate-500 mt-1">Full access enabled</p>
            </CardContent>
          </Card>

          <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                AI Learning
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">
                {agencySettings?.ai_learning_enabled ? 'Active' : 'Inactive'}
              </div>
              <p className="text-xs text-slate-500 mt-1">Agency-wide AI</p>
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Customization
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">
                {agencySettings?.custom_templates_count || 0}
              </div>
              <p className="text-xs text-slate-500 mt-1">Custom templates</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="providers" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Providers
            </TabsTrigger>
            <TabsTrigger value="ai-config" className="flex items-center gap-2">
              <Brain className="w-4 h-4" />
              AI Learning
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <AgencyAnalyticsDashboard providers={providers} />
          </TabsContent>

          <TabsContent value="providers">
            <ProviderPerformanceTable providers={providers} />
          </TabsContent>

          <TabsContent value="ai-config">
            <AgencyAIConfiguration agencySettings={agencySettings} />
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <EnterpriseSetupPanel 
              agencySettings={agencySettings}
              onSetupComplete={() => {
                // Refresh agency settings
                window.location.reload();
              }}
            />
            
            <Card>
              <CardHeader>
                <CardTitle>Additional Agency Settings</CardTitle>
                <CardDescription>
                  Configure agency-wide preferences and policies
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  More settings coming soon...
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}