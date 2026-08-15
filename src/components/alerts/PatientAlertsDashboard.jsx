import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  Flag,
  Loader2,
  Activity,
  Eye,
  X,
  Search,
  FileText
} from "lucide-react";
import { getAlertIcon, getSeverityColor } from "@/components/alerts/alertPresentation";
import { buildSafetyHuddle, formatSlaTime } from "@/components/alerts/safetyHuddle";
import { format, formatDistanceToNow } from "date-fns";
import { Link, useNavigate } from "react-router";
import { createPageUrl } from "@/utils";
import { isAdminView } from "@/lib/roles";

export default function PatientAlertsDashboard({ patientId = null }) {
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("active");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Fetch current user FIRST — the alerts useMemo below references currentUser
  // and isAdmin, which would hit the temporal dead zone (ReferenceError) if
  // these consts were declared after it.
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const isAdmin = isAdminView(currentUser);

  // Fetch alerts via a SERVER-SCOPED function so the browser only receives
  // alerts the caller is authorized for (assigned patients, or all for admins).
  // The favorites filter below is UX-only, no longer an access boundary.
  // Keep the ['patientAlerts'] key so the app-wide invalidations (workflow
  // engine, alert analyzers/widgets, risk analyzers) still refresh this view.
  const { data: allAlerts = [], isLoading } = useQuery({
    queryKey: ['patientAlerts', patientId, 'scoped'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getScopedPatientAlerts', {
        patient_id: patientId || undefined,
      });
      return res?.data?.alerts || [];
    }
  });

  // Favorites are a UX narrow, not an access boundary. Match RealTimePatientAlerts:
  // when the nurse has starred patients, show only those; when they haven't, show
  // all server-scoped alerts (assigned patients). An empty/missing favorites list
  // previously short-circuited to [] and hid overdue visits / high-risk alerts.
  const alerts = React.useMemo(() => {
    if (patientId || isAdmin) return allAlerts;
    const favoritedIds = (currentUser?.favorited_patients || [])
      .map((fav) => (typeof fav === 'string' ? fav : fav?.id))
      .filter(Boolean);
    if (favoritedIds.length === 0) return allAlerts;
    return allAlerts.filter((alert) => favoritedIds.includes(alert.patient_id));
  }, [allAlerts, patientId, currentUser, isAdmin]);

  // Fetch patients for lookup (agency-scoped for facility admins)
  const { data: patients = [] } = useScopedPatients({ sort: '-updated_date', limit: 2000 });

  // (No clinical-event query here: an unused `_clinicalEvents` useQuery used to
  // bulk-list 200 ClinicalEvent rows — per-patient PHI, across every patient,
  // and ClinicalEvent carries no RLS policy — then discard the result. The
  // underscore silenced the unused-variable warning rather than removing the
  // read. Alerts already arrive patient-scoped from getScopedPatientAlerts.)

  const patientMap = patients.reduce((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {});

  // Update alert mutation — routed through updateScopedPatientAlert (not a
  // direct entity update): PatientAlert's own RLS only allows created_by/admin,
  // but this dashboard already shows alerts for patients assigned to, not
  // created by, the caller (via getScopedPatientAlerts above), and a direct
  // entity write would be silently rejected for those.
  const updateAlertMutation = useMutation({
    mutationFn: ({ alertId, action, resolution_notes }) =>
      base44.functions.invoke('updateScopedPatientAlert', { alert_id: alertId, action, resolution_notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientAlerts'] });
      queryClient.invalidateQueries({ queryKey: ['patientRiskAlerts'] });
      queryClient.invalidateQueries({ queryKey: ['allPatientRiskAlerts'] });
      queryClient.invalidateQueries({ queryKey: ['patientActiveAlerts'] });
      if (patientId) {
        queryClient.invalidateQueries({ queryKey: ['patientContext', patientId] });
      }
      setDetailsDialogOpen(false);
      setSelectedAlert(null);
      setResolutionNotes("");
    },
    onError: () => {
      toast.error("Couldn't update the alert. Please try again.");
    }
  });

  // Filter alerts
  const filteredAlerts = alerts.filter(alert => {
    const matchesSeverity = filterSeverity === "all" || alert.severity === filterSeverity;
    const matchesType = filterType === "all" || alert.alert_type === filterType;
    const matchesStatus = activeTab === "all" || 
      (activeTab === "active" && (alert.status === "active" || alert.status === "acknowledged")) ||
      (activeTab === "resolved" && (alert.status === "resolved" || alert.status === "dismissed"));
    const matchesSearch = !searchQuery || 
      alert.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alert.message?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      patientMap[alert.patient_id]?.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      patientMap[alert.patient_id]?.last_name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesSeverity && matchesType && matchesStatus && matchesSearch;
  });

  // Group by severity for summary. "Open" = active OR acknowledged (acknowledged
  // is seen-but-not-resolved); the Active tab already counts both, so counting
  // only 'active' here undercounted open alerts — an acknowledged critical alert
  // vanished from the Critical summary while still showing in the list.
  const isOpen = (a) => a.status === 'active' || a.status === 'acknowledged';
  const alertCounts = {
    critical: alerts.filter(a => a.severity === 'critical' && isOpen(a)).length,
    high: alerts.filter(a => a.severity === 'high' && isOpen(a)).length,
    medium: alerts.filter(a => a.severity === 'medium' && isOpen(a)).length,
    low: alerts.filter(a => a.severity === 'low' && isOpen(a)).length
  };

  const safetyHuddle = React.useMemo(() => buildSafetyHuddle(alerts, new Date(), { limit: 3 }), [alerts]);

  const handleAcknowledge = (alert) => {
    updateAlertMutation.mutate({ alertId: alert.id, action: 'acknowledge' });
  };

  const handleFlagUrgent = (alert) => {
    updateAlertMutation.mutate({ alertId: alert.id, action: 'toggle_flagged_urgent' });
  };

  const handleResolve = () => {
    if (!selectedAlert) return;
    updateAlertMutation.mutate({ alertId: selectedAlert.id, action: 'resolve', resolution_notes: resolutionNotes });
  };

  const handleDismiss = (alert) => {
    updateAlertMutation.mutate({ alertId: alert.id, action: 'dismiss' });
  };

  const getSeverityBorderColor = (severity) => {
    switch (severity) {
      case 'critical': return 'border-l-red-600';
      case 'high': return 'border-l-orange-500';
      case 'medium': return 'border-l-yellow-500';
      case 'low': return 'border-l-blue-500';
      default: return 'border-l-slate-500';
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'active': return <Badge className="bg-red-100 text-red-800">Active</Badge>;
      case 'acknowledged': return <Badge className="bg-blue-100 text-blue-800">Acknowledged</Badge>;
      case 'in_progress': return <Badge className="bg-yellow-100 text-yellow-800">In Progress</Badge>;
      case 'resolved': return <Badge className="bg-green-100 text-green-800">Resolved</Badge>;
      case 'dismissed': return <Badge className="bg-slate-100 text-slate-800">Dismissed</Badge>;
      default: return null;
    }
  };

  const openDetails = (alert) => {
    setSelectedAlert(alert);
    setDetailsDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-red-600">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-red-600">{alertCounts.critical}</p>
                <p className="text-xs text-slate-600">Critical</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-200" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-orange-600">{alertCounts.high}</p>
                <p className="text-xs text-slate-600">High</p>
              </div>
              <Bell className="w-8 h-8 text-orange-200" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-yellow-600">{alertCounts.medium}</p>
                <p className="text-xs text-slate-600">Medium</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-200" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-blue-600">{alertCounts.low}</p>
                <p className="text-xs text-slate-600">Low</p>
              </div>
              <Eye className="w-8 h-8 text-blue-200" />
            </div>
          </CardContent>
        </Card>
      </div>


      {/* Closed-loop Safety Huddle */}
      {safetyHuddle.summary.openCount > 0 && (
        <Card className={`border-l-4 ${safetyHuddle.summary.status === 'escalate' ? 'border-l-red-600' : 'border-l-amber-500'}`}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-base">
              <span className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-navy-600" />
                Closed-loop Safety Huddle
              </span>
              <div className="flex flex-wrap gap-2">
                <Badge className={safetyHuddle.summary.status === 'escalate' ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-800'}>
                  {safetyHuddle.summary.status === 'escalate' ? 'Escalate now' : 'Huddle needed'}
                </Badge>
                <Badge variant="outline">{safetyHuddle.summary.overdueCount} overdue</Badge>
                <Badge variant="outline">{safetyHuddle.summary.unassignedCount} unassigned</Badge>
                <Badge variant="outline">{safetyHuddle.summary.unacknowledgedCount} unacknowledged</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">
              Prioritized open alerts with owner, acknowledgement, SLA, and next-action gaps so high-risk alerts move from detection to documented resolution.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {safetyHuddle.topItems.map((item) => (
                <div key={item.id || item.title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 line-clamp-1">{item.title}</p>
                      <p className="text-xs text-slate-500">{item.owner || 'No owner assigned'}</p>
                    </div>
                    <Badge className={getSeverityColor(item.severity)}>{item.severity}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <Badge variant="outline" className={item.isOverdue ? 'text-red-700 border-red-200' : ''}>
                      {formatSlaTime(item.minutesUntilDue)}
                    </Badge>
                    {item.needsOwner && <Badge className="bg-orange-100 text-orange-800">assign owner</Badge>}
                    {!item.isAcknowledged && <Badge className="bg-blue-100 text-blue-800">ack needed</Badge>}
                  </div>
                  <p className="text-xs text-slate-600">{item.nextAction}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search alerts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severity</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="vital_deterioration">Vital Deterioration</SelectItem>
                <SelectItem value="medication_risk">Medication Risk</SelectItem>
                <SelectItem value="fall_risk">Fall Risk</SelectItem>
                <SelectItem value="readmission_risk">Readmission Risk</SelectItem>
                <SelectItem value="infection_risk">Infection Risk</SelectItem>
                <SelectItem value="symptom_escalation">Symptom Escalation</SelectItem>
                <SelectItem value="care_gap">Care Gap</SelectItem>
                <SelectItem value="urgent_intervention">Urgent Intervention</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="active" className="gap-2">
            <Bell className="w-4 h-4" />
            Active ({alerts.filter(a => a.status === 'active' || a.status === 'acknowledged').length})
          </TabsTrigger>
          <TabsTrigger value="resolved" className="gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Resolved
          </TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {isLoading ? (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-400" />
            </div>
          ) : filteredAlerts.length === 0 ? (
            <EmptyState icon={BellOff} title="No alerts found" description="" />
          ) : (
            <div className="space-y-3">
              {filteredAlerts.map((alert) => {
                const patient = patientMap[alert.patient_id];
                return (
                  <Card 
                    key={alert.id} 
                    className={`border-l-4 ${getSeverityBorderColor(alert.severity)} ${alert.flagged_urgent ? 'ring-2 ring-red-400 ring-offset-2' : ''}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          <div className={`p-2 rounded-lg ${alert.severity === 'critical' ? 'bg-red-100' : alert.severity === 'high' ? 'bg-orange-100' : 'bg-slate-100'}`}>
                            {getAlertIcon(alert.alert_type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <Badge className={getSeverityColor(alert.severity)}>
                                {alert.severity}
                              </Badge>
                              {getStatusBadge(alert.status)}
                              {alert.flagged_urgent && (
                                <Badge className="bg-red-100 text-red-800 gap-1">
                                  <Flag className="w-3 h-3" /> Urgent
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-xs">
                                {(alert.alert_type || '').replace(/_/g, ' ')}
                              </Badge>
                            </div>
                            
                            <h3 className="font-semibold text-slate-900">{alert.title}</h3>
                            
                            {patient && (
                              <Link 
                                to={`${createPageUrl("PatientDetails")}?id=${patient.id}`}
                                className="text-sm text-blue-600 hover:underline"
                              >
                                {patient.first_name} {patient.last_name}
                              </Link>
                            )}
                            
                            <p className="text-sm text-slate-600 mt-1 line-clamp-2">{alert.message}</p>

                            {alert.data_sources?.clinical_event_id && (
                              <div className="mt-2 p-2 bg-navy-50 border border-navy-200 rounded text-xs">
                                <div className="flex items-center gap-2 mb-1">
                                  <Activity className="w-3 h-3 text-navy-600" />
                                  <span className="font-medium text-navy-900">Linked Clinical Event</span>
                                </div>
                                <div className="text-navy-700">
                                  <span className="font-medium">Type:</span> {alert.data_sources.event_type?.replace(/_/g, ' ')}
                                </div>
                                {alert.data_sources.structured_data && (
                                  <div className="text-navy-700 mt-1">
                                    {Object.entries(alert.data_sources.structured_data).slice(0, 2).map(([key, value]) => (
                                      <div key={key}>
                                        <span className="font-medium">{key}:</span> {String(value)}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {alert.risk_score && (
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-xs text-slate-500">Risk Score:</span>
                                <div className="flex-1 max-w-[100px] bg-slate-200 rounded-full h-2">
                                  <div 
                                    className={`h-2 rounded-full ${alert.risk_score >= 70 ? 'bg-red-500' : alert.risk_score >= 40 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                    style={{ width: `${alert.risk_score}%` }}
                                  />
                                </div>
                                <span className="text-xs font-medium">{alert.risk_score}%</span>
                              </div>
                            )}

                            <p className="text-xs text-slate-400 mt-2">
                              Created {formatDistanceToNow(new Date(alert.created_date), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => openDetails(alert)}
                          >
                            <Eye className="w-3 h-3 mr-1" /> View
                          </Button>
                          
                          {alert.status === 'active' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleAcknowledge(alert)}
                            >
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Ack
                            </Button>
                          )}
                          
                          <Button
                            size="sm"
                            variant={alert.flagged_urgent ? "destructive" : "outline"}
                            className="h-7 text-xs"
                            onClick={() => handleFlagUrgent(alert)}
                          >
                            <Flag className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Alert Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedAlert && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {getAlertIcon(selectedAlert.alert_type)}
                  {selectedAlert.title}
                </DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={getSeverityColor(selectedAlert.severity)}>
                    {selectedAlert.severity}
                  </Badge>
                  {getStatusBadge(selectedAlert.status)}
                  {selectedAlert.flagged_urgent && (
                    <Badge className="bg-red-100 text-red-800">🚨 Flagged Urgent</Badge>
                  )}
                  {selectedAlert.risk_score && (
                    <Badge variant="outline">Risk Score: {selectedAlert.risk_score}%</Badge>
                  )}
                </div>

                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-700">{selectedAlert.message}</p>
                </div>

                {/* Clinical Event Details */}
                {selectedAlert.data_sources?.clinical_event_id && (
                  <Card className="border-navy-300 bg-navy-50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Activity className="w-4 h-4 text-navy-600" />
                        Clinical Event Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="font-semibold text-slate-700">Event Type:</span>
                          <p className="text-slate-600">{selectedAlert.data_sources.event_type?.replace(/_/g, ' ')}</p>
                        </div>
                        {selectedAlert.data_sources.visit_id && (
                          <div>
                            <span className="font-semibold text-slate-700">Visit ID:</span>
                            <p className="text-slate-600 font-mono text-xs">{selectedAlert.data_sources.visit_id.slice(0, 8)}...</p>
                          </div>
                        )}
                      </div>
                      
                      {selectedAlert.data_sources.structured_data && (
                        <div>
                          <span className="font-semibold text-slate-700 text-sm">Event Data:</span>
                          <div className="mt-1 p-2 bg-white rounded border text-xs space-y-1">
                            {Object.entries(selectedAlert.data_sources.structured_data).map(([key, value]) => (
                              <div key={key} className="flex gap-2">
                                <span className="font-medium text-navy-700">{key}:</span>
                                <span className="text-slate-600">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2"
                        onClick={() => {
                          const patient = patientMap[selectedAlert.patient_id];
                          if (patient) {
                            // In-app navigation, not window.open: installed
                            // apps (standalone PWA/TWA) have no "new tab" — a
                            // _blank open breaks out of the app shell or no-ops.
                            setDetailsDialogOpen(false);
                            navigate(createPageUrl(`PatientDetails?id=${patient.id}`));
                          }
                        }}
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        View in Patient Chart
                      </Button>
                    </CardContent>
                  </Card>
                )}

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-semibold text-slate-700">Created:</span>
                    <p className="text-slate-600">{format(new Date(selectedAlert.created_date), 'PPpp')}</p>
                  </div>
                  {selectedAlert.expires_at && (
                    <div>
                      <span className="font-semibold text-slate-700">Expires:</span>
                      <p className="text-slate-600">{format(new Date(selectedAlert.expires_at), 'PPp')}</p>
                    </div>
                  )}
                </div>

                {selectedAlert.contributing_factors?.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Contributing Factors</h4>
                    <ul className="space-y-1">
                      {selectedAlert.contributing_factors.map((factor, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          <span className="text-orange-500 mt-0.5">•</span>
                          <span>{factor}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedAlert.recommended_actions?.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Recommended Actions</h4>
                    <ul className="space-y-1">
                      {selectedAlert.recommended_actions.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedAlert.data_sources && Object.keys(selectedAlert.data_sources).length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Data Sources</h4>
                    <div className="p-2 bg-blue-50 rounded-lg text-xs">
                      <pre className="whitespace-pre-wrap">
                        {JSON.stringify(selectedAlert.data_sources, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {selectedAlert.acknowledged_by && (
                  <div className="text-sm text-slate-600">
                    <p>Acknowledged by: {selectedAlert.acknowledged_by}</p>
                    <p>At: {format(new Date(selectedAlert.acknowledged_at), 'PPpp')}</p>
                  </div>
                )}

                {selectedAlert.status !== 'resolved' && selectedAlert.status !== 'dismissed' && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Resolution Notes</h4>
                    <Textarea
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="Document how this alert was addressed..."
                      rows={3}
                    />
                  </div>
                )}

                {selectedAlert.resolution_notes && (
                  <div className="p-3 bg-green-50 rounded-lg">
                    <h4 className="font-semibold text-sm text-green-800 mb-1">Resolution Notes</h4>
                    <p className="text-sm text-green-700">{selectedAlert.resolution_notes}</p>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2">
                {selectedAlert.status !== 'resolved' && selectedAlert.status !== 'dismissed' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleDismiss(selectedAlert)}
                    >
                      <X className="w-4 h-4 mr-1" /> Dismiss
                    </Button>
                    <Button
                      onClick={handleResolve}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Mark Resolved
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => setDetailsDialogOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}