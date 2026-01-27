import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, GraduationCap, Plus } from "lucide-react";
import AdminTrainingAssignment from "../components/training/AdminTrainingAssignment";
import TrainingProgressDashboard from "../components/training/TrainingProgressDashboard";
import TrainingMaterialUploader from "../components/training/TrainingMaterialUploader";

export default function AdminTrainingManagement() {
  const [showUploader, setShowUploader] = useState(false);
  
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    }
  });

  const { data: providers = [] } = useQuery({
    queryKey: ['allProviders'],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role !== 'admin');
    },
    enabled: currentUser?.role === 'admin'
  });

  const { data: commonIssues = [] } = useQuery({
    queryKey: ['commonIssues'],
    queryFn: async () => {
      const audits = await base44.entities.ComplianceAudit.list('-audit_date', 500);
      
      const issueMap = {};
      audits.forEach(audit => {
        if (audit.issues && Array.isArray(audit.issues)) {
          audit.issues.forEach(issue => {
            const key = issue.element || 'Unknown';
            if (!issueMap[key]) {
              issueMap[key] = {
                issue: key,
                count: 0,
                providers: new Set()
              };
            }
            issueMap[key].count++;
            if (audit.nurse_email) {
              issueMap[key].providers.add(audit.nurse_email);
            }
          });
        }
      });

      return Object.values(issueMap)
        .map(i => ({
          issue: i.issue,
          prevalence: Math.round((i.count / Math.max(audits.length, 1)) * 100),
          affectedProviders: i.providers.size
        }))
        .sort((a, b) => b.prevalence - a.prevalence)
        .slice(0, 5);
    },
    enabled: currentUser?.role === 'admin'
  });

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-slate-600">Access denied. Admin only.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto w-full max-w-full overflow-x-hidden min-w-0 pb-20 sm:pb-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-2">
            <GraduationCap className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
            Training Management
          </h1>
          <p className="text-sm sm:text-base text-slate-600 mt-1">
            Assign training and track provider progress
          </p>
        </div>
        <Button onClick={() => setShowUploader(!showUploader)} className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto touch-target">
          <Plus className="w-4 h-4 mr-2" />
          {showUploader ? 'Hide Uploader' : 'Upload Training'}
        </Button>
      </div>

      {showUploader && (
        <div className="mb-4 sm:mb-6">
          <TrainingMaterialUploader onComplete={() => setShowUploader(false)} />
        </div>
      )}

      <Tabs defaultValue="assign" className="space-y-4 sm:space-y-6 w-full">
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger value="assign" className="text-xs sm:text-sm">Assign Training</TabsTrigger>
          <TabsTrigger value="progress" className="text-xs sm:text-sm">Progress & Analytics</TabsTrigger>
          <TabsTrigger value="upload" className="text-xs sm:text-sm">Upload Materials</TabsTrigger>
        </TabsList>

        <TabsContent value="assign">
          <AdminTrainingAssignment commonIssues={commonIssues} />
        </TabsContent>

        <TabsContent value="progress">
          <TrainingProgressDashboard providers={providers} />
        </TabsContent>

        <TabsContent value="upload">
          <TrainingMaterialUploader />
        </TabsContent>
      </Tabs>
    </div>
  );
}