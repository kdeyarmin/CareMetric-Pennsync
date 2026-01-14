import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, Clock, CheckCircle } from "lucide-react";

export default function PatientAppointmentBooking() {
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [visitType, setVisitType] = useState("telehealth");
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role !== 'admin');
    },
    initialData: []
  });

  const { data: availableSlots } = useQuery({
    queryKey: ["availableSlots", selectedProvider, selectedDate],
    queryFn: () => selectedProvider && selectedDate ? base44.functions.invoke('getAvailableSlots', { 
      providerEmail: selectedProvider, 
      date: selectedDate 
    }) : Promise.resolve(null),
    enabled: !!selectedProvider && !!selectedDate,
  });

  const getMinDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  const handleBookAppointment = async () => {
    if (!selectedProvider || !selectedDate || !selectedSlot) {
      alert('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      const [slotStart, slotEnd] = selectedSlot.split(' - ');
      await base44.functions.invoke('bookAppointment', {
        patientId: currentUser.id,
        providerEmail: selectedProvider,
        appointmentDate: selectedDate,
        startTime: slotStart,
        endTime: slotEnd,
        visitType: visitType,
        title: title || 'Appointment',
        notes: notes
      });
      setBookingConfirmed(true);
      setTimeout(() => {
        setBookingConfirmed(false);
        setSelectedProvider("");
        setSelectedDate("");
        setSelectedSlot("");
        setTitle("");
        setNotes("");
      }, 3000);
    } catch (error) {
      alert('Error booking appointment: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (bookingConfirmed) {
    return (
      <Card className="bg-green-50 border-green-200">
        <CardContent className="pt-6 text-center">
          <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
          <p className="font-semibold text-green-900">Appointment booked successfully!</p>
          <p className="text-sm text-green-700 mt-2">You will receive a reminder 24 hours before your appointment.</p>
        </CardContent>
      </Card>
    );
  }

  const slots = availableSlots?.data?.availableSlots || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Book an Appointment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Provider Selection */}
        <div>
          <Label>Select Provider</Label>
          <Select value={selectedProvider} onValueChange={setSelectedProvider}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map(provider => (
                <SelectItem key={provider.id} value={provider.email}>
                  {provider.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedProvider && (
          <>
            {/* Date Selection */}
            <div>
              <Label>Select Date</Label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setSelectedSlot("");
                }}
                min={getMinDate()}
              />
            </div>

            {/* Slot Selection */}
            {selectedDate && (
              <div>
                <Label>Select Time</Label>
                {slots.length === 0 ? (
                  <p className="text-sm text-gray-500 p-3 bg-gray-50 rounded">
                    {availableSlots?.data?.message || 'No available slots for this date'}
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {slots.map(slot => (
                      <button
                        key={slot.startTime}
                        onClick={() => setSelectedSlot(`${slot.startTime} - ${slot.endTime}`)}
                        className={`p-2 text-sm rounded border transition ${
                          selectedSlot === `${slot.startTime} - ${slot.endTime}`
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-white border-gray-300 hover:border-blue-500'
                        }`}
                      >
                        <Clock className="w-3 h-3 inline mr-1" />
                        {slot.startTime}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Visit Type */}
            <div>
              <Label>Visit Type</Label>
              <Select value={visitType} onValueChange={setVisitType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="telehealth">Telehealth</SelectItem>
                  <SelectItem value="in_person">In Person</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div>
              <Label>Appointment Title (optional)</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Follow-up visit"
              />
            </div>

            {/* Notes */}
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special requests or notes"
              />
            </div>

            {/* Book Button */}
            <Button
              onClick={handleBookAppointment}
              disabled={!selectedSlot || loading}
              className="w-full"
            >
              {loading ? 'Booking...' : 'Book Appointment'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}