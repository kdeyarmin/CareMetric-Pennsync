import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, CheckCircle2, Clock, AlertCircle, Send, Loader2 } from "lucide-react";
import { format } from "date-fns";

const STATUS_CONFIG = {
  queued: { icon: Clock, label: "Queued", color: "bg-yellow-100 text-yellow-800" },
  sending: { icon: Loader2, label: "Sending", color: "bg-blue-100 text-blue-800" },
  sent: { icon: Send, label: "Sent", color: "bg-green-100 text-green-800" },
  delivered: { icon: CheckCircle2, label: "Delivered", color: "bg-emerald-100 text-emerald-800" },
  failed: { icon: AlertCircle, label: "Failed", color: "bg-red-100 text-red-800" },
};

export default function FaxHistoryList({ userEmail }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['faxHistory', userEmail],
    queryFn: () => base44.entities.FaxHistory.filter({ user_email: userEmail }, '-created_date', 20),
    enabled: !!userEmail,
    refetchInterval: 10000 // Refresh every 10 seconds to check status updates
  });

  return (
    <Card>
      <CardHeader className="pb-2 p-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="w-4 h-4" />
          Fax History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {isLoading ? (
          <div className="text-center py-4">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-xs text-center text-slate-400 py-4">No faxes sent yet</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {history.map(fax => {
              const config = STATUS_CONFIG[fax.status] || STATUS_CONFIG.queued;
              const Icon = config.icon;
              return (
                <div key={fax.id} className="flex items-start gap-2 p-2 rounded-lg border bg-white">
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${fax.status === 'sending' ? 'animate-spin text-blue-500' : fax.status === 'failed' ? 'text-red-500' : 'text-green-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 justify-between">
                      <p className="text-xs font-medium truncate">{fax.recipient_name || fax.recipient_fax_number}</p>
                      <Badge className={`text-[9px] px-1.5 py-0 ${config.color}`}>{config.label}</Badge>
                    </div>
                    {fax.subject && <p className="text-[10px] text-slate-600 truncate">{fax.subject}</p>}
                    <p className="text-[10px] text-slate-400">
                      {fax.recipient_fax_number} · {fax.created_date ? format(new Date(fax.created_date), 'MMM d, h:mm a') : ''}
                    </p>
                    {fax.error_message && (
                      <p className="text-[10px] text-red-600 mt-0.5">{fax.error_message}</p>
                    )}
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