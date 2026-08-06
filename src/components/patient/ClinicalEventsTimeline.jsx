import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  AlertCircle,
  Pill,
  Heart,
  Thermometer,
  TrendingUp,
  Brain,
  FileWarning
} from "lucide-react";
import { parseLocalDate, formatLocalDate } from "@/lib/dateLocal";
import PatientTimelineStrip from "@/components/patient/PatientTimelineStrip";

const EVENT_ICONS = {
  medication_change: Pill,
  medication_started: Pill,
  medication_stopped: Pill,
  fall: AlertCircle,
  wound_new: FileWarning,
  wound_change: TrendingUp,
  vital_change: Heart,
  symptom_new: AlertCircle,
  symptom_resolved: Activity,
  cognitive_change: Brain,
  hospitalization: Activity,
  infection: Thermometer
};

export default function ClinicalEventsTimeline({
  patientId,
  limit = 20,
  visits: visitsProp,
  incidents: incidentsProp,
  tasks: tasksProp,
}) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [dateRange, setDateRange] = useState("30");

  // Optional related records for the unified (cross-entity) timeline strip.
  // Prefer parent-provided lists to avoid duplicate fetches; fall back to scoped queries.
  const { data: visitsFetched = [] } = useQuery({
    queryKey: ['patientVisits', patientId, 100],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 100),
    enabled: !!patientId && visitsProp === undefined,
  });
  const { data: incidentsFetched = [] } = useQuery({
    queryKey: ['patientIncidents', patientId, 100],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 100),
    enabled: !!patientId && incidentsProp === undefined,
  });
  const { data: tasksFetched = [] } = useQuery({
    queryKey: ['patientTasks', patientId],
    queryFn: () => base44.entities.Task.filter({ patient_id: patientId }, '-due_date', 100),
    enabled: !!patientId && tasksProp === undefined,
  });

  const visits = visitsProp ?? visitsFetched;
  const incidents = incidentsProp ?? incidentsFetched;
  const tasks = tasksProp ?? tasksFetched;

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['clinicalEvents', patientId, dateRange],
    queryFn: async () => {
      const allEvents = await base44.entities.ClinicalEvent.filter(
        { patient_id: patientId },
        '-event_date',
        200
      );
      
      if (dateRange !== "all") {
        const daysAgo = parseInt(dateRange);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
        cutoffDate.setHours(0, 0, 0, 0);

        // Parse the date-only event_date on the local calendar so a boundary-day
        // event isn't shifted to UTC midnight and dropped from the range.
        return allEvents.filter(e => {
          const d = parseLocalDate(e.event_date);
          return d && d >= cutoffDate;
        });
      }
      
      return allEvents;
    },
    enabled: !!patientId
  });

  const filteredEvents = events
    .filter(e => typeFilter === "all" || e.event_type === typeFilter)
    .filter(e => severityFilter === "all" || e.severity === severityFilter)
    .slice(0, limit);

  const eventTypes = [...new Set(events.map(e => e.event_type))];

  const unifiedTimeline = (
    <PatientTimelineStrip
      patientId={patientId}
      visits={visits}
      incidents={incidents}
      tasks={tasks}
      limit={12}
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {unifiedTimeline}
        <Card>
          <CardContent className="p-8 text-center text-slate-500">
            Loading clinical events...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="space-y-4">
        {unifiedTimeline}
        <Card>
          <CardContent className="p-8 text-center">
            <Activity className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <p className="text-slate-600">No clinical events recorded yet</p>
            <p className="text-sm text-slate-500 mt-2">Events will appear here as they're documented in visit notes</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {unifiedTimeline}

      {/* Filters */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Event Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {eventTypes.map(type => (
                  <SelectItem key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>

            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger>
                <SelectValue placeholder="Time Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Clinical Events Timeline ({filteredEvents.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-slate-200" />
            
            {filteredEvents.map((event, idx) => {
              const Icon = EVENT_ICONS[event.event_type] || Activity;
              const _isLast = idx === filteredEvents.length - 1;
              
              return (
                <div key={event.id} className="relative pl-14 pb-6">
                  {/* Timeline dot */}
                  <div className={`absolute left-4 w-5 h-5 rounded-full border-4 border-white ${
                    event.severity === 'critical' ? 'bg-red-600' :
                    event.severity === 'high' ? 'bg-orange-500' :
                    event.severity === 'medium' ? 'bg-blue-500' :
                    'bg-slate-400'
                  }`} />
                  
                  <div className="bg-white border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg flex-shrink-0 ${
                        event.severity === 'critical' ? 'bg-red-100' :
                        event.severity === 'high' ? 'bg-orange-100' :
                        'bg-blue-100'
                      }`}>
                        <Icon className={`w-4 h-4 ${
                          event.severity === 'critical' ? 'text-red-600' :
                          event.severity === 'high' ? 'text-orange-600' :
                          'text-blue-600'
                        }`} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <p className="text-xs text-slate-500">
                            {formatLocalDate(event.event_date, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                          <Badge className="text-xs">
                            {(event.event_type || '').replace(/_/g, ' ')}
                          </Badge>
                          <Badge variant="outline" className={`text-xs ${
                            event.severity === 'critical' ? 'border-red-500 text-red-700' :
                            event.severity === 'high' ? 'border-orange-500 text-orange-700' :
                            'border-blue-500 text-blue-700'
                          }`}>
                            {event.severity}
                          </Badge>
                          {event.verified && (
                            <Badge className="bg-green-600 text-xs">Verified</Badge>
                          )}
                        </div>
                        
                        <p className="font-semibold text-sm text-slate-900 mb-1">
                          {event.event_title}
                        </p>
                        
                        <p className="text-sm text-slate-700 mb-2">
                          {event.event_description}
                        </p>
                        
                        {event.structured_data && Object.keys(event.structured_data).length > 0 && (
                          <div className="bg-slate-50 rounded p-2 mb-2">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              {Object.entries(event.structured_data).slice(0, 4).map(([key, value]) => (
                                <div key={key}>
                                  <span className="font-medium text-slate-700">{key}: </span>
                                  <span className="text-slate-600">{String(value)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {event.requires_followup && (
                          <Badge className="bg-yellow-600 text-xs">Requires Follow-up</Badge>
                        )}
                        
                        {event.source_text && (
                          <details className="mt-2">
                            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
                              View source text
                            </summary>
                            <p className="text-xs text-slate-600 italic mt-1 bg-slate-50 p-2 rounded">
                              "{event.source_text}"
                            </p>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
