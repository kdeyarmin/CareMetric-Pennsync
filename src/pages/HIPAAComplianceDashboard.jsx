import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Loader2 } from "lucide-react";
import HIPAAComplianceReport from "../components/security/HIPAAComplianceReport";
import BreachDetectionMonitor from "../components/security/BreachDetectionMonitor";
import DetailedAuditTrailViewer from "../components/admin/DetailedAuditTrailViewer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function HIPAAComplianceDashboard() {
  const { data: currentUser, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8">
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-12 text-center">
            <Shield className="w-16 h-16 text-red-600 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-red-900 mb-2">Admin Access Required</h2>
            <p className="text-red-700">HIPAA compliance dashboard is only accessible to administrators</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">HIPAA Compliance Dashboard</h1>
            <p className="text-slate-600">Security audit, breach monitoring, and compliance verification</p>
          </div>
        </div>

        <Tabs defaultValue="audit" className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="audit" className="gap-2">
              <Shield className="w-4 h-4" />
              Compliance Audit
            </TabsTrigger>
            <TabsTrigger value="breaches" className="gap-2">
              <Shield className="w-4 h-4" />
              Breach Monitor
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-2">
              <Shield className="w-4 h-4" />
              Audit Trail
            </TabsTrigger>
          </TabsList>

          <TabsContent value="audit" className="mt-6">
            <HIPAAComplianceReport />
          </TabsContent>

          <TabsContent value="breaches" className="mt-6">
            <BreachDetectionMonitor />
          </TabsContent>

          <TabsContent value="logs" className="mt-6">
            <DetailedAuditTrailViewer />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}