import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Brain,
  Activity,
  Zap,
  CheckCircle2
} from "lucide-react";

import PatientAlertsDashboard from "../components/alerts/PatientAlertsDashboard";
import PatientAlertAnalyzer from "../components/alerts/PatientAlertAnalyzer";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

export default function PatientAlerts() {
  const [searchParams] = useSearchParams();
  const [selectedPatientId, setSelectedPatientId] = useState(searchParams.get("patientId") || searchParams.get("id") || "");
  const [analysisResults, setAnalysisResults] = useState(null);

  const { data: patients = [] } = useQuery({
    // Namespaced: this is the ACTIVE-only patient set. The bare ['patients'] key is
    // also used by all-patients (Patient.list) queries elsewhere, so sharing it let
    // React Query serve this active-only screen the full unfiltered roster (or vice
    // versa) depending on mount order. A ['patients']-prefix invalidate still
    // refreshes this key.
    queryKey: ['patients', 'active'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' })
  });

  const { data: _currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const handleAlertsGenerated = (alerts, results) => {
    setAnalysisResults(results);
  };

  return (
    <PageContainer>
      <PageHeader
        icon={AlertTriangle}
        eyebrow="Patient Care"
        title="Patient Alerts"
        description="AI-powered proactive identification of critical events and potential deteriorations"
        favoritePage="PatientAlerts"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Main Alerts Dashboard */}
        <div className="lg:col-span-2">
          <PatientAlertsDashboard showAllPatients={true} />
        </div>

        {/* Sidebar - Analyzer & Quick Actions */}
        <div className="space-y-4 sm:space-y-6">
          {/* Patient Selector for Analysis */}
          <Card>
            <CardHeader className="py-3 border-b border-slate-100">
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="w-4 h-4 text-navy-600" />
                Analyze Patient
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              <Select value={selectedPatientId || "none"} onValueChange={(val) => setSelectedPatientId(val === "none" ? "" : val)}>
                <SelectTrigger className="h-11 touch-target">
                  <SelectValue placeholder="Select patient to analyze..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="py-3">Select a patient</SelectItem>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="py-3">
                      {p.first_name} {p.last_name} - {p.primary_diagnosis || 'No diagnosis'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedPatientId && (
                <div className="mt-4">
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
            <Card>
              <CardHeader className="py-3 border-b border-slate-100">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-600" />
                  Analysis Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-700">{analysisResults.analysis_summary}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600">Overall Risk:</span>
                  <Badge variant={
                    analysisResults.overall_risk_level === 'critical' ? 'destructive' :
                    analysisResults.overall_risk_level === 'high' ? 'warning' :
                    analysisResults.overall_risk_level === 'moderate' ? 'warning' :
                    'success'
                  } className="capitalize">
                    {analysisResults.overall_risk_level}
                  </Badge>
                </div>

                {analysisResults.positive_indicators?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-emerald-700 mb-1">Positive Indicators:</p>
                    <ul className="text-xs text-emerald-700 space-y-1">
                      {analysisResults.positive_indicators.map((indicator, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                          <span>{indicator}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {analysisResults.monitoring_recommendations?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-navy-700 mb-1">Monitor:</p>
                    <ul className="text-xs text-navy-700 space-y-1">
                      {analysisResults.monitoring_recommendations.slice(0, 3).map((rec, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-navy-400" aria-hidden="true" />
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Quick Tips */}
          <Card>
            <CardHeader className="py-3 border-b border-slate-100">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-600" />
                Alert Response Guide
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              <ul className="text-xs sm:text-sm text-slate-700 space-y-2">
                <li className="flex items-start gap-2">
                  <Badge variant="destructive" className="text-xs shrink-0 min-w-[60px] justify-center">Critical</Badge>
                  <span className="flex-1">Immediate action within 1 hour</span>
                </li>
                <li className="flex items-start gap-2">
                  <Badge variant="warning" className="text-xs shrink-0 min-w-[60px] justify-center">High</Badge>
                  <span className="flex-1">Address within 24 hours</span>
                </li>
                <li className="flex items-start gap-2">
                  <Badge variant="warning" className="text-xs shrink-0 min-w-[60px] justify-center">Medium</Badge>
                  <span className="flex-1">Address within 48-72 hours</span>
                </li>
                <li className="flex items-start gap-2">
                  <Badge variant="info" className="text-xs shrink-0 min-w-[60px] justify-center">Low</Badge>
                  <span className="flex-1">Monitor at next visit</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}