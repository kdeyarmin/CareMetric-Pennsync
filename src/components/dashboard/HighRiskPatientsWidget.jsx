import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingUp, ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function HighRiskPatientsWidget() {
  const { data: patients = [] } = useQuery({
    queryKey: ['patientsWithRiskScores'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' })
  });

  // Filter and sort by risk score
  const highRiskPatients = patients
    .filter(p => p.risk_assessment?.score && p.risk_assessment.score >= 50)
    .sort((a, b) => (b.risk_assessment?.score || 0) - (a.risk_assessment?.score || 0))
    .slice(0, 5);

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

  return (
    <Card className="border-l-4 border-l-red-500">
      <CardHeader className="bg-red-50 dark:bg-red-950">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          High-Risk Patients
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {highRiskPatients.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <TrendingUp className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-sm">No high-risk patients identified</p>
            <p className="text-xs text-gray-400 mt-1">Risk scores are calculated automatically</p>
          </div>
        ) : (
          <div className="space-y-3">
            {highRiskPatients.map((patient) => (
              <Link
                key={patient.id}
                to={`${createPageUrl("PatientDetails")}?id=${patient.id}`}
                className="block group"
              >
                <div className="p-3 rounded-lg border border-gray-200 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-950 transition-all">
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
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {patient.risk_assessment.score}
                      </span>
                      <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-red-600 group-hover:translate-x-1 transition-all" />
                    </div>
                  </div>
                  
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                    <div
                      className={`h-2 rounded-full ${getRiskBarColor(patient.risk_assessment.score)} transition-all`}
                      style={{ width: `${patient.risk_assessment.score}%` }}
                    />
                  </div>

                  {patient.risk_assessment.confidence && (
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Sparkles className="w-3 h-3" />
                      <span>{patient.risk_assessment.confidence}% confidence</span>
                    </div>
                  )}
                </div>
              </Link>
            ))}
            
            {patients.filter(p => p.risk_assessment?.score >= 50).length > 5 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = createPageUrl("Patients")}
                className="w-full"
              >
                View All High-Risk Patients
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}