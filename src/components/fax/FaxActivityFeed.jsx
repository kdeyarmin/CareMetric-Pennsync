import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Send, CheckCircle2, AlertCircle, RefreshCw, Clock, Loader2 } from "lucide-react";

const STATUS_CONFIG = {
  queued: { icon: Clock, color: "text-yellow-600", bg: "bg-yellow-50", label: "Queued" },
  sending: { icon: Loader2, color: "text-blue-600", bg: "bg-blue-50", label: "Sending", spin: true },
  sent: { icon: Send, color: "text-blue-600", bg: "bg-blue-50", label: "Sent" },
  delivered: { icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50", label: "Delivered" },
  failed: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50", label: "Failed" },
  scheduled: { icon: Clock, color: "text-purple-600", bg: "bg-purple-50", label: "Scheduled" },
};

export default function FaxActivityFeed({ userEmail }) {
  const { data: faxes = [], isLoading } = useQuery({
    queryKey: ["faxActivityFeed", userEmail],
    queryFn: () => base44.entities.FaxHistory.filter({ user_email: userEmail }, "-created_date", 30),
    enabled: !!userEmail,
    refetchInterval: 10000,
  });

  return (
    <Card>
      <CardHeader className="pb-2 p-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-600" /> Activity Feed
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin" /></div>
        ) : faxes.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No fax activity yet</p>
        ) : (
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {faxes.map((fax) => {
              const config = STATUS_CONFIG[fax.status] || STATUS_CONFIG.queued;
              const Icon = config.icon;
              return (
                <div key={fax.id} className={`flex items-start gap-2 p-2 rounded-lg ${config.bg}`}>
                  <Icon className={`w-3.5 h-3.5 mt-0.5 ${config.color} flex-shrink-0 ${config.spin ? "animate-spin" : ""}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-medium text-slate-800 truncate">
                      {fax.recipient_name || fax.recipient_fax_number}
                    </p>
                    <p className="text-[9px] text-slate-500">
                      {fax.subject || `${fax.document_urls?.length || 0} document(s)`}
                    </p>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0">
                    <Badge className={`text-[8px] px-1 py-0 ${config.color} bg-transparent border-0`}>
                      {config.label}
                    </Badge>
                    <span className="text-[8px] text-slate-400">
                      {new Date(fax.created_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}