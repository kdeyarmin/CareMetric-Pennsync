import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Users
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

function RiskAlertWidget({ patientId, compact = false, showAllPatients = false }) {
  const queryClient = useQueryClient();

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: showAllPatients ? ['allPatientRiskAlerts'] : ['patientRiskAlerts', patientId],
    queryFn: async () => {
      if (showAllPatients) {
        // Fetch all active high-risk alerts across patients
        const allAlerts = await base44.entities.PatientAlert.filter(
          { status: 'active' },
          '-created_date',
          50
        );
        // Filter for high/critical severity
        return allAlerts.filter(a => 
          a.severity === 'high' || a.severity === 'critical'
        );
      } else {
        return patientId 
          ? await base44.entities.PatientAlert.filter({ patient_id: patientId, status: 'active' })
          : [];
      }
    },
    enabled: showAllPatients || !!patientId,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId) => {
      // base44.auth.me() is async — awaiting it here records the actual user
      // email. Previously the unresolved Promise was stored as acknowledged_by,
      // losing the audit trail of who acknowledged the alert.
      const user = await base44.auth.me();
      return base44.entities.PatientAlert.update(alertId, {
        status: 'acknowledged',
        acknowledged_by: user?.email,
        acknowledged_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: showAllPatients ? ['allPatientRiskAlerts'] : ['patientRiskAlerts', patientId] 
      });
    }
  });

  const resolveMutation = useMutation({
    mutationFn: (alertId) => base44.entities.PatientAlert.update(alertId, { status: 'resolved' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: showAllPatients ? ['allPatientRiskAlerts'] : ['patientRiskAlerts', patientId] 
      });
    }
  });

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[severity] || colors.medium;
  };

  if (isLoading) {
    return (
      <Card className={compact ? 'border-yellow-200' : ''}>
        <CardContent className="p-4 text-center text-sm text-slate-500">
          Loading alerts...
        </CardContent>
      </Card>
    );
  }

  if (!alerts || alerts.length === 0) {
    return compact ? null : (
      <Card className="border-green-200">
        <CardContent className="p-4 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
          <p className="text-sm text-green-700 font-medium">No active risk alerts</p>
          <p className="text-xs text-slate-500 mt-1">Patient risk profile is within normal range</p>
        </CardContent>
      </Card>
    );
  }

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const highAlerts = alerts.filter(a => a.severity === 'high');

  return (
    <Card className={`border-2 ${criticalAlerts.length > 0 ? 'border-red-300 bg-red-50' : 'border-orange-300 bg-orange-50'}`}>
      <CardHeader className="py-3 bg-gradient-to-r from-red-100 to-orange-100">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          {showAllPatients ? 'High-Risk Patient Alerts' : 'Active Risk Alerts'}
          <Badge className="bg-red-600 text-white ml-auto">
            {alerts.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-2">
        {compact && alerts.length > 3 ? (
          <>
            <Alert className="bg-white border-red-300">
              <AlertDescription className="text-sm">
                <strong>{alerts.length} active risk alerts</strong>
                <br />
                {criticalAlerts.length > 0 && (
                  <span className="text-red-600">• {criticalAlerts.length} critical</span>
                )}
                {highAlerts.length > 0 && (
                  <span className="text-orange-600 ml-2">• {highAlerts.length} high</span>
                )}
              </AlertDescription>
            </Alert>
            {patientId && (
              <Button size="sm" variant="outline" className="w-full" asChild>
                <Link to={createPageUrl(`PatientDetails?id=${patientId}`)}>
                  <Eye className="w-3 h-3 mr-2" /> View All Alerts
                </Link>
              </Button>
            )}
          </>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {alerts.map((alert) => (
              <Card key={alert.id} className={`border-l-4 ${getSeverityColor(alert.severity)}`}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                        <h5 className="text-sm font-bold">{alert.title}</h5>
                        <Badge className={getSeverityColor(alert.severity)}>
                          {alert.severity}
                        </Badge>
                      </div>
                      {showAllPatients && alert.patient_id && (
                        <Button size="sm" variant="link" className="h-auto p-0 text-xs mb-1" asChild>
                          <Link to={createPageUrl(`PatientDetails?id=${alert.patient_id}`)}>
                            <Users className="w-3 h-3 mr-1" /> View Patient
                          </Link>
                        </Button>
                      )}
                      <p className="text-xs text-slate-700">{alert.message}</p>
                      {alert.risk_score && (
                        <p className="text-xs text-slate-500 mt-1">
                          Risk Score: <strong>{alert.risk_score}/100</strong>
                        </p>
                      )}
                    </div>
                    {/* The top-right "X" used to call resolveMutation, so a
                        glance-and-dismiss click permanently resolved the alert for
                        EVERYONE. Removed — use the explicit Acknowledge / Resolve
                        actions below, which carry the right intent and audit. */}
                  </div>

                  {alert.recommended_actions?.length > 0 && (
                    <div className="bg-green-50 p-2 rounded border border-green-200">
                      <p className="text-xs font-semibold text-green-900 mb-1">Actions:</p>
                      <ul className="text-xs text-green-800 space-y-0.5">
                        {alert.recommended_actions.slice(0, 3).map((action, i) => (
                          <li key={i}>✓ {action}</li>
                        ))}
                        {alert.recommended_actions.length > 3 && (
                          <li className="text-slate-500">...and {alert.recommended_actions.length - 3} more</li>
                        )}
                      </ul>
                    </div>
                  )}

                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-7 text-xs"
                      onClick={() => acknowledgeMutation.mutate(alert.id)}
                    >
                      <Eye className="w-3 h-3 mr-1" /> Acknowledge
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700"
                      onClick={() => resolveMutation.mutate(alert.id)}
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Resolve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RiskAlertWidget;