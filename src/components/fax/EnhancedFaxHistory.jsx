import { useState } from "react";
import { openExternalUrl } from "@/components/utils/security";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileText, Search, Download, CheckCircle, XCircle, Clock, Send, AlertCircle, RefreshCw, Star } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { retryFailedFax } from "@/functions/retryFailedFax";

export default function EnhancedFaxHistory({ patientId }) {
  const [searchTerm, setSearchTerm] = useState("");
  const queryClient = useQueryClient();

  const { data: faxLogs = [], isLoading } = useQuery({
    queryKey: patientId ? ['fax-logs', patientId] : ['fax-logs'],
    queryFn: () => patientId 
      ? base44.entities.FaxLog.filter({ patient_id: patientId }, '-created_date', 100)
      : base44.entities.FaxLog.list('-created_date', 100),
    initialData: [],
    refetchInterval: 15000
  });

  const retryMutation = useMutation({
    mutationFn: (faxLogId) => retryFailedFax({ fax_log_id: faxLogId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fax-logs'] });
      toast.success("Fax retry initiated");
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const filteredLogs = faxLogs.filter(log =>
    log.to_number?.includes(searchTerm) ||
    log.to_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.document_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusIcon = (status) => {
    switch (status) {
      case 'delivered':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'sent':
        return <Send className="w-4 h-4 text-blue-600" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'sending':
        return <Clock className="w-4 h-4 text-yellow-600 animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-slate-600 animate-pulse" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'delivered':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'sent':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'sending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300 animate-pulse';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'urgent':
        return <Badge className="bg-red-600 text-white">Urgent</Badge>;
      case 'low':
        return <Badge variant="outline">Low Priority</Badge>;
      default:
        return null;
    }
  };

  if (isLoading) {
    return <div className="text-center py-8 text-slate-500">Loading fax history...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Fax History</h3>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search faxes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {filteredLogs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">No faxes sent yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredLogs.map((log) => (
            <Card key={log.id} className={`hover:shadow-md transition-all ${
              log.status === 'sending' || log.status === 'queued' ? 'border-l-4 border-l-yellow-500' : ''
            }`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <FileText className="w-4 h-4 text-slate-600" />
                      <span className="font-medium text-slate-900">
                        {log.document_name || 'Untitled Fax'}
                      </span>
                      {getStatusIcon(log.status)}
                      {getPriorityBadge(log.priority)}
                      {log.cover_page_details && (
                        <Badge variant="outline" className="text-navy-700 border-navy-300">
                          <Star className="w-3 h-3 mr-1" />
                          Cover Page
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1 text-sm text-slate-600">
                      <p>
                        <span className="font-medium">To:</span> {log.to_name || log.to_number}
                      </p>
                      <p>
                        <span className="font-medium">From:</span> {log.from_number}
                      </p>
                      {log.pages && (
                        <p>
                          <span className="font-medium">Pages:</span> {log.pages}
                        </p>
                      )}
                      {log.estimated_cost && (
                        <p>
                          <span className="font-medium">Est. Cost:</span> ${(log.estimated_cost / 100).toFixed(2)}
                        </p>
                      )}
                      <p className="text-xs text-slate-500">
                        Sent {format(new Date(log.created_date), 'MMM d, yyyy h:mm a')} by {log.sent_by}
                      </p>
                      {log.retry_count > 0 && (
                        <p className="text-xs text-orange-600">
                          Retry attempt #{log.retry_count}
                        </p>
                      )}
                    </div>
                    {log.failure_reason && (
                      <div className="mt-2 flex items-center gap-1 text-sm text-red-600 bg-red-50 p-2 rounded">
                        <AlertCircle className="w-3 h-3" />
                        {log.failure_reason}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge className={`border ${getStatusColor(log.status)}`}>
                      {log.status}
                    </Badge>
                    <div className="flex gap-2">
                      {log.document_url && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openExternalUrl(log.document_url)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      )}
                      {log.status === 'failed' && log.retry_count < 3 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => retryMutation.mutate(log.id)}
                          disabled={retryMutation.isPending}
                        >
                          <RefreshCw className={`w-4 h-4 ${retryMutation.isPending ? 'animate-spin' : ''}`} />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}