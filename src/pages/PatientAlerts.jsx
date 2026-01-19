import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Bell,
  Brain,
  RefreshCw,
  Users,
  Activity,
  Zap,
  Loader,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";

import PatientAlertsDashboard from "../components/alerts/PatientAlertsDashboard";
import PatientAlertAnalyzer from "../components/alerts/PatientAlertAnalyzer";
import PullToRefresh from "../components/mobile/PullToRefresh";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";

export default function PatientAlerts() {
  const queryClient = useQueryClient();
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [analysisResults, setAnalysisResults] = useState(null);
  const [generatingAlerts, setGeneratingAlerts] = useState(false);

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' })
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const handleAlertsGenerated = (alerts, results) => {
    setAnalysisResults(results);
  };

  const generateBulkAlerts = async (autoCreateTasks = false) => {
    setGeneratingAlerts(true);
    try {
      const { data } = await base44.functions.invoke('generatePatientAlerts', {
        auto_create_tasks: autoCreateTasks
      });

      toast.success(`Generated ${data.alerts_created} alerts${autoCreateTasks ? ` and ${data.tasks_created} tasks` : ''}`);
      
      // Refresh alerts
      await queryClient.invalidateQueries({ queryKey: ['patientAlerts'] });
    } catch (error) {
      toast.error('Failed to generate alerts');
      console.error(error);
    } finally {
      setGeneratingAlerts(false);
    }
  };

  const generateSinglePatientAlert = async (patientId) => {
    setGeneratingAlerts(true);
    try {
      const { data } = await base44.functions.invoke('generatePatientAlerts', {
        patient_id: patientId,
        auto_create_tasks: true
      });

      toast.success(`Generated ${data.alerts_created} alerts for patient`);
      
      // Refresh alerts
      await queryClient.invalidateQueries({ queryKey: ['patientAlerts'] });
      setAnalysisResults(data);
    } catch (error) {
      toast.error('Failed to generate alerts');
      console.error(error);
    } finally {
      setGeneratingAlerts(false);
    }
  };

  return (
    <PullToRefresh onRefresh={async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patients'] }),
        queryClient.invalidateQueries({ queryKey: ['patientAlerts'] })
      ]);
    }}>
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full max-w-full overflow-x-hidden min-w-0">
      {/* Header */}
      <motion.div 
        className="mb-4 sm:mb-6 lg:mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 sm:gap-3">
            <Bell className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 text-slate-700 dark:text-slate-400" />
            Patient Alerts
          </h1>
          <Button 
            onClick={() => generateBulkAlerts(true)} 
            disabled={generatingAlerts}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {generatingAlerts ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Scan All Patients
              </>
            )}
          </Button>
        </div>
        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">
          AI-powered proactive identification of critical events and potential deteriorations
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 w-full max-w-full overflow-x-hidden min-w-0">
        {/* Main Alerts Dashboard */}
        <div className="lg:col-span-2 min-w-0 max-w-full overflow-hidden">
          <PatientAlertsDashboard showAllPatients={true} />
        </div>

        {/* Sidebar - Analyzer & Quick Actions */}
        <div className="space-y-6 min-w-0 max-w-full overflow-hidden">
          {/* Patient Selector for Analysis */}
          <Card className="border-slate-300 dark:border-slate-600">
            <CardHeader className="py-3 sm:py-4 bg-slate-100 dark:bg-slate-800">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <Brain className="w-4 h-4 sm:w-5 sm:h-5 text-slate-700 dark:text-slate-400" />
                Analyze Patient
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              <Select value={selectedPatientId || "none"} onValueChange={(val) => setSelectedPatientId(val === "none" ? "" : val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select patient to analyze..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select a patient</SelectItem>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} - {p.primary_diagnosis || 'No diagnosis'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedPatientId && (
                <div className="mt-4 space-y-3">
                  <Button 
                    onClick={() => generateSinglePatientAlert(selectedPatientId)}
                    disabled={generatingAlerts}
                    className="w-full"
                  >
                    {generatingAlerts ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Brain className="w-4 h-4 mr-2" />
                        Generate AI Alerts
                      </>
                    )}
                  </Button>
                  <PatientAlertAnalyzer
                    patientId={selectedPatientId}
                    onAlertsGenerated={handleAlertsGenerated}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Analysis Results Summary */}
          {analysisResults && (
            <Card className="border-slate-300 dark:border-slate-600">
              <CardHeader className="py-3 bg-slate-100 dark:bg-slate-800">
                <CardTitle className="text-sm flex items-center gap-2 text-slate-900 dark:text-slate-100">
                  <Activity className="w-4 h-4 text-slate-700 dark:text-slate-400" />
                  Analysis Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="p-3 bg-slate-100 dark:bg-slate-900 rounded-lg">
                  <p className="text-sm text-slate-900 dark:text-slate-100">{analysisResults.analysis_summary}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 dark:text-slate-400">Overall Risk:</span>
                  <Badge className={
                    analysisResults.overall_risk_level === 'critical' ? 'bg-slate-700 text-white' :
                    analysisResults.overall_risk_level === 'high' ? 'bg-slate-600 text-white' :
                    analysisResults.overall_risk_level === 'moderate' ? 'bg-slate-500 text-white' :
                    'bg-slate-400 text-slate-900'
                  }>
                    {analysisResults.overall_risk_level}
                  </Badge>
                </div>

                {analysisResults.positive_indicators?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-900 dark:text-slate-100 mb-1">Positive Indicators:</p>
                    <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-0.5">
                      {analysisResults.positive_indicators.map((indicator, idx) => (
                        <li key={idx}>✓ {indicator}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {analysisResults.monitoring_recommendations?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-900 dark:text-slate-100 mb-1">Monitor:</p>
                    <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-0.5">
                      {analysisResults.monitoring_recommendations.slice(0, 3).map((rec, idx) => (
                        <li key={idx}>• {rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Quick Tips */}
          <Card className="bg-slate-100 dark:bg-slate-900 border-slate-300 dark:border-slate-600">
            <CardContent className="p-4">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Alert Response Guide
              </h3>
              <ul className="text-sm text-slate-800 dark:text-slate-200 space-y-2">
                <li className="flex items-start gap-2">
                  <Badge className="bg-slate-700 text-white text-xs shrink-0">Critical</Badge>
                  <span>Immediate action within 1 hour</span>
                </li>
                <li className="flex items-start gap-2">
                  <Badge className="bg-slate-600 text-white text-xs shrink-0">High</Badge>
                  <span>Address within 24 hours</span>
                </li>
                <li className="flex items-start gap-2">
                  <Badge className="bg-slate-500 text-white text-xs shrink-0">Medium</Badge>
                  <span>Address within 48-72 hours</span>
                </li>
                <li className="flex items-start gap-2">
                  <Badge className="bg-slate-400 text-slate-900 text-xs shrink-0">Low</Badge>
                  <span>Monitor at next visit</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}