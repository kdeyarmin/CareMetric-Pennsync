import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Clock, Send, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function FaxActivityFeed() {
  const { data: recentFaxes = [] } = useQuery({
    queryKey: ['fax-activity-feed'],
    queryFn: () => base44.entities.FaxLog.list('-created_date', 20),
    initialData: [],
    refetchInterval: 10000
  });

  const getActivityIcon = (status) => {
    switch (status) {
      case 'delivered':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'sending':
        return <Clock className="w-5 h-5 text-yellow-600 animate-spin" />;
      case 'sent':
        return <Send className="w-5 h-5 text-blue-600" />;
      default:
        return <Clock className="w-5 h-5 text-slate-600" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'delivered':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'sending':
        return 'bg-yellow-100 text-yellow-800';
      case 'sent':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Fax Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {recentFaxes.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">No recent activity</p>
          ) : (
            recentFaxes.map((fax) => (
              <div key={fax.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                <div className="flex-shrink-0 mt-1">
                  {getActivityIcon(fax.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-sm text-slate-900 truncate">
                      {fax.document_name || 'Untitled Fax'}
                    </p>
                    <Badge className={`${getStatusColor(fax.status)} text-xs`}>
                      {fax.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600">
                    To: {fax.to_name || fax.to_number}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDistanceToNow(new Date(fax.created_date), { addSuffix: true })}
                  </p>
                  {fax.failure_reason && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-red-600">
                      <AlertCircle className="w-3 h-3" />
                      {fax.failure_reason}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}