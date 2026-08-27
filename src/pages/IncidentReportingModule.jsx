import { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { isAdminView } from "@/lib/roles";
import { submitIncidentReport } from "@/functions/submitIncidentReport";
import { transitionIncident } from "@/functions/updateIncident";
import {
  canTransitionIncidentStatus,
  incidentNeedsCorrectiveAction,
} from "@/components/incident/incidentLifecycle";
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
import { format, subMonths } from "date-fns";
import { parseLocalDate, formatLocalDate } from "@/lib/dateLocal";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { isSafeExternalUrl, openExternalUrl } from "@/components/utils/security";

const STATUS_OPTIONS = [
  { value: "reported", label: "Reported" },
  { value: "under_review", label: "Under Review" },
  { value: "corrective_action", label: "Corrective Action" },
  { value: "resolved", label: "Resolved" },
];

/**
 * Only offer transitions this dropdown can actually complete. It sends a bare
 * to_status, so it cannot satisfy the corrective-action requirement -- offering
 * "Resolved" on a high-severity or state-reportable incident with no plan on
 * file guarantees a 400. Those go through the CAP-aware review queue instead.
 * Backward moves are excluded because the lifecycle graph rejects them.
 */
function allowedStatusOptions(incident) {
  const from = incident.status || "reported";
  return STATUS_OPTIONS.filter((option) => {
    if (option.value === from) return true;
    if (!canTransitionIncidentStatus(from, option.value)) return false;
    if (
      option.value === "resolved"
      && incidentNeedsCorrectiveAction(incident)
      && !String(incident.corrective_action_plan || "").trim()
    ) return false;
    return true;
  });
}

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

  // Narrowing to the caller's own charts happens in `select`, so the fetched
  // roster stays identical to every other 2000-row consumer and shares its
  // cache entry. The email no longer needs to be in the key: `select` runs per
  // render against whoever is signed in now, rather than being baked into a
  // cached result that a session change would keep serving.
  // useCallback, not an inline arrow: React Query memoizes `select` by
  // reference, so a fresh arrow each render re-filters all 2000 rows every render.
  const selectMine = useCallback(
    (rows) => rows.filter(p => p.assigned_nurses?.includes(currentUser?.email)),
    [currentUser?.email],
  );

  const { data: myPatients = [] } = useScopedPatients({
    sort: '-updated_date',
    limit: 2000,
    select: selectMine,
  });

  const { data: incidents = [], _isLoading } = useAgencyScopedQuery({
    queryKey: ['incidents'],
    fetch: () => base44.entities.Incident.list('-created_date', 5000),
    initialData: [],
  });

  const { data: patients = [] } = useScopedPatients({ sort: '-updated_date', limit: 2000 });

  const createIncidentMutation = useMutation({
    mutationFn: async (incidentData) => {
      // Route through the service-role backend: it creates the incident AND (for
      // high severity) looks up admins and notifies them server-side. A client
      // User.filter is blocked by RLS for non-admin reporters, so the manager
      // alert never fired for nurses when done here.
      const highSeverity = incidentData.severity === 'high';
      const res = await submitIncidentReport({
        patient_id: incidentData.patient_id,
        patient_name: incidentData.patient_name,
        incident_type: incidentData.incident_type,
        incident_name: incidentData.incident_name,
        incident_date: incidentData.incident_date,
        incident_time: incidentData.incident_time,
        severity: incidentData.severity,
        details: incidentData.details,
        report: incidentData.report,
        photo_urls: incidentData.photo_urls,
        physician_notified: incidentData.physician_notified,
        // Send what the reporter actually checked — omitting it left the stored
        // compliance flag derived from severity alone, contradicting the form.
        office_notified: incidentData.office_notified,
        immediate_alert: highSeverity,
      });
      const data = res?.data || res || {};
      return { incident: data.incident, managersNotified: highSeverity };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['admin-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['my-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incidentsForKPI'] });
      queryClient.invalidateQueries({ queryKey: ['all-incidents'] });
      setShowReportDialog(false);
      resetForm();
      // Only claim managers were notified when the alert actually went out.
      toast.success(
        result?.managersNotified
          ? "Incident reported successfully. Clinical managers have been notified."
          : "Incident reported successfully."
      );
    },
    onError: () => {
      toast.error("Failed to submit incident report");
    }
  });

  // This dropdown set `status` directly, which skipped the lifecycle graph and
  // the corrective-action requirement entirely. Route it through the function
  // so an invalid or unaccompanied transition is refused server-side.
  const updateIncidentMutation = useMutation({
    mutationFn: ({ id, updates }) => {
      // Fail here rather than sending to_status: undefined and surfacing the
      // server's generic 400 to a user who picked a status.
      if (!updates?.status) throw new Error('No status selected for this incident.');
      return transitionIncident({ incidentId: id, toStatus: updates.status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['admin-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['my-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incidentsForKPI'] });
      queryClient.invalidateQueries({ queryKey: ['all-incidents'] });
      toast.success("Incident status updated");
    },
    onError: (e) => toast.error(e?.message || "Couldn't update the incident status"),
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
    if (!i.incident_date) return false;
    const incidentDate = parseLocalDate(i.incident_date);
    return incidentDate && incidentDate >= oneMonthAgo;
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
      case 'reported': return 'bg-amber-100 text-amber-800 border border-amber-200';
      case 'under_review': return 'bg-blue-100 text-blue-800 border border-blue-200';
      case 'corrective_action': return 'bg-purple-100 text-purple-800 border border-purple-200';
      case 'resolved': return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      default: return 'bg-slate-100 text-slate-800 border border-slate-200';
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-800 border border-red-200';
      case 'medium': return 'bg-orange-100 text-orange-800 border border-orange-200';
      case 'low': return 'bg-amber-100 text-amber-800 border border-amber-200';
      default: return 'bg-slate-100 text-slate-800 border border-slate-200';
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
                        {uploadedPhotos.filter((url) => isSafeExternalUrl(url) || (typeof url === 'string' && url.startsWith('blob:'))).map((url, idx) => (
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
      {isAdminView(currentUser) && (
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
                            {incident.incident_date ? (formatLocalDate(incident.incident_date, { month: 'short', day: 'numeric', year: 'numeric' }) || '—') : '—'}
                            {incident.incident_time ? ` at ${incident.incident_time}` : ''}
                          </span>
                          <span>Reported by: {incident.created_by}</span>
                          {incident.state_reportable_alert_sent_at && (
                            <span className="text-emerald-700">Admins alerted</span>
                          )}
                        </div>
                        {incident.state_reportable_pdf_url && isSafeExternalUrl(incident.state_reportable_pdf_url) && (
                          <a
                            href={incident.state_reportable_pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-2 text-sm text-blue-600 underline hover:text-blue-700"
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
                            {allowedStatusOptions(incident).map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
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
                        {incident.incident_date ? (formatLocalDate(incident.incident_date, { month: 'short', day: 'numeric', year: 'numeric' }) || '—') : '—'} at {incident.incident_time || '—'}
                      </span>
                      <span>Reported by: {incident.created_by}</span>
                    </div>
                    {incident.photo_urls?.length > 0 && (
                      <div className="mt-3 flex gap-2">
                        {incident.photo_urls.filter((url) => isSafeExternalUrl(url)).map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt={`Incident photo ${idx + 1}`}
                            className="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-80"
                            onClick={() => openExternalUrl(url)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  {isAdminView(currentUser) && incident.status !== 'resolved' && (
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
                        {allowedStatusOptions(incident).map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
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