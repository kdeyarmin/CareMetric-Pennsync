/**
 * HIPAA Compliance Dashboard
 * 
 * Central hub for HIPAA compliance monitoring and reporting
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, FileText, AlertTriangle, Lock } from "lucide-react";
import HIPAAComplianceChecker from "../components/security/HIPAAComplianceChecker";
import SecurityMonitor from "../components/security/SecurityMonitor";
import HIPAACompliance from "../components/security/HIPAACompliance";
import SecurityDocumentation from "../components/security/SecurityDocumentation";

export default function HIPAACompliancePage() {
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    }
  });

  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <Shield className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <h2 className="text-xl font-bold mb-2">Admin Access Required</h2>
            <p className="text-gray-600">
              Only administrators can access HIPAA compliance tools.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-100 rounded-lg">
            <Shield className="w-8 h-8 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">HIPAA Compliance Center</h1>
            <p className="text-gray-600">Monitor and maintain HIPAA compliance across the platform</p>
          </div>
        </div>

        {/* Compliance Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Lock className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Encryption Status</p>
                  <p className="text-lg font-bold text-gray-900">Active</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Audit Logs</p>
                  <p className="text-lg font-bold text-gray-900">Enabled</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Shield className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Access Controls</p>
                  <p className="text-lg font-bold text-gray-900">Configured</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Active Alerts</p>
                  <p className="text-lg font-bold text-gray-900">0</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="checker" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="checker">Compliance Checker</TabsTrigger>
            <TabsTrigger value="monitor">Security Monitor</TabsTrigger>
            <TabsTrigger value="policies">Policies & Procedures</TabsTrigger>
            <TabsTrigger value="documentation">Documentation</TabsTrigger>
          </TabsList>

          <TabsContent value="checker" className="space-y-4">
            <HIPAAComplianceChecker />
          </TabsContent>

          <TabsContent value="monitor" className="space-y-4">
            <SecurityMonitor />
          </TabsContent>

          <TabsContent value="policies" className="space-y-4">
            <HIPAACompliance />
          </TabsContent>

          <TabsContent value="documentation" className="space-y-4">
            <SecurityDocumentation />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}