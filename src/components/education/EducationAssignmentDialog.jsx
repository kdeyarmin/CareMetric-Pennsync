import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

const DELIVERY_METHODS = [
  { value: "in_person", label: "In-Person" },
  { value: "via_portal", label: "Via Patient Portal" },
  { value: "printed", label: "Printed Copy" },
  { value: "email", label: "Email" },
  { value: "video_call", label: "Video Call" },
  { value: "phone", label: "Phone" }
];

export default function EducationAssignmentDialog({
  material,
  patientId,
  carePlans = [],
  onClose,
  onAssigned
}) {
  const [selectedCarePlan, setSelectedCarePlan] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [patientUnderstood, setPatientUnderstood] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleAssign = async () => {
    if (!deliveryMethod) {
      toast.error("Please select a delivery method");
      return;
    }

    setLoading(true);
    try {
      const user = await base44.auth.me();

      const assignmentData = {
        patient_id: patientId,
        education_material_id: material.id,
        material_title: material.title,
        care_plan_id: selectedCarePlan || null,
        care_plan_problem: carePlans.find(cp => cp.id === selectedCarePlan)?.problem || null,
        assigned_by: user.email,
        assigned_date: new Date().toISOString(),
        delivery_method: deliveryMethod,
        provided_date: new Date().toISOString(),
        notes: notes || null,
        patient_understood: patientUnderstood,
        follow_up_needed: patientUnderstood === false,
        status: "provided"
      };

      await base44.entities.PatientEducationAssignment.create(assignmentData);

      // Create follow-up task if needed
      if (patientUnderstood === false) {
        await base44.entities.Task.create({
          patient_id: patientId,
          title: `Follow-up: ${material.title} - Patient needs clarification`,
          description: `Patient did not fully understand "${material.title}" provided via ${deliveryMethod}. Notes: ${notes}`,
          type: "followup",
          priority: "medium",
          due_timeframe: "next_visit",
          source: "ai_generated",
          status: "pending"
        });
      }

      toast.success("Education assignment tracked");
      onAssigned?.(assignmentData);
      onClose();
    } catch (error) {
      console.error("Error assigning education:", error);
      toast.error("Failed to assign education");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg">Assign Education Material</CardTitle>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Material Info */}
          <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
            <h4 className="font-semibold text-sm mb-1">{material.title}</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {material.description}
            </p>
            {material.category && (
              <Badge variant="outline" className="text-xs mt-2">
                {material.category}
              </Badge>
            )}
          </div>

          {/* Care Plan Assignment */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Link to Care Plan (Optional)
            </label>
            <Select value={selectedCarePlan} onValueChange={setSelectedCarePlan}>
              <SelectTrigger>
                <SelectValue placeholder="Select a care plan..." />
              </SelectTrigger>
              <SelectContent>
                {carePlans.map((cp) => (
                  <SelectItem key={cp.id} value={cp.id}>
                    {cp.problem} - {cp.goal}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Delivery Method */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Delivery Method *</label>
            <Select value={deliveryMethod} onValueChange={setDeliveryMethod}>
              <SelectTrigger>
                <SelectValue placeholder="How was this provided?" />
              </SelectTrigger>
              <SelectContent>
                {DELIVERY_METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Patient Understanding */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Patient Understanding</label>
            <div className="flex gap-2">
              <Button
                variant={patientUnderstood === true ? "default" : "outline"}
                size="sm"
                onClick={() => setPatientUnderstood(true)}
                className="flex-1"
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Understood
              </Button>
              <Button
                variant={patientUnderstood === false ? "destructive" : "outline"}
                size="sm"
                onClick={() => setPatientUnderstood(false)}
                className="flex-1"
              >
                Needs Clarification
              </Button>
              <Button
                variant={patientUnderstood === null ? "default" : "outline"}
                size="sm"
                onClick={() => setPatientUnderstood(null)}
                className="flex-1"
              >
                Not Assessed
              </Button>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Notes</label>
            <Textarea
              placeholder="Add any notes about the education session..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-24 text-sm"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={loading || !deliveryMethod}
              className="flex-1 bg-teal-600 hover:bg-teal-700"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Assign & Track
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}