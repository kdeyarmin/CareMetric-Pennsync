import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Video, MapPin, CheckCircle, X, Play } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function AppointmentDetailDialog({ appointment, open, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: patient } = useQuery({
    queryKey: ["patient", appointment?.patient_id],
    queryFn: () => base44.entities.Patient.filter({ id: appointment.patient_id }),
    enabled: !!appointment?.patient_id,
    select: (data) => data[0]
  });

  const updateAppointmentMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Appointment.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Appointment updated");
    }
  });

  const handleStatusChange = (newStatus) => {
    updateAppointmentMutation.mutate({
      id: appointment.id,
      data: { status: newStatus }
    });
  };

  const handleStartTelehealth = () => {
    navigate(createPageUrl(`TelehealthVisit?appointmentId=${appointment.id}`));
    onClose();
  };

  if (!appointment) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Appointment Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Patient Info */}
          {patient && (
            <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
              <h3 className="font-semibold mb-2">Patient Information</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Name:</span>
                  <p className="font-medium">{patient.first_name} {patient.last_name}</p>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Phone:</span>
                  <p className="font-medium">{patient.phone}</p>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Email:</span>
                  <p className="font-medium">{patient.email}</p>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Address:</span>
                  <p className="font-medium">{patient.address}</p>
                </div>
              </div>
            </div>
          )}

          {/* Appointment Details */}
          <div className="space-y-3">
            <div>
              <span className="text-sm text-gray-600 dark:text-gray-400">Date & Time</span>
              <p className="font-medium">
                {new Date(appointment.appointment_date).toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </p>
              <p className="text-sm">
                {appointment.start_time} {appointment.end_time && `- ${appointment.end_time}`}
              </p>
            </div>

            <div className="flex gap-2">
              <Badge className={
                appointment.appointment_type === 'telehealth'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-blue-100 text-blue-700'
              }>
                {appointment.appointment_type === 'telehealth' ? (
                  <><Video className="w-3 h-3 mr-1" />Telehealth</>
                ) : (
                  <><MapPin className="w-3 h-3 mr-1" />In-Person</>
                )}
              </Badge>
              <Badge>
                {appointment.visit_type?.replace(/_/g, ' ')}
              </Badge>
              <Badge className={
                appointment.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                appointment.status === 'scheduled' ? 'bg-gray-100 text-gray-700' :
                appointment.status === 'completed' ? 'bg-purple-100 text-purple-700' :
                'bg-orange-100 text-orange-700'
              }>
                {appointment.status}
              </Badge>
            </div>

            {appointment.notes && (
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-400">Notes</span>
                <p className="text-sm mt-1">{appointment.notes}</p>
              </div>
            )}

            {appointment.patient_confirmed && (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm">Patient confirmed</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-4 border-t">
            {appointment.status === 'scheduled' && (
              <Button
                size="sm"
                onClick={() => handleStatusChange('confirmed')}
              >
                <CheckCircle className="w-4 h-4 mr-1" />
                Confirm
              </Button>
            )}

            {appointment.appointment_type === 'telehealth' && 
             ['scheduled', 'confirmed'].includes(appointment.status) && (
              <Button
                size="sm"
                className="bg-purple-600 hover:bg-purple-700"
                onClick={handleStartTelehealth}
              >
                <Play className="w-4 h-4 mr-1" />
                Start Telehealth
              </Button>
            )}

            {!['completed', 'cancelled'].includes(appointment.status) && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStatusChange('in_progress')}
                >
                  Mark In Progress
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStatusChange('completed')}
                >
                  Mark Completed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600"
                  onClick={() => handleStatusChange('cancelled')}
                >
                  <X className="w-4 h-4 mr-1" />
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}