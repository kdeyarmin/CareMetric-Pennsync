import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, TrendingUp, ArrowRight, Activity, Brain, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function HighRiskPatientsList({ limit = 10, showAnalyzeButton = false }) {
  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['patientsWithRiskScores'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' })
  });

  // Filter and sort by risk score
  const highRiskPatients = patients
    .filter(p => p.risk_assessment?.score && p.risk_assessment.score >= 40)
    .sort((a, b) => (b.risk_assessment?.score || 0) - (a.risk_assessment?.score || 0))
    .slice(0, limit);

  const getRiskBadgeColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'moderate': return 'bg-yellow-500 text-white';
      default: return 'bg-blue-500 text-white';
    }
  };

  const getRiskBarColor = (score) => {
    if (score >= 76) return 'bg-red-500';
    if (score >= 51) return 'bg-orange-500';
    if (score >= 26) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (isLoading) {
    return (
      <Card className="border-l-4 border-l-red-500">
        <CardContent className="p-8 text-center">
          <p className="text-gray-500">Loading risk data...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-l-4 border-l-red-500">
      <CardHeader className="bg-red-50 dark:bg-red-950">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          High-Risk Patients ({highRiskPatients.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {highRiskPatients.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <TrendingUp className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-sm">No high-risk patients identified</p>
            <p className="text-xs text-gray-400 mt-1">
              AI risk scores are calculated based on patient history and visit notes
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {highRiskPatients.map((patient) => (
              <div
                key={patient.id}
                className="p-3 rounded-lg border border-gray-200 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-950 transition-all"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">
                        {patient.first_name} {patient.last_name}
                      </h4>
                      <Badge className={getRiskBadgeColor(patient.risk_assessment.level)}>
                        {patient.risk_assessment.level}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                      {patient.primary_diagnosis || 'No diagnosis'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xl font-bold text-gray-900 dark:text-gray-100">
                      {patient.risk_assessment.score}
                    </span>
                    <span className="text-xs text-gray-500">risk score</span>
                  </div>
                </div>
                
                <Progress 
                  value={patient.risk_assessment.score} 
                  className={`h-2 mb-2 ${getRiskBarColor(patient.risk_assessment.score)}`}
                />

                {/* Risk Category Breakdown */}
                {patient.risk_assessment.category_scores && (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {patient.risk_assessment.category_scores.readmission_risk && (
                      <div className="bg-white dark:bg-slate-800 p-2 rounded text-center">
                        <p className="text-xs text-gray-500">Readmit</p>
                        <p className="font-bold text-sm text-red-600">
                          {patient.risk_assessment.category_scores.readmission_risk}
                        </p>
                      </div>
                    )}
                    {patient.risk_assessment.category_scores.safety_risk && (
                      <div className="bg-white dark:bg-slate-800 p-2 rounded text-center">
                        <p className="text-xs text-gray-500">Falls</p>
                        <p className="font-bold text-sm text-orange-600">
                          {patient.risk_assessment.category_scores.safety_risk}
                        </p>
                      </div>
                    )}
                    {patient.risk_assessment.category_scores.clinical_stability && (
                      <div className="bg-white dark:bg-slate-800 p-2 rounded text-center">
                        <p className="text-xs text-gray-500">Clinical</p>
                        <p className="font-bold text-sm text-yellow-600">
                          {patient.risk_assessment.category_scores.clinical_stability}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Link
                    to={`${createPageUrl("PatientDetails")}?id=${patient.id}`}
                    className="flex-1"
                  >
                    <Button size="sm" variant="outline" className="w-full">
                      <Eye className="w-3 h-3 mr-1" />
                      View Patient
                    </Button>
                  </Link>
                  {showAnalyzeButton && (
                    <Button 
                      size="sm" 
                      className="bg-red-600 hover:bg-red-700"
                      onClick={() => {
                        window.location.href = `${createPageUrl("PatientDetails")}?id=${patient.id}`;
                      }}
                    >
                      <Brain className="w-3 h-3 mr-1" />
                      Analyze
                    </Button>
                  )}
                </div>

                {patient.risk_assessment.confidence && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 mt-2">
                    <Activity className="w-3 h-3" />
                    <span>AI Confidence: {patient.risk_assessment.confidence}%</span>
                  </div>
                )}
              </div>
            ))}
            
            {patients.filter(p => p.risk_assessment?.score >= 40).length > limit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = createPageUrl("Patients")}
                className="w-full"
              >
                View All {patients.filter(p => p.risk_assessment?.score >= 40).length} High-Risk Patients
                <ArrowRight className="w-3 h-3 ml-2" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}