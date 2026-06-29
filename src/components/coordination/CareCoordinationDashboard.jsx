import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  Mail,
  Clock
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Label } from "@/components/ui/label";

export default function CareCoordinationDashboard() {
  const queryClient = useQueryClient();
  const [resolvingId, setResolvingId] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState({});

  const { data: alerts = [] } = useQuery({
    queryKey: ['allCoordinationAlerts'],
    queryFn: () => base44.entities.CareCoordinationAlert.list('-created_date', 200),
    initialData: [],
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
    initialData: [],
  });

  const activeAlerts = alerts.filter(a => a.status === 'active');
  const urgentAlerts = activeAlerts.filter(a => a.severity === 'urgent');
  const overdueAlerts = activeAlerts.filter(a => a.due_date && new Date(a.due_date) < new Date());

  const resolveAlert = async (alertId) => {
    setResolvingId(alertId);
    try {
      await base44.entities.CareCoordinationAlert.update(alertId, {
        status: 'resolved',
        resolved_date: format(new Date(), 'yyyy-MM-dd'),
        resolution_notes: resolutionNotes[alertId] || 'Resolved'
      });
      queryClient.invalidateQueries({ queryKey: ['allCoordinationAlerts'] });
    } catch (error) {
      console.error('Error resolving alert:', error);
    }
    setResolvingId(null);
  };

  const getSeverityColor = (severity) => {
    const colors = {
      urgent: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[severity] || 'bg-slate-100 text-slate-800';
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Care Coordination Dashboard</h1>
        <p className="text-slate-600">AI-identified care gaps and provider coordination needs</p>
      </div>

      {/* Summary Cards */}
      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <Card className="bg-gradient-to-br from-navy-500 to-navy-600 text-white">
          <CardContent className="p-4">
            <p className="text-navy-100 text-sm mb-1">Active Alerts</p>
            <p className="text-3xl font-bold">{activeAlerts.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white">
          <CardContent className="p-4">
            <p className="text-red-100 text-sm mb-1">Urgent</p>
            <p className="text-3xl font-bold">{urgentAlerts.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="p-4">
            <p className="text-orange-100 text-sm mb-1">Overdue</p>
            <p className="text-3xl font-bold">{overdueAlerts.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="p-4">
            <p className="text-green-100 text-sm mb-1">Team Meetings Needed</p>
            <p className="text-3xl font-bold">
              {activeAlerts.filter(a => a.team_meeting_suggested).length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts List */}
      <div className="space-y-4">
        {activeAlerts.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <p className="text-lg font-medium text-slate-900">No Active Coordination Alerts</p>
              <p className="text-sm text-slate-600">All care coordination needs have been addressed</p>
            </CardContent>
          </Card>
        ) : (
          activeAlerts.map((alert) => {
            const patient = patients.find(p => p.id === alert.patient_id);
            const isOverdue = alert.due_date && new Date(alert.due_date) < new Date();
            
            return (
              <Card key={alert.id} className={`border-l-4 ${
                alert.severity === 'urgent' ? 'border-l-red-500 bg-red-50' :
                alert.severity === 'high' ? 'border-l-orange-500' :
                alert.severity === 'medium' ? 'border-l-yellow-500' : 'border-l-blue-500'
              }`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {patient && (
                          <Link 
                            to={createPageUrl(`PatientDetails?id=${patient.id}`)}
                            className="font-bold text-blue-600 hover:underline"
                          >
                            {patient.first_name} {patient.last_name}
                          </Link>
                        )}
                        {isOverdue && (
                          <Badge className="bg-red-600 text-white">
                            <Clock className="w-3 h-3 mr-1" />
                            OVERDUE
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-lg mb-2">{alert.title}</CardTitle>
                      <div className="flex gap-2 flex-wrap">
                        <Badge className={getSeverityColor(alert.severity)}>
                          {alert.severity}
                        </Badge>
                        <Badge variant="outline">{(alert.alert_type || '').replace(/_/g, ' ')}</Badge>
                        {alert.team_meeting_suggested && (
                          <Badge className="bg-navy-100 text-navy-800">
                            Team Meeting
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-slate-700">{alert.description}</p>

                  <div className="grid md:grid-cols-2 gap-3">
                    <div className="bg-blue-50 p-3 rounded">
                      <p className="text-xs font-semibold text-blue-900 mb-1">Affected Providers:</p>
                      <p className="text-sm text-blue-800">
                        {alert.affected_providers?.join(', ') || 'Not specified'}
                      </p>
                    </div>
                    <div className="bg-green-50 p-3 rounded">
                      <p className="text-xs font-semibold text-green-900 mb-1">Due Date:</p>
                      <p className="text-sm text-green-800">
                        {alert.due_date ? format(new Date(alert.due_date), 'MMM d, yyyy') : 'Not set'}
                      </p>
                    </div>
                  </div>

                  {alert.communication_summary && (
                    <div className="bg-slate-50 p-3 rounded border">
                      <p className="text-xs font-semibold text-slate-900 mb-1">Communication Summary:</p>
                      <p className="text-sm text-slate-700">{alert.communication_summary}</p>
                    </div>
                  )}

                  {/* Resolution */}
                  <div className="pt-3 border-t">
                    <Label className="text-sm mb-2 block">Resolution Notes</Label>
                    <Textarea
                      placeholder="How was this addressed?"
                      value={resolutionNotes[alert.id] || ''}
                      onChange={(e) => setResolutionNotes({ ...resolutionNotes, [alert.id]: e.target.value })}
                      className="mb-2"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => resolveAlert(alert.id)}
                        disabled={resolvingId === alert.id}
                      >
                        {resolvingId === alert.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                        )}
                        Mark Resolved
                      </Button>
                      {patient?.physician_email && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            window.location.href = `mailto:${patient.physician_email}?subject=Care Coordination: ${patient.first_name} ${patient.last_name}&body=${encodeURIComponent(alert.communication_summary || alert.description)}`;
                          }}
                        >
                          <Mail className="w-4 h-4 mr-1" />
                          Email Physician
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}