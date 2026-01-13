import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { getVisitTypesForProvider } from "@/components/utils/providerVisitTypeMapping";

export default function CreateAppointmentDialog({ 
  open: controlledOpen, 
  onOpenChange, 
  onAppointmentCreated,
  defaultAppointmentType,
  currentUser: providedUser
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  
  const [formData, setFormData] = useState({
    patient_id: "",
    appointment_date: "",
    start_time: "",
    end_time: "",
    appointment_type: defaultAppointmentType || "in_person",
    visit_type: "routine_visit",
    notes: ""
  });

  const queryClient = useQueryClient();

  const { data: fetchedUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
    enabled: !providedUser
  });
  
  const currentUser = providedUser || fetchedUser;

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list('first_name', 1000)
  });

  const providerType = currentUser?.credential_type || 'RN';
  const availableVisitTypes = getVisitTypesForProvider(providerType);

  const createAppointmentMutation = useMutation({
    mutationFn: async (data) => {
      const appointment = await base44.entities.Appointment.create(data);
      
      // If telehealth, create room and send invite
      if (data.appointment_type === 'telehealth') {
        const roomResponse = await base44.functions.invoke('createTwilioVideoRoom', {
          roomName: `appointment_${appointment.id}`,
          patientId: data.patient_id,
          appointmentId: appointment.id
        });
        
        if (roomResponse.data?.roomSid) {
          await base44.entities.Appointment.update(appointment.id, {
            telehealth_room_id: roomResponse.data.roomSid
          });
        }

        // Send telehealth invite email
        const patient = patients.find(p => p.id === data.patient_id);
        if (patient && patient.email) {
          await base44.functions.invoke('sendTelehealthInvite', {
            appointmentId: appointment.id,
            patientEmail: patient.email,
            patientName: `${patient.first_name} ${patient.last_name}`,
            providerName: currentUser.full_name,
            appointmentDate: data.appointment_date,
            startTime: data.start_time,
            endTime: data.end_time
          });
        }
      }
      
      return appointment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["telehealthAppointments"] });
      toast.success("Appointment created and invite sent");
      if (onAppointmentCreated) onAppointmentCreated();
      setOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast.error(`Failed to create appointment: ${error.message}`);
    }
  });

  const resetForm = () => {
    setFormData({
      patient_id: "",
      appointment_date: "",
      start_time: "",
      end_time: "",
      appointment_type: "in_person",
      visit_type: "routine_visit",
      notes: ""
    });
  };

  const handleSubmit = () => {
    if (!formData.patient_id || !formData.appointment_date || !formData.start_time) {
      toast.error("Please fill in all required fields");
      return;
    }

    createAppointmentMutation.mutate({
      ...formData,
      provider_email: currentUser.email,
      status: "scheduled"
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1" />
            New Appointment
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Appointment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>Patient *</Label>
              <select
                value={formData.patient_id}
                onChange={(e) => setFormData({ ...formData, patient_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">Select patient...</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Date *</Label>
              <Input
                type="date"
                value={formData.appointment_date}
                onChange={(e) => setFormData({ ...formData, appointment_date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Appointment Type *</Label>
              <select
                value={formData.appointment_type}
                onChange={(e) => setFormData({ ...formData, appointment_type: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="in_person">In-Person</option>
                <option value="telehealth">Telehealth</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Start Time *</Label>
              <Input
                type="time"
                value={formData.start_time}
                onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>End Time</Label>
              <Input
                type="time"
                value={formData.end_time}
                onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Visit Type</Label>
              <select
                value={formData.visit_type}
                onChange={(e) => setFormData({ ...formData, visit_type: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">Select visit type...</option>
                {availableVisitTypes.map(vt => (
                  <option key={vt.id} value={vt.id}>{vt.label}</option>
                ))}
              </select>
              {availableVisitTypes.find(vt => vt.id === formData.visit_type)?.description && (
                <p className="text-xs text-gray-500 mt-1">
                  {availableVisitTypes.find(vt => vt.id === formData.visit_type).description}
                </p>
              )}
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Notes</Label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                rows={3}
                placeholder="Appointment notes..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={createAppointmentMutation.isPending}>
              {createAppointmentMutation.isPending ? "Creating..." : "Create Appointment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}