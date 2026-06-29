import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { submitIncidentReport } from "@/functions/submitIncidentReport";
import { submitStateReportableIncident } from "@/functions/submitStateReportableIncident";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Camera, Send, Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import SearchablePatientSelect from "@/components/ui/SearchablePatientSelect";
import IncidentPhotoCapture from "@/components/incident/IncidentPhotoCapture";
import StateReportableBanner from "@/components/incident/StateReportableBanner";
import {
  INCIDENT_TYPES,
  STATE_REPORTABLE_EVENT_TYPES,
  getStateReportableCategory,
} from "@/components/incident/stateReportableConfig";

const getCurrentDate = () => new Date().toISOString().slice(0, 10);
const getCurrentTime = () => new Date().toTimeString().slice(0, 5);

const blankForm = () => ({
  patient_id: "",
  incident_type: "safety_event",
  severity: "high",
  incident_date: getCurrentDate(),
  incident_time: getCurrentTime(),
  incident_name: "",
  location: "",
  report: "",
  // State-reportable extras (only required when the event is reportable)
  state_event_type: "",
  medications: "",
  diagnosis: "",
  followup_action: "",
  immediate_alert: true,
  physician_notified: false,
});

export default function SmartIncidentForm({ patients = [], currentUser, onSubmitted }) {
  const [photoFiles, setPhotoFiles] = useState([]);
  const [form, setForm] = useState(blankForm());
  const [submitted, setSubmitted] = useState(false);
  const ai = useAICall();
  const [errorMessage, setErrorMessage] = useState("");

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const selectedPatient = useMemo(
    () => patients.find((p) => p.id === form.patient_id),
    [patients, form.patient_id]
  );
  const patientName = selectedPatient
    ? `${selectedPatient.first_name || ""} ${selectedPatient.last_name || ""}`.trim()
    : "";

  // The event is state-reportable if the chosen type maps to a category, OR the
  // nurse explicitly picked a state-reportable event category.
  const suggestedCategory = getStateReportableCategory(form.incident_type);
  const isStateReportable = !!suggestedCategory || !!form.state_event_type;
  const effectiveCategory = form.state_event_type || suggestedCategory || "";

  const generateNarrative = async () => {
    try {
      const text = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Write a professional, objective home-health incident report narrative.

INCIDENT TYPE: ${INCIDENT_TYPES.find((t) => t.value === form.incident_type)?.label}
DATE/TIME: ${form.incident_date} at ${form.incident_time}
PATIENT: ${patientName || "Patient"}
LOCATION: ${form.location || "Not specified"}
SHORT TITLE: ${form.incident_name || "N/A"}
NURSE NOTES: ${form.report || "None provided"}

Produce a clear narrative that summarizes the event, objective observations, immediate
actions taken, and who was notified. Objective facts only. Return report text only, no JSON.`,
      });
      update({ report: text });
    } catch {
      toast.error("Could not generate the narrative. Please write it manually.");
    }
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage("");
      const photo_urls = await Promise.all(
        photoFiles.map(async (file) => {
          const result = await base44.integrations.Core.UploadFile({ file });
          return result.file_url;
        })
      );

      // State-reportable events route through the compliance path: persists the
      // incident, generates + retains a PDF, emails all admins, and creates an
      // in-app admin alert.
      if (isStateReportable) {
        return submitStateReportableIncident({
          patient_id: form.patient_id,
          patient_name: patientName,
          event_type: effectiveCategory,
          event_date: form.incident_date,
          event_time: form.incident_time,
          location_of_event: form.location,
          medications: form.medications,
          diagnosis: form.diagnosis,
          factual_description: form.report,
          followup_action: form.followup_action,
          submitted_by_name: currentUser?.full_name,
          source: "smart_incident_form",
        });
      }

      // Standard incident path.
      return submitIncidentReport({
        patient_id: form.patient_id,
        patient_name: patientName,
        incident_type: form.incident_type,
        incident_name:
          form.incident_name || INCIDENT_TYPES.find((t) => t.value === form.incident_type)?.label,
        incident_date: form.incident_date,
        incident_time: form.incident_time,
        severity: form.severity,
        report: form.report,
        photo_urls,
        physician_notified: form.physician_notified,
        immediate_alert: form.immediate_alert,
        details: {
          reported_by: currentUser?.full_name || currentUser?.email,
          location: form.location,
        },
      });
    },
    onSuccess: () => {
      setSubmitted(true);
      setPhotoFiles([]);
      onSubmitted?.();
    },
    onError: (error) => {
      // A patient-safety incident that looks submitted but isn't is dangerous —
      // surface the failure and keep the entered data so it can be retried.
      setErrorMessage(
        error?.message ||
          "Failed to submit the incident report. Please check your connection and try again — your entry has been kept."
      );
    },
  });

  // Required fields differ for the state-reportable path (follow-up action is
  // legally required there).
  const canSubmit =
    form.patient_id &&
    form.report?.trim() &&
    (!isStateReportable || (form.location?.trim() && form.followup_action?.trim()));

  if (submitted) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-8 text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
          <h3 className="text-lg font-bold text-green-800">Incident Reported</h3>
          <p className="text-sm text-green-700 max-w-md mx-auto">
            {isStateReportable
              ? "State reportable event saved. A PDF was emailed to administrators and an in-app alert was created. Keep a copy for your records and notify your supervisor."
              : "Your incident report was submitted and the clinical admin team was alerted."}
          </p>
          <Button onClick={() => { setForm(blankForm()); setSubmitted(false); }}>
            Report Another Incident
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg border-red-100">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          Report an Incident
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isStateReportable && <StateReportableBanner category={effectiveCategory} />}

        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <span className="text-sm font-medium text-slate-700">Patient</span>
          <SearchablePatientSelect
            patients={patients}
            value={form.patient_id}
            onValueChange={(value) => update({ patient_id: value })}
            placeholder="Select patient"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="incident-type" className="text-sm font-medium text-slate-700">Incident type</label>
            <Select value={form.incident_type} onValueChange={(value) => update({ incident_type: value, state_event_type: "" })}>
              <SelectTrigger id="incident-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INCIDENT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="incident-severity" className="text-sm font-medium text-slate-700">Severity</label>
            <Select value={form.severity} onValueChange={(value) => update({ severity: value })}>
              <SelectTrigger id="incident-severity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Let the nurse explicitly flag/confirm a state-reportable category even
            when the incident type alone wouldn't trigger it. */}
        <div className="space-y-2">
          <label htmlFor="state-reportable-category" className="text-sm font-medium text-slate-700">
            State reportable category <span className="text-slate-400 font-normal">(if applicable)</span>
          </label>
          <Select
            value={form.state_event_type || "none"}
            onValueChange={(value) => update({ state_event_type: value === "none" ? "" : value })}
          >
            <SelectTrigger id="state-reportable-category"><SelectValue placeholder="Not state reportable" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not state reportable</SelectItem>
              {STATE_REPORTABLE_EVENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="incident-date" className="text-sm font-medium text-slate-700">Date</label>
            <Input id="incident-date" type="date" value={form.incident_date} onChange={(e) => update({ incident_date: e.target.value })} />
          </div>
          <div className="space-y-2">
            <label htmlFor="incident-time" className="text-sm font-medium text-slate-700">Time</label>
            <Input id="incident-time" type="time" value={form.incident_time} onChange={(e) => update({ incident_time: e.target.value })} />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="incident-name" className="text-sm font-medium text-slate-700">Short title</label>
          <Input
            id="incident-name"
            value={form.incident_name}
            onChange={(e) => update({ incident_name: e.target.value })}
            placeholder="Example: New sacral wound observed"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="incident-location" className="text-sm font-medium text-slate-700">
            {isStateReportable ? "Location of event" : "Location"}
            {isStateReportable && <span className="text-red-600"> *</span>}
          </label>
          <Input
            id="incident-location"
            value={form.location}
            onChange={(e) => update({ location: e.target.value })}
            placeholder="Example: Bathroom near shower"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="incident-report" className="text-sm font-medium text-slate-700">
              Narrative report{isStateReportable && <span className="text-red-600"> *</span>}
            </label>
            <Button type="button" variant="outline" size="sm" onClick={generateNarrative} disabled={ai.loading}>
              {ai.loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
              AI assist
            </Button>
          </div>
          <Textarea
            id="incident-report"
            rows={6}
            value={form.report}
            onChange={(e) => update({ report: e.target.value })}
            placeholder="Describe what happened, what you observed, actions taken, and who was notified. Or jot notes and tap AI assist."
          />
        </div>

        {/* Extra legally-required fields, only for state-reportable events. */}
        {isStateReportable && (
          <div className="space-y-4 rounded-xl border border-red-200 bg-red-50/50 p-4">
            <div className="space-y-2">
              <label htmlFor="incident-medications" className="text-sm font-medium text-slate-700">Medications (name & frequency)</label>
              <Textarea id="incident-medications" rows={3} maxLength={600} value={form.medications} onChange={(e) => update({ medications: e.target.value })} placeholder="List current medications and frequency..." />
            </div>
            <div className="space-y-2">
              <label htmlFor="incident-diagnosis" className="text-sm font-medium text-slate-700">Diagnosis</label>
              <Textarea id="incident-diagnosis" rows={2} maxLength={250} value={form.diagnosis} onChange={(e) => update({ diagnosis: e.target.value })} placeholder="Primary and secondary diagnoses..." />
            </div>
            <div className="space-y-2">
              <label htmlFor="incident-followup-action" className="text-sm font-medium text-slate-700">Follow-up action <span className="text-red-600">*</span></label>
              <Textarea id="incident-followup-action" rows={4} maxLength={3500} value={form.followup_action} onChange={(e) => update({ followup_action: e.target.value })} placeholder="Describe actions taken or planned in response to this event..." />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Camera className="w-4 h-4" />
            Photo capture
          </div>
          <IncidentPhotoCapture files={photoFiles} onFilesChange={setPhotoFiles} />
        </div>

        {!isStateReportable && (
          <div className="space-y-3 rounded-xl border bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <Checkbox checked={form.immediate_alert} onCheckedChange={(c) => update({ immediate_alert: !!c })} />
              <div>
                <p className="text-sm font-medium text-slate-900">Trigger immediate admin alert</p>
                <p className="text-xs text-slate-500">Creates urgent notifications for clinical admins right away.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox checked={form.physician_notified} onCheckedChange={(c) => update({ physician_notified: !!c })} />
              <div>
                <p className="text-sm font-medium text-slate-900">Physician already notified</p>
                <p className="text-xs text-slate-500">Document that you already contacted the provider.</p>
              </div>
            </div>
          </div>
        )}

        <Button
          className="w-full min-h-[52px] bg-red-600 hover:bg-red-700"
          disabled={!canSubmit || submitMutation.isPending}
          onClick={() => submitMutation.mutate()}
        >
          <Send className="w-4 h-4 mr-2" />
          {submitMutation.isPending
            ? "Submitting..."
            : isStateReportable
              ? "Submit State Reportable Event"
              : "Submit incident report"}
        </Button>
      </CardContent>
    </Card>
  );
}