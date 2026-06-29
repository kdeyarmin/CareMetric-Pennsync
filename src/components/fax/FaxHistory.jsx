import { useState } from "react";
import { openExternalUrl } from "@/components/utils/security";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileText, Search, Download, CheckCircle, XCircle, Clock, Send, AlertCircle } from "lucide-react";
import { format } from "date-fns";

export default function FaxHistory({ patientId }) {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: faxLogs = [], isLoading } = useQuery({
    queryKey: patientId ? ['fax-logs', patientId] : ['fax-logs'],
    queryFn: () => patientId 
      ? base44.entities.FaxLog.filter({ patient_id: patientId }, '-created_date', 100)
      : base44.entities.FaxLog.list('-created_date', 100),
    initialData: [],
    refetchInterval: 30000 // Refresh every 30 seconds
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
        return <Clock className="w-4 h-4 text-yellow-600 animate-pulse" />;
      default:
        return <Clock className="w-4 h-4 text-slate-600" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'delivered':
        return 'bg-green-100 text-green-800';
      case 'sent':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'sending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-slate-100 text-slate-800';
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
            <Card key={log.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-slate-600" />
                      <span className="font-medium text-slate-900">
                        {log.document_name || 'Untitled Fax'}
                      </span>
                      {getStatusIcon(log.status)}
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
                      <p className="text-xs text-slate-500">
                        Sent {format(new Date(log.created_date), 'MMM d, yyyy h:mm a')} by {log.sent_by}
                      </p>
                    </div>
                    {log.failure_reason && (
                      <div className="mt-2 flex items-center gap-1 text-sm text-red-600">
                        <AlertCircle className="w-3 h-3" />
                        {log.failure_reason}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge className={getStatusColor(log.status)}>
                      {log.status}
                    </Badge>
                    {log.document_url && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openExternalUrl(log.document_url)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    )}
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