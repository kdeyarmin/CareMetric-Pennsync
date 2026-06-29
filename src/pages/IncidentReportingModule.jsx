import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import StatCard from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Camera,
  Send,
  CheckCircle2,
  Clock,
  X,
  FileText,
  TrendingUp,
  Calendar as CalendarIcon
} from "lucide-react";
import { toast } from "sonner";
import { format, parseISO, subMonths } from "date-fns";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

export default function IncidentReportingModule() {
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [formData, setFormData] = useState({
    patient_id: "",
    incident_type: "",
    incident_name: "",
    incident_date: format(new Date(), 'yyyy-MM-dd'),
    incident_time: format(new Date(), 'HH:mm'),
    severity: "medium",
    details: {},
    report: "",
    photo_urls: [],
    physician_notified: false,
    office_notified: false
  });
  const [uploadedPhotos, setUploadedPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: myPatients = [] } = useQuery({
    // Key must include the email the queryFn filters by, otherwise a session
    // user change keeps serving the previous nurse's cached patient list.
    queryKey: ['myPatients', currentUser?.email],
    queryFn: async () => {
      const allPatients = await base44.entities.Patient.list('-updated_date', 2000);
      return allPatients.filter(p => p.assigned_nurses?.includes(currentUser?.email));
    },
    enabled: !!currentUser,
    initialData: [],
  });

  const { data: incidents = [], _isLoading } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => base44.entities.Incident.list('-created_date', 200),
    initialData: [],
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
    initialData: [],
  });

  const createIncidentMutation = useMutation({
    mutationFn: async (incidentData) => {
      const incident = await base44.entities.Incident.create(incidentData);
      
      // Send automated alerts to clinical managers
      const managers = await base44.entities.User.filter({ role: 'admin' });
      const patient = patients.find(p => p.id === incidentData.patient_id);
      
      if (managers.length > 0 && incidentData.severity === 'high') {
        await Promise.all(
          managers.map(manager =>
            base44.integrations.Core.SendEmail({
              to: manager.email,
              subject: `🚨 High Severity Incident Reported - ${incidentData.incident_type}`,
              body: `A high severity incident has been reported:

Patient: ${patient?.first_name} ${patient?.last_name}
Incident Type: ${incidentData.incident_type}
Date: ${incidentData.incident_date} at ${incidentData.incident_time}
Reported By: ${currentUser?.full_name}

Details: ${incidentData.report}

Please review this incident in the Incident Reporting Dashboard.`
            })
          )
        );
      }
      
      return incident;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      setShowReportDialog(false);
      resetForm();
      toast.success("Incident reported successfully. Clinical managers have been notified.");
    },
    onError: () => {
      toast.error("Failed to submit incident report");
    }
  });

  const updateIncidentMutation = useMutation({
    mutationFn: ({ id, updates }) => base44.entities.Incident.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      toast.success("Incident status updated");
    },
  });

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploading(true);
    try {
      const uploadPromises = files.map(file =>
        base44.integrations.Core.UploadFile({ file })
      );
      
      const results = await Promise.all(uploadPromises);
      const urls = results.map(r => r.file_url);
      
      setUploadedPhotos(prev => [...prev, ...urls]);
      setFormData(prev => ({
        ...prev,
        photo_urls: [...prev.photo_urls, ...urls]
      }));
      
      toast.success(`${files.length} photo(s) uploaded`);
    } catch {
      toast.error("Failed to upload photos");
    }
    setUploading(false);
  };

  const removePhoto = (url) => {
    setUploadedPhotos(prev => prev.filter(p => p !== url));
    setFormData(prev => ({
      ...prev,
      photo_urls: prev.photo_urls.filter(p => p !== url)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.patient_id || !formData.incident_type || !formData.report) {
      toast.error("Please fill in all required fields");
      return;
    }

    const patient = patients.find(p => p.id === formData.patient_id);
    
    createIncidentMutation.mutate({
      ...formData,
      patient_name: patient ? `${patient.first_name} ${patient.last_name}` : "",
      incident_name: formData.incident_type,
      alert_triggered: formData.severity === 'high',
      status: 'reported',
      ai_tags: [formData.incident_type, formData.severity]
    });
  };

  const resetForm = () => {
    setFormData({
      patient_id: "",
      incident_type: "",
      incident_name: "",
      incident_date: format(new Date(), 'yyyy-MM-dd'),
      incident_time: format(new Date(), 'HH:mm'),
      severity: "medium",
      details: {},
      report: "",
      photo_urls: [],
      physician_notified: false,
      office_notified: false
    });
    setUploadedPhotos([]);
  };

  const updateIncidentType = (type) => {
    setFormData(prev => ({
      ...prev,
      incident_type: type,
      incident_name: type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      details: getIncidentTypeFields(type)
    }));
  };

  const getIncidentTypeFields = (type) => {
    switch (type) {
      case 'fall':
        return { location: '', witnessed: false, injury: '' };
      case 'medication_error':
        return { medication: '', error_type: '', action_taken: '' };
      case 'behavioral_change':
        return { behavior_observed: '', duration: '', triggers: '' };
      case 'safety_event':
        return { safety_concern: '', immediate_action: '' };
      default:
        return {};
    }
  };

  // Calculate statistics
  const oneMonthAgo = subMonths(new Date(), 1);
  const last30Days = incidents.filter(i => {
    if (!i.incident_date) return false; // nullable field — don't parseISO(undefined)
    const incidentDate = parseISO(i.incident_date);
    return !isNaN(incidentDate) && incidentDate >= oneMonthAgo;
  });

  const byType = incidents.reduce((acc, inc) => {
    acc[inc.incident_type] = (acc[inc.incident_type] || 0) + 1;
    return acc;
  }, {});

  const bySeverity = incidents.reduce((acc, inc) => {
    acc[inc.severity] = (acc[inc.severity] || 0) + 1;
    return acc;
  }, {});

  const recentIncidents = incidents.slice(0, 10);

  // State-reportable events get their own admin follow-up folder/section.
  const stateReportableIncidents = incidents.filter(
    (i) => i.state_reportable || i.details?.state_reportable
  );

  const getStatusColor = (status) => {
    switch (status) {
      case 'reported': return 'bg-amber-500';
      case 'under_review': return 'bg-blue-500';
      case 'resolved': return 'bg-emerald-500';
      default: return 'bg-slate-500';
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'bg-red-600 text-white';
      case 'medium': return 'bg-orange-500 text-white';
      case 'low': return 'bg-amber-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={AlertTriangle}
        eyebrow="Patient Care"
        title="Incident Reporting"
        description="Document and track safety incidents"
        favoritePage="IncidentReportingModule"
        actions={
          <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
            <DialogTrigger asChild>
              <Button className="bg-red-600 hover:bg-red-700">
                <AlertTriangle className="w-4 h-4 mr-2" />
                Report Incident
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Report New Incident</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>Patient *</Label>
                    <Select value={formData.patient_id} onValueChange={(value) => setFormData({ ...formData, patient_id: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select patient" />
                      </SelectTrigger>
                      <SelectContent>
                        {myPatients.map(patient => (
                          <SelectItem key={patient.id} value={patient.id}>
                            {patient.first_name} {patient.last_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-2">
                    <Label>Incident Type *</Label>
                    <Select value={formData.incident_type} onValueChange={updateIncidentType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fall">Fall</SelectItem>
                        <SelectItem value="medication_error">Medication Error</SelectItem>
                        <SelectItem value="behavioral_change">Behavioral Change</SelectItem>
                        <SelectItem value="infection_suspected">Infection Suspected</SelectItem>
                        <SelectItem value="refusal_of_care">Refusal of Care</SelectItem>
                        <SelectItem value="pressure_injury">Pressure Injury</SelectItem>
                        <SelectItem value="emergency_visit">Emergency Visit</SelectItem>
                        <SelectItem value="safety_event">Safety Event</SelectItem>
                        <SelectItem value="wound_concern">Wound Concern</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Date *</Label>
                    <Input
                      type="date"
                      value={formData.incident_date}
                      onChange={(e) => setFormData({ ...formData, incident_date: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <Label>Time *</Label>
                    <Input
                      type="time"
                      value={formData.incident_time}
                      onChange={(e) => setFormData({ ...formData, incident_time: e.target.value })}
                      required
                    />
                  </div>

                  <div className="col-span-2">
                    <Label>Severity *</Label>
                    <Select value={formData.severity} onValueChange={(value) => setFormData({ ...formData, severity: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low - Minor concern</SelectItem>
                        <SelectItem value="medium">Medium - Needs attention</SelectItem>
                        <SelectItem value="high">High - Immediate action required</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Dynamic fields based on incident type */}
                  {formData.incident_type === 'fall' && (
                    <>
                      <div>
                        <Label>Fall Location</Label>
                        <Input
                          placeholder="e.g., Bathroom, Bedroom"
                          value={formData.details.location || ''}
                          onChange={(e) => setFormData({
                            ...formData,
                            details: { ...formData.details, location: e.target.value }
                          })}
                        />
                      </div>
                      <div>
                        <Label>Injury Sustained</Label>
                        <Input
                          placeholder="Describe any injuries"
                          value={formData.details.injury || ''}
                          onChange={(e) => setFormData({
                            ...formData,
                            details: { ...formData.details, injury: e.target.value }
                          })}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={formData.details.witnessed || false}
                            onChange={(e) => setFormData({
                              ...formData,
                              details: { ...formData.details, witnessed: e.target.checked }
                            })}
                          />
                          <span className="text-sm">Fall was witnessed</span>
                        </label>
                      </div>
                    </>
                  )}

                  {formData.incident_type === 'medication_error' && (
                    <>
                      <div>
                        <Label>Medication Name</Label>
                        <Input
                          value={formData.details.medication || ''}
                          onChange={(e) => setFormData({
                            ...formData,
                            details: { ...formData.details, medication: e.target.value }
                          })}
                        />
                      </div>
                      <div>
                        <Label>Error Type</Label>
                        <Select
                          value={formData.details.error_type || ''}
                          onValueChange={(value) => setFormData({
                            ...formData,
                            details: { ...formData.details, error_type: value }
                          })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="wrong_dose">Wrong Dose</SelectItem>
                            <SelectItem value="wrong_time">Wrong Time</SelectItem>
                            <SelectItem value="omission">Omission</SelectItem>
                            <SelectItem value="wrong_medication">Wrong Medication</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  <div className="col-span-2">
                    <Label>Incident Report *</Label>
                    <Textarea
                      placeholder="Provide detailed description of the incident..."
                      value={formData.report}
                      onChange={(e) => setFormData({ ...formData, report: e.target.value })}
                      rows={4}
                      required
                    />
                  </div>

                  <div className="col-span-2">
                    <Label>Upload Photos (Optional)</Label>
                    <div className="mt-2">
                      <label className="flex items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-slate-400 transition-colors">
                        <div className="text-center">
                          <Camera className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                          <span className="text-sm text-slate-600">
                            {uploading ? "Uploading..." : "Click to upload photos"}
                          </span>
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={handlePhotoUpload}
                          disabled={uploading}
                        />
                      </label>
                    </div>
                    {uploadedPhotos.length > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {uploadedPhotos.map((url, idx) => (
                          <div key={idx} className="relative group">
                            <img src={url} alt={`Upload ${idx + 1}`} className="w-full h-24 object-cover rounded-lg" />
                            <button
                              type="button"
                              onClick={() => removePhoto(url)}
                              className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="col-span-2 flex items-center gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.physician_notified}
                        onChange={(e) => setFormData({ ...formData, physician_notified: e.target.checked })}
                      />
                      <span className="text-sm">Physician Notified</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.office_notified}
                        onChange={(e) => setFormData({ ...formData, office_notified: e.target.checked })}
                      />
                      <span className="text-sm">Office Notified</span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowReportDialog(false);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createIncidentMutation.isPending}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {createIncidentMutation.isPending ? "Submitting..." : "Submit Report"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Incidents" value={incidents.length} icon={AlertTriangle} tone="navy" />
        <StatCard label="Last 30 Days" value={last30Days.length} icon={Clock} tone="slate" />
        <StatCard label="High Severity" value={bySeverity.high || 0} icon={TrendingUp} tone="red" />
        <StatCard
          label="Resolved"
          value={incidents.filter(i => i.status === 'resolved').length}
          icon={CheckCircle2}
          tone="emerald"
        />
      </div>

      {/* Trends by Type */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Incident Trends by Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <div key={type} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium capitalize">
                      {type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm text-slate-600">{count}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-amber-500 h-2 rounded-full"
                      style={{ width: `${(count / incidents.length) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* State Reportable Events — admin follow-up folder */}
      {currentUser?.role === 'admin' && (
        <Card className="mb-6 border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              State Reportable Events
              <Badge className="ml-2 bg-red-600 text-white">{stateReportableIncidents.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stateReportableIncidents.length === 0 ? (
              <div className="text-center py-6 text-slate-500">
                <FileText className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                <p>No state reportable events on file.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stateReportableIncidents.map((incident) => (
                  <div key={incident.id} className="border border-red-100 rounded-lg p-4 bg-red-50/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="font-semibold text-slate-900">{incident.patient_name}</h4>
                          <Badge className={getSeverityColor(incident.severity)}>{incident.severity}</Badge>
                          <Badge className={getStatusColor(incident.status || 'reported')}>{(incident.status || 'reported').replace(/_/g, ' ')}</Badge>
                        </div>
                        <p className="text-sm text-slate-700">
                          {incident.details?.event_type || incident.incident_name}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 flex-wrap">
                          <span className="flex items-center gap-1">
                            <CalendarIcon className="w-3 h-3" />
                            {incident.incident_date ? format(parseISO(incident.incident_date), 'MMM d, yyyy') : '—'}
                            {incident.incident_time ? ` at ${incident.incident_time}` : ''}
                          </span>
                          <span>Reported by: {incident.created_by}</span>
                          {incident.state_reportable_alert_sent_at && (
                            <span className="text-emerald-700">Admins alerted</span>
                          )}
                        </div>
                        {incident.state_reportable_pdf_url && (
                          <a
                            href={incident.state_reportable_pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 mt-2 text-sm text-blue-600 underline"
                          >
                            <FileText className="w-4 h-4" /> View PDF report
                          </a>
                        )}
                      </div>
                      {incident.status !== 'resolved' && (
                        <Select
                          value={incident.status}
                          onValueChange={(newStatus) => updateIncidentMutation.mutate({ id: incident.id, updates: { status: newStatus } })}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="reported">Reported</SelectItem>
                            <SelectItem value="under_review">Under Review</SelectItem>
                            <SelectItem value="resolved">Resolved</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent Incidents */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Incidents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentIncidents.map((incident) => (
              <div key={incident.id} className="border rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-slate-900">{incident.patient_name}</h4>
                      <Badge className={getSeverityColor(incident.severity)}>
                        {incident.severity}
                      </Badge>
                      <Badge className={getStatusColor(incident.status || 'reported')}>
                        {(incident.status || 'reported').replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-600 mb-1">
                      {(incident.incident_type || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </p>
                    <p className="text-sm text-slate-700">{incident.report}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <CalendarIcon className="w-3 h-3" />
                        {incident.incident_date ? format(parseISO(incident.incident_date), 'MMM d, yyyy') : '—'} at {incident.incident_time || '—'}
                      </span>
                      <span>Reported by: {incident.created_by}</span>
                    </div>
                    {incident.photo_urls?.length > 0 && (
                      <div className="mt-3 flex gap-2">
                        {incident.photo_urls.map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt={`Incident photo ${idx + 1}`}
                            className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80"
                            onClick={() => window.open(url, '_blank')}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  {currentUser?.role === 'admin' && incident.status !== 'resolved' && (
                    <Select
                      value={incident.status}
                      onValueChange={(newStatus) => updateIncidentMutation.mutate({
                        id: incident.id,
                        updates: { status: newStatus }
                      })}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="reported">Reported</SelectItem>
                        <SelectItem value="under_review">Under Review</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ))}
            {recentIncidents.length === 0 && (
              <EmptyState icon={FileText} title="No incidents reported yet" description="Reported incidents will appear here." />
            )}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}