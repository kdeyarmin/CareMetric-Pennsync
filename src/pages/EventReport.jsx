import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { submitStateReportableIncident } from "@/functions/submitStateReportableIncident";
import { submitIncidentReport } from "@/functions/submitIncidentReport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Send, Loader2, AlertTriangle } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

export default function EventReport() {
  const { data: _currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    patient_id: "",
    date_of_event: "",
    time_of_event: "",
    event_type: "",
    event_type_id: "",
    location_of_event: "",
    medications: "",
    diagnosis: "",
    factual_description: "",
    follow_up_action: "",
    submitted_by: "",
    submitter_title: "",
    state_reportable: "",
  });

  const eventTypes = [
    { id: "HE", description: "Complaint of Patient/Resident Abuse, Confirmed or Not" },
    { id: "HA", description: "Death Due To Injury, Suicide, or Unusual Circumstances While a Patient/Resident" },
    { id: "HB", description: "Death Due to Malnutrition, Dehydration or Sepsis" },
    { id: "HC", description: "Death Due to a Medication Error or Adverse Reaction to Medication" },
    { id: "IW", description: "Health Department Reportable Diseases" },
    { id: "IQ", description: "Misappropriation of Patient/Resident Property" },
    { id: "18", description: "Other" },
    { id: "02", description: "Patient/Resident Neglect" },
    { id: "HF", description: "Rape" },
    { id: "IE", description: "Transfer/Admission to Hospital Because of Injury/Accident" },
    { id: "HQ", description: "Unlicensed Practice of a Regulated Professional" },
  ];

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const validateForm = () => {
    const required = [
      'patient_id', 'date_of_event', 'time_of_event', 'event_type',
      'location_of_event', 'factual_description', 'follow_up_action',
      'submitted_by', 'submitter_title', 'state_reportable'
    ];
    
    for (const field of required) {
      if (!formData[field]) {
        toast.error(`Please fill in all required fields marked with *`);
        return false;
      }
    }
    
    if (formData.medications && formData.medications.length > 500) {
      toast.error("Name and Frequency of Medication(s) must be 500 characters or less");
      return false;
    }
    
    if (formData.diagnosis && formData.diagnosis.length > 250) {
      toast.error("Diagnosis of Resident/Patient must be 250 characters or less");
      return false;
    }
    
    if (formData.factual_description.length > 3500) {
      toast.error("Factual Description must be 3500 characters or less");
      return false;
    }
    
    if (formData.follow_up_action.length > 3500) {
      toast.error("Description of Follow-up Action must be 3500 characters or less");
      return false;
    }
    
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setIsSubmitting(true);

    try {
      // Resolve the real patient name from the entered id. The id is required, so
      // a non-matching id is a hard validation failure (we must not store the raw
      // id string as the patient's name).
      let patient = null;
      try {
        const matches = await base44.entities.Patient.filter({ id: formData.patient_id });
        patient = matches?.[0] || null;
      } catch (lookupErr) {
        console.error('Patient lookup failed:', lookupErr);
      }

      if (!patient) {
        toast.error("Could not find a patient with that Patient ID. Please verify the ID.");
        setIsSubmitting(false);
        return;
      }

      const patientName = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim()
        || patient.full_name
        || patient.name
        || formData.patient_id;

      // State-reportable events take the reliable server-side path (persist +
      // retained PDF + immediate admin email). Other event reports still persist
      // server-side and notify admins in-app, but without the urgent email/PDF.
      const isStateReportable = formData.state_reportable === "Yes";

      // Send the enum/code value (e.g. "HE"), not the long human-readable label.
      const eventTypeCode = formData.event_type_id;

      let result;
      if (isStateReportable) {
        result = await submitStateReportableIncident({
          patient_id: formData.patient_id,
          patient_name: patientName,
          event_type: eventTypeCode,
          event_type_id: formData.event_type_id,
          event_date: formData.date_of_event,
          event_time: formData.time_of_event,
          location_of_event: formData.location_of_event,
          medications: formData.medications,
          diagnosis: formData.diagnosis,
          factual_description: formData.factual_description,
          followup_action: formData.follow_up_action,
          submitted_by_name: formData.submitted_by,
          submitted_by_title: formData.submitter_title,
          source: "event_report",
        });
      } else {
        result = await submitIncidentReport({
          patient_id: formData.patient_id,
          patient_name: patientName,
          incident_type: "other",
          incident_name: formData.event_type,
          incident_date: formData.date_of_event,
          incident_time: formData.time_of_event,
          severity: "medium",
          report: `Event Type: ${formData.event_type}\n\nLocation: ${formData.location_of_event}\n\nFactual Description:\n${formData.factual_description}\n\nFollow-up Action:\n${formData.follow_up_action}\n\nSubmitted By: ${formData.submitted_by} (${formData.submitter_title})`,
          details: {
            event_type_id: formData.event_type_id,
            location: formData.location_of_event,
            medications: formData.medications,
            diagnosis: formData.diagnosis,
            submitter: formData.submitted_by,
            submitter_title: formData.submitter_title,
            state_reportable: false,
          },
          immediate_alert: false,
        });
      }

      const data = result?.data || result || {};
      if (isStateReportable) {
        if ((data.admin_count ?? 0) > 0 && (data.emails_sent ?? 0) === 0) {
          toast.warning("Event report saved, but admin email alerts could not be sent. Please notify your administrator directly.");
        } else {
          toast.success("State reportable event submitted. A PDF copy was retained and administrators were alerted immediately.");
        }
      } else {
        toast.success("Event report submitted and administrators have been notified.");
      }
      
      // Reset form
      setFormData({
        patient_id: "",
        date_of_event: "",
        time_of_event: "",
        event_type: "",
        event_type_id: "",
        location_of_event: "",
        medications: "",
        diagnosis: "",
        factual_description: "",
        follow_up_action: "",
        submitted_by: "",
        submitter_title: "",
        state_reportable: "",
      });
      
    } catch (error) {
      toast.error("Failed to submit event report. Please try again.");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (window.confirm("Are you sure you want to cancel? All entered data will be lost.")) {
      setFormData({
        patient_id: "",
        date_of_event: "",
        time_of_event: "",
        event_type: "",
        event_type_id: "",
        location_of_event: "",
        medications: "",
        diagnosis: "",
        factual_description: "",
        follow_up_action: "",
        submitted_by: "",
        submitter_title: "",
        state_reportable: "",
      });
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={AlertTriangle}
        title="Event Report"
        description='Fields preceded with "*" are required.'
        actions={
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        }
      />
      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Patient ID */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <Label className="text-red-600">*Patient ID:</Label>
              <Input
                value={formData.patient_id}
                onChange={(e) => handleChange('patient_id', e.target.value)}
                required
              />
            </div>

            {/* Date of Event */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <Label className="text-red-600">*Date of Event (mm/dd/yyyy):</Label>
              <Input
                type="date"
                value={formData.date_of_event}
                onChange={(e) => handleChange('date_of_event', e.target.value)}
                required
              />
            </div>

            {/* Time of Event */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <Label className="text-red-600">*Time of Event (military h:mm):</Label>
              <Input
                type="time"
                value={formData.time_of_event}
                onChange={(e) => handleChange('time_of_event', e.target.value)}
                required
              />
            </div>

            {/* Event Type */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div>
                <Label className="text-red-600">*Event Type:</Label>
                <p className="text-xs text-slate-500 mt-1">
                  Each option below shows its full description.
                </p>
              </div>
              <Select
                value={formData.event_type_id}
                onValueChange={(value) => {
                  const selectedType = eventTypes.find(t => t.id === value);
                  handleChange('event_type_id', value);
                  handleChange('event_type', selectedType ? `${selectedType.id} - ${selectedType.description}` : '');
                }}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select event type..." />
                </SelectTrigger>
                <SelectContent>
                  {eventTypes.map(type => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.id} - {type.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* State Reportable */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <Label className="text-red-600">*Is this State Reportable?</Label>
              <Select
                value={formData.state_reportable}
                onValueChange={(value) => handleChange('state_reportable', value)}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Location of Event */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <Label className="text-red-600">*Location of Event:</Label>
              <Input
                value={formData.location_of_event}
                onChange={(e) => handleChange('location_of_event', e.target.value)}
                required
                className="md:col-span-1"
              />
            </div>

            {/* Medications */}
            <div className="space-y-2">
              <Label>
                Name and Frequency of Medication(s):<br />
                <span className="text-xs text-slate-600">(maximum 500 characters)</span>
              </Label>
              <Textarea
                value={formData.medications}
                onChange={(e) => handleChange('medications', e.target.value)}
                maxLength={500}
                rows={4}
                className="w-full"
              />
              <p className="text-xs text-slate-500 text-right">{formData.medications.length}/500</p>
            </div>

            {/* Diagnosis */}
            <div className="space-y-2">
              <Label>
                Diagnosis of Resident/Patient:<br />
                <span className="text-xs text-slate-600">(maximum 250 characters)</span>
              </Label>
              <Textarea
                value={formData.diagnosis}
                onChange={(e) => handleChange('diagnosis', e.target.value)}
                maxLength={250}
                rows={4}
                className="w-full"
              />
              <p className="text-xs text-slate-500 text-right">{formData.diagnosis.length}/250</p>
            </div>

            {/* Factual Description */}
            <div className="space-y-2">
              <Label className="text-red-600">
                *Factual Description:<br />
                <span className="text-xs text-slate-600">(maximum 3500 characters)</span>
              </Label>
              <Textarea
                value={formData.factual_description}
                onChange={(e) => handleChange('factual_description', e.target.value)}
                maxLength={3500}
                rows={6}
                required
                className="w-full"
              />
              <p className="text-xs text-slate-500 text-right">{formData.factual_description.length}/3500</p>
            </div>

            {/* Follow-up Action */}
            <div className="space-y-2">
              <Label className="text-red-600">
                *Description of Follow-up Action:<br />
                <span className="text-xs text-slate-600">(maximum 3500 characters)</span>
              </Label>
              <Textarea
                value={formData.follow_up_action}
                onChange={(e) => handleChange('follow_up_action', e.target.value)}
                maxLength={3500}
                rows={6}
                required
                className="w-full"
              />
              <p className="text-xs text-slate-500 text-right">{formData.follow_up_action.length}/3500</p>
            </div>

            {/* Submitted By */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <Label className="text-red-600">*Submitted By:</Label>
              <Input
                value={formData.submitted_by}
                onChange={(e) => handleChange('submitted_by', e.target.value)}
                required
              />
            </div>

            {/* Submitter's Title */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <Label className="text-red-600">*Submitter's Title:</Label>
              <Input
                value={formData.submitter_title}
                onChange={(e) => handleChange('submitter_title', e.target.value)}
                required
              />
            </div>

            {/* Note */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
              <p className="text-sm font-medium text-slate-900">
                Note: An event will not be considered submitted until you receive a confirmation that includes an event number.
              </p>
            </div>

            {/* Submit Button */}
            <div className="flex justify-center">
              <Button 
                type="submit" 
                disabled={isSubmitting}
                className="min-w-[120px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Submit
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  );
}