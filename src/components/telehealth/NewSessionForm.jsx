import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

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
      patient_id: patientId,
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : undefined,
    });
  };

  return (
    <form onSubmit={submit} className="modern-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div><Label>Patient name</Label><Input required value={form.patient_name} onChange={set("patient_name")} /></div>
      <div><Label>Date & time (blank = now)</Label><Input type="datetime-local" value={form.scheduled_at} onChange={set("scheduled_at")} /></div>
      <div>
        <Label>Visit type</Label>
        <select className="w-full h-10 rounded-md border px-3 bg-background" value={form.visit_type} onChange={set("visit_type")}>
          {VISIT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div><Label>Chief complaint</Label><Input value={form.chief_complaint} onChange={set("chief_complaint")} /></div>
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Schedule visit</Button>
      </div>
    </form>
  );
}