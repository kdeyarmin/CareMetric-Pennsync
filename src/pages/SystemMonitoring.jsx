import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, Cog, ShieldAlert } from "lucide-react";
import UserActivityLog from "./UserActivityLog";
import SystemJobMonitor from "./SystemJobMonitor";

export default function SystemMonitoring() {
  const [activeTab, setActiveTab] = useState("activity");

  const { data: currentUser, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center text-gray-500">
            Loading...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-12 text-center">
            <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
            <p className="text-gray-600 mb-4">
              Only administrators can access System Monitoring.
            </p>
            <p className="text-sm text-gray-500">
              Please contact your administrator if you need access to this feature.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6">
            <TabsList className="grid w-full max-w-md grid-cols-2 h-12 sm:h-14 gap-1">
              <TabsTrigger value="activity" className="gap-1 sm:gap-2 text-xs sm:text-sm">
                <Activity className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden xs:inline">User </span>Activity
              </TabsTrigger>
              <TabsTrigger value="jobs" className="gap-1 sm:gap-2 text-xs sm:text-sm">
                <Cog className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden xs:inline">System </span>Jobs
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="activity" className="m-0">
          <UserActivityLog />
        </TabsContent>

        <TabsContent value="jobs" className="m-0">
          <SystemJobMonitor />
        </TabsContent>
      </Tabs>
    </div>
  );
}