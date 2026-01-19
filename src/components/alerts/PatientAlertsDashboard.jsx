import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Heart,
  Pill,
  TrendingDown,
  Shield,
  Users,
  Zap,
  Eye,
  Send,
  X,
  Filter,
  Search,
  ListTodo,
  UserCheck,
  Phone,
  FileText,
  ExternalLink,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function PatientAlertsDashboard({ patientId = null, showAllPatients = true }) {
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("active");
  const queryClient = useQueryClient();

  // Fetch alerts
  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['patientAlerts', patientId, showAllPatients],
    queryFn: async () => {
      if (patientId) {
        return base44.entities.PatientAlert.filter({ patient_id: patientId }, '-created_date');
      }
      return base44.entities.PatientAlert.list('-created_date', 100);
    }
  });

  // Fetch patients for lookup
  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list()
  });

  // Fetch current user
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const patientMap = patients.reduce((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {});

  // Update alert mutation
  const updateAlertMutation = useMutation({
    mutationFn: ({ alertId, data }) => base44.entities.PatientAlert.update(alertId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientAlerts'] });
      setDetailsDialogOpen(false);
      setSelectedAlert(null);
      setResolutionNotes("");
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

  // Group by severity for summary
  const alertCounts = {
    critical: alerts.filter(a => a.severity === 'critical' && a.status === 'active').length,
    high: alerts.filter(a => a.severity === 'high' && a.status === 'active').length,
    medium: alerts.filter(a => a.severity === 'medium' && a.status === 'active').length,
    low: alerts.filter(a => a.severity === 'low' && a.status === 'active').length
  };

  const handleAcknowledge = (alert) => {
    updateAlertMutation.mutate({
      alertId: alert.id,
      data: {
        status: 'acknowledged',
        acknowledged_by: currentUser?.email,
        acknowledged_at: new Date().toISOString()
      }
    });
  };

  const handleFlagUrgent = (alert) => {
    updateAlertMutation.mutate({
      alertId: alert.id,
      data: {
        flagged_urgent: !alert.flagged_urgent
      }
    });
  };

  const handleResolve = () => {
    if (!selectedAlert) return;
    updateAlertMutation.mutate({
      alertId: selectedAlert.id,
      data: {
        status: 'resolved',
        resolution_notes: resolutionNotes
      }
    });
  };

  const handleDismiss = (alert) => {
    updateAlertMutation.mutate({
      alertId: alert.id,
      data: { status: 'dismissed' }
    });
  };

  const createTaskFromAlert = async (alert) => {
    try {
      const patient = patientMap[alert.patient_id];
      const task = await base44.entities.Task.create({
        patient_id: alert.patient_id,
        title: alert.title,
        description: alert.message,
        type: 'followup',
        priority: alert.severity === 'critical' ? 'critical' : alert.severity,
        status: 'pending',
        source: 'ai_generated',
        ai_reason: `Generated from alert: ${alert.title}`,
        assigned_to: currentUser?.email
      });
      toast.success('Task created successfully');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch (error) {
      toast.error('Failed to create task');
    }
  };

  const assignToMe = (alert) => {
    updateAlertMutation.mutate({
      alertId: alert.id,
      data: { assigned_to: currentUser?.email }
    });
    toast.success('Alert assigned to you');
  };

  const getAlertIcon = (type) => {
    const icons = {
      vital_deterioration: Activity,
      medication_risk: Pill,
      fall_risk: TrendingDown,
      readmission_risk: Heart,
      infection_risk: Shield,
      symptom_escalation: AlertTriangle,
      care_gap: Clock,
      urgent_intervention: Zap,
      hospice_transition: Heart,
      caregiver_burnout: Users
    };
    const Icon = icons[type] || AlertTriangle;
    return <Icon className="w-4 h-4" />;
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getSeverityBorderColor = (severity) => {
    switch (severity) {
      case 'critical': return 'border-l-red-600';
      case 'high': return 'border-l-orange-500';
      case 'medium': return 'border-l-yellow-500';
      case 'low': return 'border-l-blue-500';
      default: return 'border-l-gray-500';
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'active': return <Badge className="bg-red-100 text-red-800">Active</Badge>;
      case 'acknowledged': return <Badge className="bg-blue-100 text-blue-800">Acknowledged</Badge>;
      case 'in_progress': return <Badge className="bg-yellow-100 text-yellow-800">In Progress</Badge>;
      case 'resolved': return <Badge className="bg-green-100 text-green-800">Resolved</Badge>;
      case 'dismissed': return <Badge className="bg-gray-100 text-gray-800">Dismissed</Badge>;
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
                <p className="text-xs text-gray-600">Critical</p>
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
                <p className="text-xs text-gray-600">High</p>
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
                <p className="text-xs text-gray-600">Medium</p>
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
                <p className="text-xs text-gray-600">Low</p>
              </div>
              <Eye className="w-8 h-8 text-blue-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
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
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
            </div>
          ) : filteredAlerts.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-gray-500">
                <BellOff className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>No alerts found</p>
              </CardContent>
            </Card>
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
                          <div className={`p-2 rounded-lg ${alert.severity === 'critical' ? 'bg-red-100' : alert.severity === 'high' ? 'bg-orange-100' : 'bg-gray-100'}`}>
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
                                {alert.alert_type.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                            
                            <h3 className="font-semibold text-gray-900">{alert.title}</h3>
                            
                            {patient && (
                              <div className="flex items-center gap-2 mt-1">
                                <Link 
                                  to={`${createPageUrl("PatientDetails")}?id=${patient.id}`}
                                  className="text-sm text-blue-600 hover:underline font-medium"
                                >
                                  {patient.first_name} {patient.last_name}
                                </Link>
                                <span className="text-xs text-gray-400">•</span>
                                <span className="text-xs text-gray-500">{patient.primary_diagnosis || 'No diagnosis'}</span>
                                {patient.date_of_birth && (
                                  <>
                                    <span className="text-xs text-gray-400">•</span>
                                    <span className="text-xs text-gray-500">{Math.floor((new Date() - new Date(patient.date_of_birth)) / 31536000000)} yo</span>
                                  </>
                                )}
                              </div>
                            )}
                            
                            <p className="text-sm text-gray-600 mt-2 line-clamp-2">{alert.message}</p>
                            
                            {alert.contributing_factors && alert.contributing_factors.length > 0 && (
                              <div className="mt-2 text-xs text-gray-500">
                                <span className="font-medium">Factors:</span> {alert.contributing_factors.slice(0, 2).join(', ')}
                                {alert.contributing_factors.length > 2 && ` +${alert.contributing_factors.length - 2} more`}
                              </div>
                            )}
                            
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                              {alert.risk_score && (
                                <div className="flex items-center gap-2">
                                  <Sparkles className="w-3 h-3 text-purple-500" />
                                  <span className="text-xs text-gray-500">AI Confidence:</span>
                                  <div className="flex-1 min-w-[60px] bg-gray-200 rounded-full h-1.5">
                                    <div 
                                      className={`h-1.5 rounded-full ${alert.risk_score >= 70 ? 'bg-red-500' : alert.risk_score >= 40 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                      style={{ width: `${alert.risk_score}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-medium">{alert.risk_score}%</span>
                                </div>
                              )}
                              {alert.assigned_to && (
                                <div className="flex items-center gap-1 text-xs text-gray-500">
                                  <UserCheck className="w-3 h-3" />
                                  <span>{alert.assigned_to.split('@')[0]}</span>
                                </div>
                              )}
                            </div>
                            
                            <p className="text-xs text-gray-400 mt-2">
                              {formatDistanceToNow(new Date(alert.created_date), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => openDetails(alert)}
                            title="View details"
                          >
                            <Eye className="w-3 h-3 mr-1" /> View
                          </Button>
                          
                          {alert.status === 'active' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => handleAcknowledge(alert)}
                                title="Acknowledge"
                              >
                                <CheckCircle2 className="w-3 h-3 mr-1" /> Ack
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => createTaskFromAlert(alert)}
                                title="Create task"
                              >
                                <ListTodo className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => assignToMe(alert)}
                                title="Assign to me"
                              >
                                <UserCheck className="w-3 h-3" />
                              </Button>
                            </>
                          )}
                          
                          <Button
                            size="sm"
                            variant={alert.flagged_urgent ? "destructive" : "outline"}
                            className="h-7 text-xs"
                            onClick={() => handleFlagUrgent(alert)}
                            title={alert.flagged_urgent ? "Unflag" : "Flag as urgent"}
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
                {/* Patient Context Card */}
                {patientMap[selectedAlert.patient_id] && (
                  <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-gray-900 dark:text-gray-100">
                              {patientMap[selectedAlert.patient_id].first_name} {patientMap[selectedAlert.patient_id].last_name}
                            </h4>
                            {patientMap[selectedAlert.patient_id].date_of_birth && (
                              <span className="text-xs text-gray-600 dark:text-gray-400">
                                {Math.floor((new Date() - new Date(patientMap[selectedAlert.patient_id].date_of_birth)) / 31536000000)} years old
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-medium">Dx:</span> {patientMap[selectedAlert.patient_id].primary_diagnosis || 'Not specified'}
                          </p>
                          {patientMap[selectedAlert.patient_id].allergies && (
                            <p className="text-xs text-red-600 dark:text-red-400">
                              <span className="font-medium">Allergies:</span> {patientMap[selectedAlert.patient_id].allergies}
                            </p>
                          )}
                        </div>
                        <Link
                          to={`${createPageUrl("PatientDetails")}?id=${selectedAlert.patient_id}`}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          View Chart <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={getSeverityColor(selectedAlert.severity)}>
                    {selectedAlert.severity}
                  </Badge>
                  {getStatusBadge(selectedAlert.status)}
                  {selectedAlert.flagged_urgent && (
                    <Badge className="bg-red-100 text-red-800">🚨 Flagged Urgent</Badge>
                  )}
                  {selectedAlert.risk_score && (
                    <Badge variant="outline" className="gap-1">
                      <Sparkles className="w-3 h-3" /> AI Confidence: {selectedAlert.risk_score}%
                    </Badge>
                  )}
                </div>

                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-700">{selectedAlert.message}</p>
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
                  <div className="text-sm text-gray-600">
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

              <DialogFooter className="gap-2 flex-wrap">
                {selectedAlert.status !== 'resolved' && selectedAlert.status !== 'dismissed' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        createTaskFromAlert(selectedAlert);
                        setDetailsDialogOpen(false);
                      }}
                      className="flex-1"
                    >
                      <ListTodo className="w-4 h-4 mr-1" /> Create Task
                    </Button>
                    {patientMap[selectedAlert.patient_id]?.physician_phone && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          window.location.href = `tel:${patientMap[selectedAlert.patient_id].physician_phone}`;
                        }}
                        className="flex-1"
                      >
                        <Phone className="w-4 h-4 mr-1" /> Call MD
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => handleDismiss(selectedAlert)}
                    >
                      <X className="w-4 h-4 mr-1" /> Dismiss
                    </Button>
                    <Button
                      onClick={handleResolve}
                      className="bg-green-600 hover:bg-green-700"
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