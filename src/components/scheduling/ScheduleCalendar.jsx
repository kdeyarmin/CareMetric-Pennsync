import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, ChevronLeft, ChevronRight, Video, MapPin } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";

import CreateAppointmentDialog from "./CreateAppointmentDialog";
import AppointmentDetailDialog from "./AppointmentDetailDialog";

export default function ScheduleCalendar({ appointments, selectedDate, onDateSelect }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [showDetail, setShowDetail] = useState(false);

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list('first_name', 1000)
  });

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getAppointmentsForDate = (date) => {
    return appointments.filter(apt => 
      isSameDay(new Date(apt.appointment_date), date) &&
      apt.status !== 'cancelled'
    );
  };

  const getPatientName = (patientId) => {
    const patient = patients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : "Unknown";
  };

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              {format(currentMonth, 'MMMM yyyy')}
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handlePrevMonth}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCurrentMonth(new Date())}>
                Today
              </Button>
              <Button size="sm" variant="outline" onClick={handleNextMonth}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <CreateAppointmentDialog />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-2">
            {/* Day Headers */}
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center font-semibold text-sm text-gray-600 dark:text-gray-400 py-2">
                {day}
              </div>
            ))}

            {/* Calendar Days */}
            {daysInMonth.map(day => {
              const dayAppointments = getAppointmentsForDate(day);
              const isToday = isSameDay(day, new Date());
              const isSelected = selectedDate && isSameDay(day, selectedDate);

              return (
                <div
                  key={day.toString()}
                  onClick={() => onDateSelect(day)}
                  className={`
                    min-h-24 p-2 border rounded-lg cursor-pointer transition-all
                    ${!isSameMonth(day, currentMonth) ? 'bg-gray-50 dark:bg-slate-900 opacity-50' : 'bg-white dark:bg-slate-800'}
                    ${isToday ? 'border-blue-500 border-2' : 'border-gray-200 dark:border-slate-700'}
                    ${isSelected ? 'ring-2 ring-blue-500' : ''}
                    hover:bg-gray-50 dark:hover:bg-slate-700
                  `}
                >
                  <div className={`text-sm font-semibold ${isToday ? 'text-blue-600' : 'text-gray-900 dark:text-white'}`}>
                    {format(day, 'd')}
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayAppointments.slice(0, 3).map(apt => (
                      <div
                        key={apt.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAppointment(apt);
                          setShowDetail(true);
                        }}
                        className={`
                          text-xs p-1 rounded truncate
                          ${apt.appointment_type === 'telehealth' 
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' 
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'}
                        `}
                      >
                        <div className="flex items-center gap-1">
                          {apt.appointment_type === 'telehealth' ? (
                            <Video className="w-3 h-3" />
                          ) : (
                            <MapPin className="w-3 h-3" />
                          )}
                          <span>{apt.start_time} {getPatientName(apt.patient_id)}</span>
                        </div>
                      </div>
                    ))}
                    {dayAppointments.length > 3 && (
                      <div className="text-xs text-gray-500">
                        +{dayAppointments.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Selected Date Details */}
      {selectedDate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {getAppointmentsForDate(selectedDate).length === 0 ? (
                <p className="text-gray-500 text-center py-4">No appointments scheduled</p>
              ) : (
                getAppointmentsForDate(selectedDate)
                  .sort((a, b) => a.start_time.localeCompare(b.start_time))
                  .map(apt => (
                    <div
                      key={apt.id}
                      onClick={() => {
                        setSelectedAppointment(apt);
                        setShowDetail(true);
                      }}
                      className="border p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-900 cursor-pointer"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold">{getPatientName(apt.patient_id)}</span>
                            <Badge className={
                              apt.appointment_type === 'telehealth'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-blue-100 text-blue-700'
                            }>
                              {apt.appointment_type === 'telehealth' ? 'Telehealth' : 'In-Person'}
                            </Badge>
                            <Badge className={
                              apt.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                              apt.status === 'scheduled' ? 'bg-gray-100 text-gray-700' :
                              'bg-orange-100 text-orange-700'
                            }>
                              {apt.status}
                            </Badge>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            {apt.start_time} - {apt.end_time} • {apt.visit_type?.replace(/_/g, ' ')}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedAppointment && (
        <AppointmentDetailDialog
          appointment={selectedAppointment}
          open={showDetail}
          onClose={() => {
            setShowDetail(false);
            setSelectedAppointment(null);
          }}
        />
      )}
    </div>
  );
}