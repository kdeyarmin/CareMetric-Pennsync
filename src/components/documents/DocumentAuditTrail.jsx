import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, Mail, FileArchive, AlertCircle } from "lucide-react";
import { format } from "date-fns";

const actionConfig = {
  sent: { icon: Mail, color: "bg-blue-100 text-blue-800", label: "Sent" },
  signed: { icon: CheckCircle2, color: "bg-green-100 text-green-800", label: "Signed" },
  viewed: { icon: Clock, color: "bg-slate-100 text-slate-800", label: "Viewed" },
  archived: { icon: FileArchive, color: "bg-navy-100 text-navy-800", label: "Archived" },
  declined: { icon: AlertCircle, color: "bg-red-100 text-red-800", label: "Declined" }
};

export default function DocumentAuditTrail({ auditTrail = [] }) {
  if (!auditTrail || auditTrail.length === 0) {
    return null;
  }

  return (
    <Card className="mt-6 border-slate-200">
      <CardHeader>
        <CardTitle className="text-sm">Audit Trail</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {auditTrail.map((entry, idx) => {
            const config = actionConfig[entry.action] || { 
              icon: Clock, 
              color: "bg-slate-100 text-slate-800", 
              label: entry.action 
            };
            const Icon = config.icon;
            
            return (
              <div key={idx} className="flex gap-3 pb-3 border-b border-slate-100 last:border-0 last:pb-0">
                <div className="flex-shrink-0 mt-1">
                  <div className={`p-1.5 rounded-full ${config.color}`}>
                    <Icon className="w-3 h-3" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs">
                      {config.label}
                    </Badge>
                    <span className="text-xs text-slate-600">
                      {format(new Date(entry.timestamp), 'MMM d, yyyy h:mm a')}
                    </span>
                  </div>
                  {entry.notes && (
                    <p className="text-xs text-slate-600">{entry.notes}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}