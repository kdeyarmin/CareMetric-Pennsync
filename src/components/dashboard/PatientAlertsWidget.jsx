import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, CheckCircle2, XCircle } from "lucide-react";
import { formatEastern } from "../utils/timezone";

export default function PatientAlertsWidget({ alerts, patientId, expanded = false }) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const isExpanded = expanded || showAll;

  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (alertId) => {
      const user = await base44.auth.me();
      return base44.entities.PatientAlert.update(alertId, {
        status: 'acknowledged',
        acknowledged_by: user.email,
        acknowledged_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientAlerts', patientId] });
    },
  });

  const dismissAlertMutation = useMutation({
    mutationFn: (alertId) => base44.entities.PatientAlert.update(alertId, { status: 'dismissed' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientAlerts', patientId] });
    },
  });

  const activeAlerts = alerts.filter(a => a.status === 'active' || a.status === 'acknowledged');
  const displayAlerts = isExpanded ? activeAlerts : activeAlerts.slice(0, 3);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 border-red-300 text-red-900';
      case 'high': return 'bg-orange-100 border-orange-300 text-orange-900';
      case 'medium': return 'bg-yellow-100 border-yellow-300 text-yellow-900';
      default: return 'bg-blue-100 border-blue-300 text-blue-900';
    }
  };

  const getSeverityBadge = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600';
      case 'high': return 'bg-orange-600';
      case 'medium': return 'bg-yellow-600';
      default: return 'bg-blue-600';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="w-5 h-5 text-orange-600" />
          Patient Alerts
          {activeAlerts.length > 0 && (
            <Badge className="bg-orange-600">{activeAlerts.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {displayAlerts.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
            <p className="text-slate-600 text-sm">No active alerts</p>
            <p className="text-slate-500 text-xs">Patient is stable</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayAlerts.map((alert) => (
              <div key={alert.id} className={`p-3 rounded-lg border ${getSeverityColor(alert.severity)}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`${getSeverityBadge(alert.severity)} text-white`}>
                        {alert.severity}
                      </Badge>
                      {alert.status === 'acknowledged' && (
                        <Badge variant="outline" className="text-xs">Acknowledged</Badge>
                      )}
                    </div>
                    <p className="font-semibold text-sm text-slate-900 mb-1">{alert.title}</p>
                    <p className="text-xs text-slate-700 mb-2">{alert.message}</p>
                    
                    {alert.recommended_actions?.length > 0 && (
                      <div className="bg-white p-2 rounded border mt-2">
                        <p className="text-xs font-semibold mb-1">Recommended Actions:</p>
                        <ul className="space-y-0.5">
                          {alert.recommended_actions.slice(0, 2).map((action, idx) => (
                            <li key={idx} className="text-xs text-slate-600">• {action}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2 mt-3">
                  {alert.status === 'active' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => acknowledgeAlertMutation.mutate(alert.id)}
                    >
                      Acknowledge
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-slate-600"
                    onClick={() => dismissAlertMutation.mutate(alert.id)}
                  >
                    <XCircle className="w-3 h-3 mr-1" />
                    Dismiss
                  </Button>
                  <span className="text-xs text-slate-500 ml-auto">
                    {formatEastern(alert.created_date, 'MMM d')}
                  </span>
                </div>
              </div>
            ))}
            
            {!isExpanded && activeAlerts.length > 3 && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAll(true)}>
                View All {activeAlerts.length} Alerts
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}