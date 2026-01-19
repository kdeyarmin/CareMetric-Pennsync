import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, Video, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function TelehealthScheduler({ patientId, onScheduled }) {
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [visitType, setVisitType] = useState("routine_visit");
  const [scheduling, setScheduling] = useState(false);

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      const results = await base44.entities.Patient.filter({ id: patientId });
      return results[0] || null;
    },
    enabled: !!patientId
  });

  const scheduleVisit = async () => {
    if (!selectedDate || !selectedTime) {
      toast.error("Please select date and time");
      return;
    }

    setScheduling(true);
    try {
      const visit = await base44.entities.Visit.create({
        patient_id: patientId,
        visit_date: selectedDate,
        visit_time: selectedTime,
        visit_type: visitType,
        status: 'scheduled',
        start_time: null,
        end_time: null
      });

      // Send notification to patient if email exists
      if (patient?.email) {
        try {
          await base44.integrations.Core.SendEmail({
            to: patient.email,
            subject: 'Telehealth Appointment Scheduled',
            body: `Your telehealth appointment has been scheduled for ${new Date(selectedDate).toLocaleDateString()} at ${selectedTime}.
            
You will receive a link to join the video call shortly before your appointment.

Patient: ${patient.first_name} ${patient.last_name}
Provider: ${currentUser?.full_name}
Type: ${visitType.replace(/_/g, ' ')}

If you need to reschedule, please contact our office.`
          });
        } catch (emailError) {
          console.error('Failed to send email:', emailError);
        }
      }

      toast.success("Telehealth visit scheduled");
      queryClient.invalidateQueries(['scheduledVisits']);
      
      setSelectedDate("");
      setSelectedTime("");
      setVisitType("routine_visit");
      
      if (onScheduled) onScheduled(visit);
    } catch (error) {
      toast.error("Failed to schedule visit");
      console.error(error);
    } finally {
      setScheduling(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-600" />
          Schedule Telehealth Visit
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {patient && (
          <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <p className="text-sm font-medium">
              Patient: {patient.first_name} {patient.last_name}
            </p>
            {patient.email && (
              <p className="text-xs text-gray-600">Email: {patient.email}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Date</Label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          <div>
            <Label>Time</Label>
            <Input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label>Visit Type</Label>
          <Select value={visitType} onValueChange={setVisitType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="routine_visit">Routine Visit</SelectItem>
              <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
              <SelectItem value="admission">Admission</SelectItem>
              <SelectItem value="recertification">Recertification</SelectItem>
              <SelectItem value="prn">PRN Visit</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={scheduleVisit}
          disabled={scheduling || !selectedDate || !selectedTime}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {scheduling ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Scheduling...
            </>
          ) : (
            <>
              <Video className="w-4 h-4 mr-2" />
              Schedule Telehealth Visit
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}