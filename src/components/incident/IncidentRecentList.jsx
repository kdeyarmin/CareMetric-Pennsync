import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock } from "lucide-react";

const severityClasses = {
  low: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

export default function IncidentRecentList({ incidents = [] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="w-4 h-4" />
          Recent incident reports
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {incidents.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">
            No incidents reported yet.
          </div>
        ) : (
          incidents.map((incident) => (
            <div key={incident.id} className="rounded-xl border p-3 bg-white">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="font-medium text-slate-900">{incident.incident_name || incident.incident_type}</p>
                  <p className="text-xs text-slate-500">{incident.patient_name || "Patient"} • {incident.incident_date}</p>
                </div>
                <Badge className={severityClasses[incident.severity] || severityClasses.medium}>
                  {incident.severity}
                </Badge>
              </div>
              {incident.alert_triggered && (
                <div className="flex items-center gap-2 text-xs text-red-700">
                  <AlertTriangle className="w-3 h-3" />
                  Immediate admin alert sent
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}