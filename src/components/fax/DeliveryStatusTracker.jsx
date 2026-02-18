import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Clock, AlertCircle, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function DeliveryStatusTracker({ faxId, userEmail }) {
  const [showDetails, setShowDetails] = useState(false);

  const { data: fax, refetch } = useQuery({
    queryKey: ['faxStatus', faxId],
    queryFn: () => base44.entities.FaxHistory.filter({ id: faxId }).then(r => r[0]),
    enabled: !!faxId,
    refetchInterval: (data) => {
      if (!data) return false;
      if (data.status === 'queued' || data.status === 'sending') return 3000;
      return false;
    }
  });

  useEffect(() => {
    if (!fax) return;

    // Show toast notifications on status changes
    if (fax.status === 'sent') {
      toast.success(`Fax sent to ${fax.recipient_name || fax.recipient_fax_number}`, {
        description: "The fax has been successfully transmitted"
      });
    } else if (fax.status === 'delivered') {
      toast.success(`Fax delivered to ${fax.recipient_name || fax.recipient_fax_number}`, {
        description: "Delivery confirmed by recipient"
      });
    } else if (fax.status === 'failed') {
      toast.error(`Fax failed to ${fax.recipient_name || fax.recipient_fax_number}`, {
        description: fax.error_message || "Failed to deliver fax",
        action: {
          label: "Retry",
          onClick: () => {
            // Trigger retry
            base44.functions.invoke('retryFailedFax', { fax_id: fax.id })
              .then(() => {
                toast.success("Retrying fax...");
                refetch();
              })
              .catch(() => toast.error("Failed to retry"));
          }
        }
      });
    }
  }, [fax?.status]);

  if (!fax) return null;

  const getStatusConfig = () => {
    switch (fax.status) {
      case 'queued':
        return {
          icon: Clock,
          color: "bg-slate-100 text-slate-700",
          label: "Queued",
          progress: 25
        };
      case 'sending':
        return {
          icon: Loader2,
          color: "bg-blue-100 text-blue-700",
          label: "Sending",
          progress: 50,
          spin: true
        };
      case 'sent':
        return {
          icon: Send,
          color: "bg-green-100 text-green-700",
          label: "Sent",
          progress: 75
        };
      case 'delivered':
        return {
          icon: CheckCircle2,
          color: "bg-green-100 text-green-700",
          label: "Delivered",
          progress: 100
        };
      case 'failed':
        return {
          icon: AlertCircle,
          color: "bg-red-100 text-red-700",
          label: "Failed",
          progress: 0
        };
      case 'scheduled':
        return {
          icon: Clock,
          color: "bg-purple-100 text-purple-700",
          label: "Scheduled",
          progress: 10
        };
      default:
        return {
          icon: Clock,
          color: "bg-slate-100 text-slate-700",
          label: fax.status,
          progress: 0
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <Card className="border-blue-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Icon className={`w-4 h-4 ${config.spin ? 'animate-spin' : ''}`} />
            Delivery Status
          </span>
          <Badge className={config.color}>{config.label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex justify-between text-xs text-slate-600 mb-1">
            <span>To: {fax.recipient_name || fax.recipient_fax_number}</span>
            <span>{config.progress}%</span>
          </div>
          <Progress value={config.progress} className="h-2" />
        </div>

        {fax.status === 'scheduled' && fax.scheduled_send_at && (
          <div className="text-xs text-slate-600">
            Scheduled for: {format(new Date(fax.scheduled_send_at), 'MMM d, yyyy h:mm a')}
          </div>
        )}

        {fax.sent_at && (
          <div className="text-xs text-slate-600">
            Sent at: {format(new Date(fax.sent_at), 'MMM d, yyyy h:mm a')}
          </div>
        )}

        {fax.error_message && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
            Error: {fax.error_message}
          </div>
        )}

        {fax.retry_count > 0 && (
          <div className="text-xs text-slate-600">
            Retry attempts: {fax.retry_count} / {fax.max_retries}
          </div>
        )}

        <div className="flex gap-2">
          <Button 
            size="sm" 
            variant="outline" 
            className="flex-1 text-xs"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? 'Hide' : 'Show'} Details
          </Button>
          {fax.status === 'failed' && (
            <Button 
              size="sm" 
              className="flex-1 text-xs gap-1"
              onClick={async () => {
                try {
                  await base44.functions.invoke('retryFailedFax', { fax_id: fax.id });
                  toast.success("Retrying fax...");
                  refetch();
                } catch (error) {
                  toast.error("Failed to retry");
                }
              }}
            >
              <Send className="w-3 h-3" /> Retry
            </Button>
          )}
        </div>

        {showDetails && (
          <div className="border-t pt-3 space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-500">Subject:</span>
                <p className="font-medium truncate">{fax.subject || 'N/A'}</p>
              </div>
              <div>
                <span className="text-slate-500">Pages:</span>
                <p className="font-medium">{fax.page_count || 0}</p>
              </div>
              <div>
                <span className="text-slate-500">Priority:</span>
                <Badge className="text-[10px]">{fax.priority || 'normal'}</Badge>
              </div>
              {fax.telnyx_fax_id && (
                <div>
                  <span className="text-slate-500">Tracking ID:</span>
                  <p className="font-mono text-[10px] truncate">{fax.telnyx_fax_id}</p>
                </div>
              )}
            </div>
            {fax.batch_id && (
              <div className="bg-blue-50 p-2 rounded">
                <span className="text-slate-500">Batch ID:</span>
                <p className="font-mono text-[10px]">{fax.batch_id}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}