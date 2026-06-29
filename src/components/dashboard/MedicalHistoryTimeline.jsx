import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Clock, 
  Stethoscope, 
  AlertTriangle, 
  Calendar,
  FileText,
  Activity,
  ClipboardList
} from "lucide-react";
import { formatEastern } from "../utils/timezone";

export default function MedicalHistoryTimeline({ patient, visits, incidents, carePlans, oasisData }) {
  // Combine all events into timeline
  const timelineEvents = [];

  // Add visits
  visits.forEach(v => {
    timelineEvents.push({
      date: v.visit_date,
      type: 'visit',
      title: v.visit_type?.replace(/_/g, ' '),
      icon: FileText,
      color: 'blue',
      details: {
        status: v.status,
        notes: v.nurse_notes?.substring(0, 150),
        vitals: v.vital_signs
      }
    });
  });

  // Add incidents
  incidents.forEach(i => {
    timelineEvents.push({
      date: i.incident_date,
      type: 'incident',
      title: i.incident_type?.replace(/_/g, ' '),
      icon: AlertTriangle,
      color: 'red',
      details: {
        severity: i.severity,
        report: i.report?.substring(0, 150)
      }
    });
  });

  // Add care plan changes
  carePlans.forEach(cp => {
    timelineEvents.push({
      date: cp.created_date,
      type: 'careplan',
      title: 'Care Plan Added',
      icon: ClipboardList,
      color: 'purple',
      details: {
        problem: cp.problem,
        goal: cp.goal,
        status: cp.status
      }
    });
  });

  // Add OASIS assessments
  oasisData.forEach(o => {
    timelineEvents.push({
      date: o.created_date,
      type: 'oasis',
      title: 'OASIS Assessment',
      icon: Stethoscope,
      color: 'green',
      details: {
        clinicalGroup: o.pdgm_data?.clinical_grouping,
        functionalLevel: o.pdgm_data?.functional_impairment_level
      }
    });
  });

  // Add admission/discharge
  if (patient?.admission_date) {
    timelineEvents.push({
      date: patient.admission_date,
      type: 'admission',
      title: 'Admitted to Care',
      icon: Activity,
      color: 'indigo',
      details: {
        source: patient.admission_source,
        careType: patient.care_type
      }
    });
  }

  if (patient?.discharge_date) {
    timelineEvents.push({
      date: patient.discharge_date,
      type: 'discharge',
      title: 'Discharged',
      icon: Calendar,
      color: 'gray',
      details: {
        disposition: patient.discharge_disposition
      }
    });
  }

  // Sort by date descending
  timelineEvents.sort((a, b) => new Date(b.date) - new Date(a.date));

  const getColorClasses = (color) => {
    const colors = {
      blue: 'bg-blue-500 border-blue-200',
      red: 'bg-red-500 border-red-200',
      purple: 'bg-navy-500 border-navy-200',
      green: 'bg-green-500 border-green-200',
      indigo: 'bg-indigo-500 border-indigo-200',
      gray: 'bg-slate-500 border-slate-200',
      orange: 'bg-orange-500 border-orange-200'
    };
    return colors[color] || colors.blue;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-600" />
          Medical History Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {timelineEvents.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">No history available</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-slate-200" />
            
            <div className="space-y-6">
              {timelineEvents.map((event, idx) => (
                <div key={idx} className="relative pl-12">
                  {/* Timeline dot */}
                  <div className={`absolute left-0 w-10 h-10 rounded-full ${getColorClasses(event.color)} flex items-center justify-center shadow-lg`}>
                    <event.icon className="w-5 h-5 text-white" />
                  </div>
                  
                  {/* Content */}
                  <div className="bg-white rounded-lg border p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-slate-900">{event.title}</p>
                        <p className="text-sm text-slate-600">{formatEastern(event.date, 'MMM d, yyyy')}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {event.type}
                      </Badge>
                    </div>

                    {/* Event-specific details */}
                    {event.type === 'visit' && event.details?.vitals && (
                      <div className="bg-blue-50 p-2 rounded mt-2">
                        <p className="text-xs font-semibold text-blue-900 mb-1">Vitals:</p>
                        <div className="flex flex-wrap gap-2 text-xs text-blue-800">
                          {event.details.vitals.blood_pressure_systolic && (
                            <span>BP: {event.details.vitals.blood_pressure_systolic}/{event.details.vitals.blood_pressure_diastolic}</span>
                          )}
                          {event.details.vitals.heart_rate && (
                            <span>HR: {event.details.vitals.heart_rate}</span>
                          )}
                          {event.details.vitals.oxygen_saturation && (
                            <span>O2: {event.details.vitals.oxygen_saturation}%</span>
                          )}
                        </div>
                      </div>
                    )}

                    {event.details?.notes && (
                      <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                        {event.details.notes}...
                      </p>
                    )}

                    {event.details?.report && (
                      <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                        {event.details.report}...
                      </p>
                    )}

                    {event.details?.problem && (
                      <div className="mt-2 text-xs">
                        <span className="text-slate-600">Problem: </span>
                        <span className="font-medium text-slate-900">{event.details.problem}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}