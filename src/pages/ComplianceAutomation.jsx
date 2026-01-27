import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Shield, AlertTriangle, CheckCircle2, Settings, 
  Activity, BarChart3, FileText, TrendingUp, Zap
} from "lucide-react";
import PullToRefresh from "../components/mobile/PullToRefresh";
import ComplianceRuleDashboard from "../components/compliance/ComplianceRuleDashboard";
import AutomatedComplianceChecker from "../components/compliance/AutomatedComplianceChecker";

export default function ComplianceAutomation() {
  const [testContent, setTestContent] = useState("");
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: recentAudits = [] } = useQuery({
    queryKey: ['recentComplianceAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 50)
  });

  const { data: violations = [] } = useQuery({
    queryKey: ['complianceViolations'],
    queryFn: () => base44.entities.ComplianceViolation.filter({ status: 'open' })
  });

  const automatedAudits = recentAudits.filter(a => a.audit_type === 'automated');
  const avgScore = automatedAudits.length > 0
    ? (automatedAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / automatedAudits.length).toFixed(1)
    : 0;

  const criticalViolations = violations.filter(v => v.severity === 'critical');
  const highViolations = violations.filter(v => v.severity === 'high');

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Admin Access Required</h2>
            <p className="text-gray-600">This page is only accessible to administrators.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={async () => {
      await queryClient.invalidateQueries();
    }}>
      <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto w-full max-w-full overflow-x-hidden min-w-0 pb-20 sm:pb-6">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Zap className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
            Automated Compliance System
          </h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">
            Proactive compliance monitoring with AI-powered analysis
          </p>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="p-3 sm:p-4">
              <Activity className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600 mb-2" />
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{automatedAudits.length}</p>
              <p className="text-[10px] sm:text-xs text-gray-600">Auto-Checks Run</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardContent className="p-3 sm:p-4">
              <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-green-600 mb-2" />
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{avgScore}%</p>
              <p className="text-[10px] sm:text-xs text-gray-600">Avg Compliance Score</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
            <CardContent className="p-3 sm:p-4">
              <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-red-600 mb-2" />
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{criticalViolations.length}</p>
              <p className="text-[10px] sm:text-xs text-gray-600">Critical Issues</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
            <CardContent className="p-3 sm:p-4">
              <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-orange-600 mb-2" />
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{highViolations.length}</p>
              <p className="text-[10px] sm:text-xs text-gray-600">High Priority</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="rules" className="space-y-4 sm:space-y-6 w-full">
          <TabsList className="grid w-full grid-cols-3 h-auto">
            <TabsTrigger value="rules" className="text-xs sm:text-sm">Compliance Rules</TabsTrigger>
            <TabsTrigger value="test" className="text-xs sm:text-sm">Test Checker</TabsTrigger>
            <TabsTrigger value="violations" className="text-xs sm:text-sm">Open Issues ({violations.length})</TabsTrigger>
          </TabsList>

          {/* Rules Management */}
          <TabsContent value="rules">
            <ComplianceRuleDashboard />
          </TabsContent>

          {/* Test Compliance Checker */}
          <TabsContent value="test" className="w-full">
            <Card className="w-full">
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="text-base sm:text-lg">Test Compliance Checker</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-4 sm:p-6 pt-0">
                <div>
                  <Label className="text-xs sm:text-sm">Paste documentation to test:</Label>
                  <Textarea
                    value={testContent}
                    onChange={(e) => setTestContent(e.target.value)}
                    placeholder="Paste a visit note, assessment, or any clinical documentation to test the compliance checker..."
                    className="mt-2 min-h-48 sm:min-h-64 font-mono text-xs sm:text-sm"
                  />
                </div>

                <AutomatedComplianceChecker
                  documentContent={testContent}
                  documentType="test document"
                  autoCheck={false}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Open Violations */}
          <TabsContent value="violations" className="w-full">
            <Card className="w-full">
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600" />
                  Open Compliance Issues
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-6 pt-0">
                {violations.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                    <p className="text-gray-600">No open compliance issues</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {violations.map((violation, idx) => (
                      <Card key={idx} className={`border-l-4 w-full ${
                        violation.severity === 'critical' ? 'border-l-red-500' :
                        violation.severity === 'high' ? 'border-l-orange-500' :
                        'border-l-yellow-500'
                      }`}>
                        <CardContent className="p-3 sm:p-4">
                          <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                            <div className="flex-1 w-full min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-2">
                                <h4 className="font-semibold text-xs sm:text-sm break-words">{violation.rule_name}</h4>
                                <Badge className={
                                  violation.severity === 'critical' ? 'bg-red-600' :
                                  violation.severity === 'high' ? 'bg-orange-600' :
                                  'bg-yellow-600'
                                }>
                                  {violation.severity}
                                </Badge>
                              </div>
                              <p className="text-xs sm:text-sm text-gray-700 break-words">{violation.violation_description}</p>
                              {violation.recommended_action && (
                                <p className="text-xs sm:text-sm text-blue-700 mt-2 break-words">
                                  <strong>Action:</strong> {violation.recommended_action}
                                </p>
                              )}
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                <span className="text-[10px] sm:text-xs text-gray-500 break-all">
                                  {violation.user_email}
                                </span>
                                <span className="text-xs text-gray-400 hidden sm:inline">•</span>
                                <span className="text-[10px] sm:text-xs text-gray-500">
                                  {new Date(violation.created_date).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PullToRefresh>
  );
}