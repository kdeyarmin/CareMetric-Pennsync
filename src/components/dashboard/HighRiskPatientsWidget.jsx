import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  TrendingUp,
  Activity,
  Pill,
  ChevronRight,
  Shield
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";

export default function HighRiskPatientsWidget() {
  const { data: highRiskAssessments = [] } = useQuery({
    queryKey: ['highRiskPatients'],
    queryFn: async () => {
      // Get all recent risk assessments
      const allAssessments = await base44.entities.PatientRiskAssessment.list('-assessment_date', 100);
      
      // Get unique patients (latest assessment per patient)
      const patientMap = new Map();
      allAssessments.forEach(assessment => {
        if (!patientMap.has(assessment.patient_id) || 
            new Date(assessment.assessment_date) > new Date(patientMap.get(assessment.patient_id).assessment_date)) {
          patientMap.set(assessment.patient_id, assessment);
        }
      });
      
      // Filter for high/critical risk patients
      return Array.from(patientMap.values())
        .filter(a => a.overall_risk_level === 'high' || a.overall_risk_level === 'critical')
        .sort((a, b) => b.overall_risk_score - a.overall_risk_score)
        .slice(0, 10);
    },
    initialData: [],
    refetchInterval: 300000, // Refresh every 5 minutes
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 500),
    initialData: []
  });

  const getPatientName = (patientId) => {
    const patient = patients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown';
  };

  const getRiskColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-600';
      case 'high': return 'bg-orange-600';
      default: return 'bg-yellow-600';
    }
  };

  const getRiskIcon = (assessment) => {
    // Return icon for highest individual risk
    const risks = [
      { score: assessment.fall_risk_score, icon: Activity },
      { score: assessment.readmission_risk_score, icon: TrendingUp },
      { score: assessment.medication_adherence_risk_score, icon: Pill },
      { score: assessment.clinical_deterioration_risk_score, icon: AlertTriangle }
    ];
    const highest = risks.reduce((max, r) => r.score > max.score ? r : max, risks[0]);
    return highest.icon;
  };

  if (highRiskAssessments.length === 0) {
    return null;
  }

  return (
    <Card className="border-2 border-red-400 bg-red-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          High-Risk Patients
          <Badge className="bg-red-600 ml-auto">{highRiskAssessments.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {highRiskAssessments.filter(a => a.flagged_for_review).length > 0 && (
          <Alert className="bg-red-100 border-red-300">
            <Shield className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900 text-sm">
              <strong>{highRiskAssessments.filter(a => a.flagged_for_review).length} patient{highRiskAssessments.filter(a => a.flagged_for_review).length > 1 ? 's' : ''}</strong> flagged for immediate review
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {highRiskAssessments.map((assessment) => {
            const RiskIcon = getRiskIcon(assessment);
            return (
              <div
                key={assessment.id}
                className="bg-white p-3 rounded-lg border border-red-200 hover:border-red-400 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <RiskIcon className="w-4 h-4 text-red-600 flex-shrink-0" />
                      <Link
                        to={createPageUrl(`PatientDetails?id=${assessment.patient_id}`)}
                        className="font-semibold text-slate-900 text-sm hover:text-blue-600 truncate"
                      >
                        {getPatientName(assessment.patient_id)}
                      </Link>
                      <Badge className={`${getRiskColor(assessment.overall_risk_level)} text-xs`}>
                        {assessment.overall_risk_score}
                      </Badge>
                    </div>
                    
                    {assessment.flagged_for_review && (
                      <Badge className="bg-red-600 text-white text-xs mb-2">
                        ⚠️ Immediate Review Required
                      </Badge>
                    )}
                    
                    <div className="flex flex-wrap gap-1 text-xs">
                      {assessment.fall_risk_level !== 'low' && (
                        <Badge variant="outline" className="text-xs">
                          Fall: {assessment.fall_risk_level}
                        </Badge>
                      )}
                      {assessment.readmission_risk_level !== 'low' && (
                        <Badge variant="outline" className="text-xs">
                          Readmit: {assessment.readmission_risk_level}
                        </Badge>
                      )}
                      {assessment.medication_adherence_risk_level !== 'low' && (
                        <Badge variant="outline" className="text-xs">
                          Med: {assessment.medication_adherence_risk_level}
                        </Badge>
                      )}
                    </div>
                    
                    {assessment.priority_actions?.[0] && (
                      <p className="text-xs text-slate-600 mt-1 line-clamp-1">
                        Priority: {assessment.priority_actions[0].action}
                      </p>
                    )}
                  </div>
                  <Link to={createPageUrl(`PatientDetails?id=${assessment.patient_id}`)}>
                    <Button size="sm" variant="ghost" className="flex-shrink-0">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        <Link to={createPageUrl("Patients")} className="block">
          <Button variant="outline" className="w-full">
            <Shield className="w-4 h-4 mr-2" />
            View All Risk Assessments
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}