import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Calendar, FileText, AlertCircle, Activity, 
  Stethoscope, ClipboardList, TrendingUp 
} from "lucide-react";
import { format, parseISO } from "date-fns";

export default function PatientEventsTimeline({ visits, incidents, carePlans, patient }) {
  const events = [];

  // Add admission event
  if (patient.admission_date) {
    events.push({
      date: patient.admission_date,
      type: 'admission',
      title: 'Patient Admitted',
      description: `Admitted from ${patient.admission_source || 'unknown'}`,
      icon: Activity
    });
  }

  // Add visits
  visits.forEach(visit => {
    if (visit.status === 'completed' && visit.visit_date) {
      events.push({
        date: visit.visit_date,
        type: 'visit',
        title: visit.visit_type.replace(/_/g, ' '),
        description: visit.nurse_notes?.substring(0, 100) || 'Visit completed',
        icon: Stethoscope
      });
    }
  });

  // Add incidents
  incidents.forEach(incident => {
    if (incident.incident_date) {
      events.push({
        date: incident.incident_date,
        type: 'incident',
        title: `Incident: ${incident.incident_type.replace(/_/g, ' ')}`,
        description: incident.details?.description || incident.report?.substring(0, 100),
        icon: AlertCircle,
        severity: incident.severity
      });
    }
  });

  // Add care plans
  carePlans.forEach(plan => {
    if (plan.created_date) {
      events.push({
        date: plan.created_date.split('T')[0],
        type: 'care_plan',
        title: 'Care Plan Created',
        description: plan.problem,
        icon: ClipboardList,
        status: plan.status
      });
    }
  });

  // Sort by date, newest first
  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  const getEventColor = (event) => {
    if (event.type === 'incident') {
      return event.severity === 'high' ? 'bg-red-100 border-red-300' : 'bg-orange-100 border-orange-300';
    }
    if (event.type === 'visit') return 'bg-blue-100 border-blue-300';
    if (event.type === 'care_plan') return 'bg-purple-100 border-purple-300';
    if (event.type === 'admission') return 'bg-green-100 border-green-300';
    return 'bg-gray-100 border-gray-300';
  };

  const getIconColor = (event) => {
    if (event.type === 'incident') return 'text-red-600';
    if (event.type === 'visit') return 'text-blue-600';
    if (event.type === 'care_plan') return 'text-purple-600';
    if (event.type === 'admission') return 'text-green-600';
    return 'text-gray-600';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-indigo-600" />
          Patient Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 relative">
          {/* Timeline line */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" />

          {events.slice(0, 20).map((event, idx) => {
            const Icon = event.icon;
            return (
              <div key={idx} className="relative flex gap-4">
                {/* Icon */}
                <div className={`relative z-10 w-12 h-12 rounded-full border-2 bg-white flex items-center justify-center flex-shrink-0 ${getEventColor(event)}`}>
                  <Icon className={`w-5 h-5 ${getIconColor(event)}`} />
                </div>

                {/* Content */}
                <div className="flex-1 pb-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <h4 className="font-semibold text-gray-900 capitalize">{event.title}</h4>
                      <p className="text-sm text-gray-500">
                        {format(parseISO(event.date), 'MMM d, yyyy')}
                      </p>
                    </div>
                    {event.severity && (
                      <Badge className={event.severity === 'high' ? 'bg-red-600 text-white' : 'bg-orange-500 text-white'}>
                        {event.severity}
                      </Badge>
                    )}
                    {event.status && (
                      <Badge variant="outline">{event.status}</Badge>
                    )}
                  </div>
                  {event.description && (
                    <p className="text-sm text-gray-600">{event.description}</p>
                  )}
                </div>
              </div>
            );
          })}

          {events.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Calendar className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p>No events recorded yet</p>
            </div>
          )}

          {events.length > 20 && (
            <p className="text-sm text-gray-500 text-center pt-4">
              Showing 20 most recent events
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}