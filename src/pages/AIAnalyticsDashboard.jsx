import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, TrendingUp, Heart, Shield, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import PatientOutcomeAnalytics from "@/components/analytics/PatientOutcomeAnalytics";
import ComplianceQualityTrends from "@/components/analytics/ComplianceQualityTrends";
import ReadmissionRiskAnalytics from "@/components/analytics/ReadmissionRiskAnalytics";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";

export default function AIAnalyticsDashboard() {
  const [activeTab, setActiveTab] = useState("outcomes");
  const [refreshing, setRefreshing] = useState(false);

  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const refreshAllData = async () => {
    setRefreshing(true);
    try {
      // Trigger all three analytics endpoints
      await Promise.all([
        base44.functions.invoke('patientOutcomeAnalysis', { time_period: '90days' }),
        base44.functions.invoke('complianceAnalytics', { time_period: '90days' }),
        base44.functions.invoke('readmissionRiskPredictor', { limit: 50 })
      ]);
      toast.success("All analytics refreshed");
    } catch (error) {
      console.error('Refresh error:', error);
      toast.error("Failed to refresh analytics");
    } finally {
      setRefreshing(false);
    }
  };

  const downloadReport = async () => {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const content = `AI Analytics Dashboard Report
Generated: ${new Date().toLocaleString()}
User: ${user?.email}

This report includes:
1. Patient Outcome Analysis - Treatment protocol effectiveness and success rates by diagnosis
2. Documentation Quality & Compliance Trends - Provider performance and violation patterns
3. Readmission Risk Prediction - High-risk patient identification with intervention recommendations

For detailed insights, please visit the Analytics Dashboard in the application.`;

      const element = document.createElement('a');
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
      element.setAttribute('download', `analytics-report-${timestamp}.txt`);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      toast.success("Report downloaded");
    } catch (error) {
      toast.error("Failed to download report");
    }
  };

  return (
    <PremiumFeatureGate 
      featureName="AI Analytics Dashboard" 
      featureDescription="Advanced patient outcomes, compliance trends, and readmission risk prediction analytics."
      allowTrial={true}
    >
      <div className="min-h-screen p-4 lg:p-6 pb-20 lg:pb-6 overflow-x-hidden w-full max-w-full">
        <div className="max-w-7xl mx-auto space-y-4 w-full max-w-full overflow-x-hidden min-w-0">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
                <BarChart3 className="w-8 h-8 text-blue-600" />
                AI Analytics Dashboard
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Real-time insights powered by AI analysis of clinical data
              </p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto flex-wrap">
              <Button 
                onClick={refreshAllData} 
                disabled={refreshing}
                variant="outline"
                className="flex-1 sm:flex-initial"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button 
                onClick={downloadReport}
                variant="outline"
                className="flex-1 sm:flex-initial"
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            </div>
          </div>

          {/* Key Metrics Overview */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: TrendingUp, label: 'Patient Outcomes', color: 'blue', desc: 'Treatment effectiveness' },
              { icon: Shield, label: 'Compliance', color: 'green', desc: 'Quality & documentation' },
              { icon: Heart, label: 'Risk Prediction', color: 'red', desc: 'Readmission risks' },
              { icon: BarChart3, label: 'AI Insights', color: 'purple', desc: 'Actionable intelligence' }
            ].map((metric, idx) => {
              const Icon = metric.icon;
              const colorClasses = {
                blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
                green: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
                red: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
                purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
              };
              return (
                <Card key={idx} className={`p-3 ${colorClasses[metric.color]}`}>
                  <div className="flex items-start gap-2">
                    <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-xs sm:text-sm">{metric.label}</p>
                      <p className="text-[10px] sm:text-xs opacity-75">{metric.desc}</p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="outcomes" className="text-xs sm:text-sm">
                <TrendingUp className="w-4 h-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Patient Outcomes</span>
                <span className="sm:hidden">Outcomes</span>
              </TabsTrigger>
              <TabsTrigger value="compliance" className="text-xs sm:text-sm">
                <Shield className="w-4 h-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Compliance Trends</span>
                <span className="sm:hidden">Compliance</span>
              </TabsTrigger>
              <TabsTrigger value="readmission" className="text-xs sm:text-sm">
                <Heart className="w-4 h-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Readmission Risk</span>
                <span className="sm:hidden">Risk</span>
              </TabsTrigger>
            </TabsList>

            {/* Content Tabs */}
            <TabsContent value="outcomes" className="space-y-4">
              <PatientOutcomeAnalytics />
            </TabsContent>

            <TabsContent value="compliance" className="space-y-4">
              <ComplianceQualityTrends />
            </TabsContent>

            <TabsContent value="readmission" className="space-y-4">
              <ReadmissionRiskAnalytics />
            </TabsContent>
          </Tabs>

          {/* Info Cards */}
          <Card className="border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">📊 About This Dashboard</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-700 dark:text-slate-300 space-y-2">
              <p>
                <strong>Patient Outcomes:</strong> Analyzes treatment protocol effectiveness and success rates across diagnoses, identifying top-performing protocols and those needing improvement.
              </p>
              <p>
                <strong>Compliance Trends:</strong> Tracks documentation quality and compliance metrics by provider, identifies violation patterns, and recommends targeted improvements.
              </p>
              <p>
                <strong>Readmission Risk:</strong> Uses AI to predict high-risk patients based on clinical context, medications, comorbidities, and historical patterns, with actionable intervention recommendations.
              </p>
              <p className="pt-2 border-t border-blue-200 dark:border-blue-700">
                All insights are powered by AI analysis and updated based on your latest clinical data. Refresh data regularly for the most current insights.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PremiumFeatureGate>
  );
}