import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

// The entity schema's own visit_type enum (base44/entities/TelehealthSession.jsonc).
const VISIT_TYPES = [
  ["routine_followup", "Routine Follow-up"], ["urgent_care", "Urgent Care"],
  ["medication_review", "Medication Review"], ["care_plan_review", "Care Plan Review"],
  ["admission_assessment", "Admission Assessment"], ["discharge_planning", "Discharge Planning"],
];

export default function NewSessionForm({ onCreate, saving, defaultPatientName = "", patientId }) {
  const [form, setForm] = useState({ patient_name: defaultPatientName, scheduled_at: "", visit_type: "routine_followup", chief_complaint: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    onCreate({
      ...form,
      patient_id: patientId || undefined,
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : undefined,
    });
  };

  return (
    <form onSubmit={submit} className="modern-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <Label htmlFor="telehealth-patient-name">Patient name</Label>
        <Input id="telehealth-patient-name" required value={form.patient_name} onChange={set("patient_name")} maxLength={200} />
      </div>
      <div>
        <Label htmlFor="telehealth-scheduled-at">Date and time (blank means now)</Label>
        <Input id="telehealth-scheduled-at" type="datetime-local" value={form.scheduled_at} onChange={set("scheduled_at")} />
      </div>
      <div>
        <Label htmlFor="telehealth-visit-type">Visit type</Label>
        <select id="telehealth-visit-type" className="w-full h-10 rounded-md border px-3 bg-background" value={form.visit_type} onChange={set("visit_type")}>
          {VISIT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="telehealth-chief-complaint">Chief complaint</Label>
        <Input id="telehealth-chief-complaint" value={form.chief_complaint} onChange={set("chief_complaint")} maxLength={2000} />
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Schedule visit</Button>
      </div>
    </form>
  );
}
