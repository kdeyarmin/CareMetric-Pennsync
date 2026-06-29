import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  AlertTriangle,
  Activity,
  Clock
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function RecentActivityFeed({ visits, alerts, patients }) {
  // Combine and sort activities
  const activities = [
    ...visits.map(v => ({
      type: 'visit',
      date: v.created_date,
      data: v
    })),
    ...alerts.map(a => ({
      type: 'alert',
      date: a.created_date,
      data: a
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const getPatientName = (patientId) => {
    const patient = patients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient';
  };

  const getActivityIcon = (type) => {
    switch (type) {
      case 'visit':
        return <Calendar className="w-4 h-4 text-blue-500" />;
      case 'alert':
        return <AlertTriangle className="w-4 h-4 text-orange-500" />;
      default:
        return <Activity className="w-4 h-4 text-slate-500" />;
    }
  };

  const getActivityColor = (type, data) => {
    if (type === 'alert') {
      switch (data.severity) {
        case 'critical': return 'bg-red-50 border-red-200';
        case 'high': return 'bg-orange-50 border-orange-200';
        default: return 'bg-yellow-50 border-yellow-200';
      }
    }
    return 'bg-blue-50 border-blue-200';
  };

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <Activity className="w-12 h-12 text-slate-300 mx-auto mb-2" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-3">
        {activities.map((activity, idx) => (
          <div
            key={`${activity.type}-${activity.data?.id ?? idx}`}
            className={`p-3 rounded-lg border ${getActivityColor(activity.type, activity.data)}`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {getActivityIcon(activity.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-medium text-sm text-slate-900">
                    {activity.type === 'visit' ? 'Visit Scheduled' : 'Alert Triggered'}
                  </p>
                  <Badge variant="outline" className="text-xs whitespace-nowrap">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatDistanceToNow(new Date(activity.date), { addSuffix: true })}
                  </Badge>
                </div>
                
                <p className="text-sm text-slate-700 mb-1">
                  {getPatientName(activity.data.patient_id)}
                </p>

                {activity.type === 'visit' && (
                  <p className="text-xs text-slate-600">
                    {activity.data.visit_type?.replace('_', ' ')} - {
                      activity.data.visit_date ? new Date(activity.data.visit_date).toLocaleDateString() : 'Date not set'
                    }
                  </p>
                )}

                {activity.type === 'alert' && (
                  <>
                    <p className="text-xs text-slate-600 mb-1">{activity.data.title}</p>
                    <Badge 
                      className={
                        activity.data.severity === 'critical' ? 'bg-red-100 text-red-800' :
                        activity.data.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                        'bg-yellow-100 text-yellow-800'
                      }
                    >
                      {activity.data.severity}
                    </Badge>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}