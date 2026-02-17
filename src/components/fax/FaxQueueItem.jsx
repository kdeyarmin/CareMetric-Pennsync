import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import {
  Clock, Loader2, Send, CheckCircle2, AlertCircle,
  RotateCcw, XCircle, ChevronDown, ChevronUp, FileText, Phone, User, Brain
} from "lucide-react";
import FaxContentAnalysis from "@/components/fax/FaxContentAnalysis";
import { format } from "date-fns";
import { toast } from "sonner";

const STATUS_CONFIG = {
  queued: { icon: Clock, label: "Queued", color: "bg-yellow-100 text-yellow-800", dot: "bg-yellow-500" },
  sending: { icon: Loader2, label: "Sending", color: "bg-blue-100 text-blue-800", dot: "bg-blue-500" },
  sent: { icon: Send, label: "Sent", color: "bg-green-100 text-green-800", dot: "bg-green-500" },
  delivered: { icon: CheckCircle2, label: "Delivered", color: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  failed: { icon: AlertCircle, label: "Failed", color: "bg-red-100 text-red-800", dot: "bg-red-500" },
  scheduled: { icon: Clock, label: "Scheduled", color: "bg-purple-100 text-purple-800", dot: "bg-purple-500" },
};

const PRIORITY_CONFIG = {
  urgent: { label: "Urgent", color: "bg-red-100 text-red-700" },
  high: { label: "High", color: "bg-orange-100 text-orange-700" },
  normal: { label: "Normal", color: "bg-slate-100 text-slate-600" },
  low: { label: "Low", color: "bg-slate-50 text-slate-400" },
};

export default function FaxQueueItem({ fax, userSendingFaxNumber }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('retryFailedFax', {
        fax_log_id: fax.id
      });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['faxQueue'] });
      queryClient.invalidateQueries({ queryKey: ['faxHistory'] });
      if (data?.success) {
        toast.success(`Fax retry ${data.retry_count} sent successfully`);
      } else {
        toast.error(data?.error || "Retry failed");
      }
    },
    onError: (err) => {
      toast.error("Retry failed: " + err.message);
      queryClient.invalidateQueries({ queryKey: ['faxQueue'] });
    }
  });

  const cancelMutation = useMutation({
    mutationFn: () => base44.entities.FaxHistory.delete(fax.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxQueue'] });
      queryClient.invalidateQueries({ queryKey: ['faxHistory'] });
      setShowCancelConfirm(false);
      toast.success("Fax cancelled and removed");
    }
  });

  const config = STATUS_CONFIG[fax.status] || STATUS_CONFIG.queued;
  const Icon = config.icon;
  const maxRetries = fax.max_retries || 3;
  const retryCount = fax.retry_count || 0;
  const canRetry = (fax.status === 'failed' || fax.status === 'queued') && retryCount < maxRetries;
  const canCancel = fax.status === 'queued' || fax.status === 'failed' || fax.status === 'scheduled';
  const priorityConf = PRIORITY_CONFIG[fax.priority] || PRIORITY_CONFIG.normal;

  const statusTimeline = [
    { label: "Created", time: fax.created_date, active: true },
    { label: "Sending", time: fax.status === 'sending' || fax.status === 'sent' || fax.status === 'delivered' ? fax.sent_at || fax.updated_date : null, active: ['sending', 'sent', 'delivered'].includes(fax.status) },
    { label: fax.status === 'failed' ? "Failed" : "Delivered", time: fax.status === 'delivered' || fax.status === 'failed' ? fax.updated_date : null, active: ['delivered', 'failed'].includes(fax.status), failed: fax.status === 'failed' },
  ];

  return (
    <>
      <Card className={`transition-all ${fax.status === 'failed' ? 'border-red-200' : fax.status === 'queued' ? 'border-yellow-200' : ''}`}>
        <CardContent className="p-3 sm:p-4">
          {/* Main row */}
          <div className="flex items-start gap-3">
            <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${config.dot} ${fax.status === 'sending' ? 'animate-pulse' : ''}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {fax.recipient_name || fax.recipient_fax_number}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <span className="text-xs text-slate-500">{fax.recipient_fax_number}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {fax.priority && fax.priority !== 'normal' && (
                    <Badge className={`text-[10px] ${priorityConf.color}`}>
                      {priorityConf.label}
                    </Badge>
                  )}
                  <Badge className={`text-[10px] ${config.color}`}>
                    <Icon className={`w-3 h-3 mr-1 ${fax.status === 'sending' ? 'animate-spin' : ''}`} />
                    {config.label}
                  </Badge>
                  {retryCount > 0 && (
                    <Badge className="text-[10px] bg-slate-100 text-slate-600">
                      Retry {retryCount}/{maxRetries}
                    </Badge>
                  )}
                </div>
              </div>

              {fax.subject && (
                <p className="text-xs text-slate-600 mt-1 truncate">RE: {fax.subject}</p>
              )}

              <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-400">
                <span>{fax.created_date ? format(new Date(fax.created_date), 'MMM d, yyyy h:mm a') : ''}</span>
                {fax.page_count > 0 && (
                  <span className="flex items-center gap-0.5">
                    <FileText className="w-3 h-3" /> {fax.page_count} page{fax.page_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {fax.scheduled_send_at && fax.status === 'scheduled' && (
                <div className="bg-purple-50 border border-purple-100 rounded-md p-2 mt-2 flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-purple-500" />
                  <p className="text-xs text-purple-700">Scheduled for {format(new Date(fax.scheduled_send_at), 'MMM d, yyyy h:mm a')}</p>
                </div>
              )}

              {fax.batch_id && (
                <p className="text-[10px] text-slate-400 mt-1">Batch: {fax.batch_id}</p>
              )}

              {fax.error_message && (
                <div className="bg-red-50 border border-red-100 rounded-md p-2 mt-2">
                  <p className="text-xs text-red-700">{fax.error_message}</p>
                  {retryCount >= maxRetries && (
                    <p className="text-[10px] text-red-500 mt-1 font-medium">All retries exhausted</p>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2 mt-3">
                {canRetry && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => retryMutation.mutate()}
                    disabled={retryMutation.isPending}
                  >
                    {retryMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    Retry
                  </Button>
                )}
                {canCancel && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => setShowCancelConfirm(true)}
                  >
                    <XCircle className="w-3 h-3" />
                    Cancel
                  </Button>
                )}
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="ml-auto flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {expanded ? 'Hide' : 'Details'}
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              {/* Expanded details */}
              {expanded && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                  {/* Status Timeline */}
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500 uppercase mb-2">Status History</p>
                    <div className="flex items-center gap-0">
                      {statusTimeline.map((step, i) => (
                        <div key={i} className="flex items-center">
                          <div className="flex flex-col items-center">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                              step.failed ? 'bg-red-100' : step.active ? 'bg-blue-100' : 'bg-slate-100'
                            }`}>
                              <div className={`w-2 h-2 rounded-full ${
                                step.failed ? 'bg-red-500' : step.active ? 'bg-blue-500' : 'bg-slate-300'
                              }`} />
                            </div>
                            <span className={`text-[9px] mt-1 ${step.active ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                              {step.label}
                            </span>
                            {step.time && (
                              <span className="text-[8px] text-slate-400">
                                {format(new Date(step.time), 'h:mm a')}
                              </span>
                            )}
                          </div>
                          {i < statusTimeline.length - 1 && (
                            <div className={`w-8 sm:w-12 h-0.5 mb-5 ${step.active ? 'bg-blue-300' : 'bg-slate-200'}`} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Documents */}
                  {fax.document_urls?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Documents</p>
                      <div className="space-y-1">
                        {fax.document_urls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline">
                            <FileText className="w-3 h-3" />
                            Document {i + 1}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {fax.telnyx_fax_id && (
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Tracking ID</p>
                      <p className="text-xs text-slate-600 font-mono">{fax.telnyx_fax_id}</p>
                    </div>
                  )}

                  {/* AI Content Analysis for completed faxes */}
                  {(fax.status === 'sent' || fax.status === 'delivered') && (
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">AI Analysis</p>
                      <FaxContentAnalysis faxId={fax.id} existingAnalysis={fax.ai_analysis} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cancel Confirmation */}
      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel Fax</DialogTitle>
            <DialogDescription>
              This will permanently remove this fax from the queue. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            <p className="font-medium">{fax.recipient_name || 'Unknown'}</p>
            <p className="text-xs text-slate-500">{fax.recipient_fax_number}</p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowCancelConfirm(false)}>Keep</Button>
            <Button variant="destructive" size="sm" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Fax"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { STATUS_CONFIG };