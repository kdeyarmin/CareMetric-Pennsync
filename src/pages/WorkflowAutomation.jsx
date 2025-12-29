import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Workflow, Bell, Calendar, CheckCircle2, Clock, Settings } from "lucide-react";
import WorkflowManager from "../components/workflow/WorkflowManager";
import ApprovalQueue from "../components/workflow/ApprovalQueue";
import NotificationRuleManager from "../components/workflow/NotificationRuleManager";
import ScheduledReportManager from "../components/workflow/ScheduledReportManager";
import WorkflowExecutionMonitor from "../components/workflow/WorkflowExecutionMonitor";
import AdvancedPatientOutcomesAnalytics from "../components/reporting/AdvancedPatientOutcomesAnalytics";
import ReportTemplateBuilder from "../components/reporting/ReportTemplateBuilder";
import BIToolIntegration from "../components/reporting/BIToolIntegration";
import AIPatientHistorySummarizer from "../components/ai/AIPatientHistorySummarizer";
import AIHealthRiskPredictor from "../components/ai/AIHealthRiskPredictor";
import AICarePlanAdvisor from "../components/ai/AICarePlanAdvisor";

export default function WorkflowAutomation() {
  const [activeTab, setActiveTab] = useState("workflows");
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => base44.entities.WorkflowDefinition.list(),
    enabled: currentUser?.role === 'admin'
  });

  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ['pendingApprovals'],
    queryFn: () => base44.entities.ApprovalRequest.filter({ status: 'pending' })
  });

  const { data: notificationRules = [] } = useQuery({
    queryKey: ['notificationRules'],
    queryFn: () => base44.entities.NotificationRule.list(),
    enabled: currentUser?.role === 'admin'
  });

  const { data: scheduledReports = [] } = useQuery({
    queryKey: ['scheduledReports'],
    queryFn: () => base44.entities.ScheduledReport.list(),
    enabled: currentUser?.role === 'admin'
  });

  if (currentUser?.role !== 'admin') {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <Settings className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Admin Access Required</h2>
            <p className="text-gray-600">Only administrators can access workflow automation settings.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Workflow Automation</h1>
        <p className="text-gray-600">
          Streamline administrative tasks with automated workflows, notifications, and reports
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Active Workflows</p>
                <p className="text-3xl font-bold">{workflows.filter(w => w.is_active).length}</p>
              </div>
              <Workflow className="w-10 h-10 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Pending Approvals</p>
                <p className="text-3xl font-bold">{pendingApprovals.length}</p>
              </div>
              <Clock className="w-10 h-10 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Notification Rules</p>
                <p className="text-3xl font-bold">{notificationRules.filter(r => r.is_active).length}</p>
              </div>
              <Bell className="w-10 h-10 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Scheduled Reports</p>
                <p className="text-3xl font-bold">{scheduledReports.filter(r => r.is_active).length}</p>
              </div>
              <Calendar className="w-10 h-10 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 md:grid-cols-8 gap-1">
          <TabsTrigger value="workflows" className="flex items-center gap-1 text-xs md:text-sm px-2">
            <Workflow className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Workflows</span>
          </TabsTrigger>
          <TabsTrigger value="approvals" className="flex items-center gap-1 text-xs md:text-sm px-2">
            <CheckCircle2 className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Approvals</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-1 text-xs md:text-sm px-2">
            <Bell className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Notify</span>
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-1 text-xs md:text-sm px-2">
            <Calendar className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Reports</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-1 text-xs md:text-sm px-2">
            <Settings className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Analytics</span>
          </TabsTrigger>
          <TabsTrigger value="templates" className="flex items-center gap-1 text-xs md:text-sm px-2">
            <Settings className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Templates</span>
          </TabsTrigger>
          <TabsTrigger value="bi-tools" className="flex items-center gap-1 text-xs md:text-sm px-2">
            <Settings className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline">BI Tools</span>
          </TabsTrigger>
          <TabsTrigger value="monitor" className="flex items-center gap-1 text-xs md:text-sm px-2">
            <Clock className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Monitor</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workflows" className="mt-6">
          <WorkflowManager />
        </TabsContent>

        <TabsContent value="approvals" className="mt-6">
          <ApprovalQueue />
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <NotificationRuleManager />
        </TabsContent>

        <TabsContent value="reports" className="mt-6">
          <ScheduledReportManager />
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <div className="space-y-6">
            <AdvancedPatientOutcomesAnalytics />
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <AIPatientHistorySummarizer />
              <div className="space-y-6">
                <AIHealthRiskPredictor />
                <AICarePlanAdvisor />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="templates" className="mt-6">
          <ReportTemplateBuilder />
        </TabsContent>

        <TabsContent value="bi-tools" className="mt-6">
          <BIToolIntegration />
        </TabsContent>

        <TabsContent value="monitor" className="mt-6">
          <WorkflowExecutionMonitor />
        </TabsContent>
      </Tabs>
    </div>
  );
}