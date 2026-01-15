import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function PatientRiskWidget({ compact = false }) {
  const { data: highRiskPatients = [] } = useQuery({
    queryKey: ['highRiskPatients'],
    queryFn: async () => {
      const risks = await base44.entities.PatientRiskAssessment.filter({ 
        status: 'active',
        risk_level: { "$in": ['critical', 'high'] }
      }, '-risk_score', 5);
      
      const patientIds = [...new Set(risks.map(r => r.patient_id))];
      const patients = await Promise.all(
        patientIds.map(id => base44.entities.Patient.get(id).catch(() => null))
      );
      
      return risks.map(risk => {
        const patient = patients.find(p => p?.id === risk.patient_id);
        return {
          ...risk,
          patient_name: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown'
        };
      });
    },
  });

  if (highRiskPatients.length === 0) return null;

  const getRiskColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'moderate': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  return (
    <Card className="border-l-4 border-l-red-500">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          High-Risk Patients
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {highRiskPatients.map(risk => (
            <Link 
              key={risk.id}
              to={createPageUrl('PatientDetails') + `?id=${risk.patient_id}`}
            >
              <div className="p-3 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900 transition-colors cursor-pointer">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={getRiskColor(risk.risk_level)}>
                        {risk.risk_level}
                      </Badge>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {risk.patient_name}
                      </p>
                    </div>
                    <p className="text-xs text-gray-700 dark:text-gray-300 mb-1">
                      <strong>Risk:</strong> {risk.risk_type.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Score: {risk.risk_score}/100 • {risk.timeframe || 'Next 7 days'}
                    </p>
                    {risk.intervention_suggestions?.length > 0 && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                        {risk.intervention_suggestions.length} interventions suggested
                      </p>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 text-red-600 flex-shrink-0 mt-1" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}