import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

export default function ProviderScheduleCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: appointments } = useQuery({
    queryKey: ["appointments", currentUser?.email],
    queryFn: () => currentUser ? base44.entities.Appointment.filter({ provider_email: currentUser.email }) : Promise.resolve([]),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const getStatusColor = (status) => {
    const colors = {
      scheduled: "bg-blue-100 text-blue-800",
      confirmed: "bg-green-100 text-green-800",
      completed: "bg-gray-100 text-gray-800",
      cancelled: "bg-red-100 text-red-800",
      no_show: "bg-yellow-100 text-yellow-800"
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const daysInMonth = getDaysInMonth(currentDate);
  const firstDay = getFirstDayOfMonth(currentDate);

  const days = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  const getAppointmentsForDate = (day) => {
    if (!day) return [];
    const dateStr = new Date(currentDate.getFullYear(), currentDate.getMonth(), day).toISOString().split('T')[0];
    return appointments.filter(apt => apt.appointment_date === dateStr && apt.status !== 'cancelled');
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const selectedDateStr = selectedDate ? new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDate).toISOString().split('T')[0] : null;
  const selectedAppointments = selectedDateStr ? appointments.filter(apt => apt.appointment_date === selectedDateStr && apt.status !== 'cancelled') : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendar */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>{monthName}</CardTitle>
            <div className="flex gap-2">
              <Button size="icon" variant="outline" onClick={handlePrevMonth}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="outline" onClick={handleNextMonth}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-xs font-semibold text-gray-600 h-8 flex items-center justify-center">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7 gap-1">
              {days.map((day, idx) => {
                const dayAppointments = day ? getAppointmentsForDate(day) : [];
                const isSelected = day === selectedDate;

                return (
                  <button
                    key={idx}
                    onClick={() => day && setSelectedDate(day)}
                    className={`aspect-square rounded-lg p-1 text-xs font-semibold transition ${
                      !day
                        ? 'bg-gray-50'
                        : isSelected
                        ? 'bg-blue-500 text-white'
                        : dayAppointments.length > 0
                        ? 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                        : 'bg-white border border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {day && (
                      <>
                        <div>{day}</div>
                        {dayAppointments.length > 0 && (
                          <div className="text-xs">{dayAppointments.length}</div>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Appointments for selected date */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {selectedDate ? `${selectedDate} ${monthName.split(' ')[0]}` : 'Select a date'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedAppointments.length === 0 ? (
            <p className="text-sm text-gray-500">No appointments</p>
          ) : (
            <div className="space-y-3">
              {selectedAppointments.map(apt => (
                <div key={apt.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <p className="font-semibold text-sm">{apt.start_time} - {apt.end_time}</p>
                      <p className="text-xs text-gray-600">{apt.title}</p>
                    </div>
                    <Badge className={getStatusColor(apt.status)}>{apt.status}</Badge>
                  </div>
                  <p className="text-xs text-gray-600">{apt.visit_type}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}