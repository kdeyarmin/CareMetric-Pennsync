import { base44 } from "@/api/base44Client";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  ChevronRight,
  Shield
} from "lucide-react";
import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";

/**
 * Dashboard high-risk strip. Driven by active high/critical PatientAlert rows
 * via getScopedPatientAlerts — PatientRiskAssessment was never written by
 * predictPatientRisks, and the old overall_* / assessment_date fields do not
 * exist on that entity, so the widget always rendered empty.
 */
export default function HighRiskPatientsWidget() {
  const { data: highRiskAlerts = [] } = useQuery({
    queryKey: ['highRiskPatients', 'scoped-alerts'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getScopedPatientAlerts', {
        limit: 500,
        status: 'active',
        severity: ['high', 'critical'],
      });
      const alerts = res?.data?.alerts || [];
      // One row per patient — keep the highest severity / newest.
      const byPatient = new Map();
      const severityRank = { critical: 2, high: 1 };
      for (const alert of alerts) {
        if (!alert?.patient_id) continue;
        const prev = byPatient.get(alert.patient_id);
        if (!prev) {
          byPatient.set(alert.patient_id, alert);
          continue;
        }
        const prevRank = severityRank[prev.severity] || 0;
        const nextRank = severityRank[alert.severity] || 0;
        if (nextRank > prevRank) {
          byPatient.set(alert.patient_id, alert);
        } else if (nextRank === prevRank) {
          const prevDate = new Date(prev.created_date || 0).getTime();
          const nextDate = new Date(alert.created_date || 0).getTime();
          if (nextDate > prevDate) byPatient.set(alert.patient_id, alert);
        }
      }
      return Array.from(byPatient.values())
        .sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0))
        .slice(0, 10);
    },
    initialData: [],
    refetchInterval: 300000,
  });

  const { data: patients = [] } = useScopedPatients({ sort: '-updated_date', limit: 500 });

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

  if (highRiskAlerts.length === 0) {
    return null;
  }

  const urgentCount = highRiskAlerts.filter((a) => a.flagged_urgent || a.severity === 'critical').length;

  return (
    <Card className="border-2 border-red-400 bg-red-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          High-Risk Patients
          <Badge className="bg-red-600 ml-auto">{highRiskAlerts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {urgentCount > 0 && (
          <Alert className="bg-red-100 border-red-300">
            <Shield className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900 text-sm">
              <strong>{urgentCount} patient{urgentCount > 1 ? 's' : ''}</strong> flagged for immediate review
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {highRiskAlerts.map((alert) => (
            <div
              key={alert.id}
              className="bg-white p-3 rounded-lg border border-red-200 hover:border-red-400 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                    <Link
                      to={createPageUrl(`PatientDetails?id=${alert.patient_id}`)}
                      className="font-semibold text-slate-900 text-sm hover:text-blue-600 truncate"
                    >
                      {getPatientName(alert.patient_id)}
                    </Link>
                    <Badge className={`${getRiskColor(alert.severity)} text-xs`}>
                      {alert.severity}
                    </Badge>
                  </div>

                  {(alert.flagged_urgent || alert.severity === 'critical') && (
                    <Badge className="bg-red-600 text-white text-xs mb-2">
                      Immediate Review Required
                    </Badge>
                  )}

                  {alert.title && (
                    <p className="text-xs text-slate-600 mt-1 line-clamp-1">
                      {alert.title}
                    </p>
                  )}
                  {alert.message && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                      {alert.message}
                    </p>
                  )}
                </div>
                <Link to={createPageUrl(`PatientDetails?id=${alert.patient_id}`)}>
                  <Button size="sm" variant="ghost" className="flex-shrink-0">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>

        <Link to={createPageUrl("PatientAlerts")} className="block">
          <Button variant="outline" className="w-full">
            <Shield className="w-4 h-4 mr-2" />
            View All Risk Alerts
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
