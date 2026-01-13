import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, Clock, Users, Settings } from "lucide-react";

import ScheduleCalendar from "../components/scheduling/ScheduleCalendar";
import AvailabilityManager from "../components/scheduling/AvailabilityManager";
import AppointmentsList from "../components/scheduling/AppointmentsList";
import TimeBlockManager from "../components/scheduling/TimeBlockManager";

export default function ProviderScheduling() {
  const [activeTab, setActiveTab] = useState("calendar");
  const [selectedDate, setSelectedDate] = useState(new Date());

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: appointments = [] } = useQuery({
    queryKey: ["appointments", currentUser?.email],
    queryFn: () => base44.entities.Appointment.filter({ provider_email: currentUser.email }),
    enabled: !!currentUser?.email
  });

  const todaysAppointments = appointments.filter(apt => 
    apt.appointment_date === new Date().toISOString().split('T')[0] &&
    apt.status !== 'cancelled'
  );

  const upcomingAppointments = appointments.filter(apt => 
    new Date(apt.appointment_date) > new Date() &&
    apt.status !== 'cancelled'
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Scheduling
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage your availability and appointments
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="hover-lift">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Today's Appointments</div>
                  <div className="text-2xl font-bold text-blue-600 mt-1">
                    {todaysAppointments.length}
                  </div>
                </div>
                <Calendar className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="hover-lift">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Upcoming</div>
                  <div className="text-2xl font-bold text-green-600 mt-1">
                    {upcomingAppointments.length}
                  </div>
                </div>
                <Clock className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card className="hover-lift">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Telehealth Today</div>
                  <div className="text-2xl font-bold text-purple-600 mt-1">
                    {todaysAppointments.filter(a => a.appointment_type === 'telehealth').length}
                  </div>
                </div>
                <Users className="w-8 h-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="appointments">Appointments</TabsTrigger>
            <TabsTrigger value="availability">Availability</TabsTrigger>
            <TabsTrigger value="blocks">Time Blocks</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="space-y-4 mt-6">
            <ScheduleCalendar 
              appointments={appointments}
              selectedDate={selectedDate}
              onDateSelect={setSelectedDate}
            />
          </TabsContent>

          <TabsContent value="appointments" className="space-y-4 mt-6">
            <AppointmentsList appointments={appointments} />
          </TabsContent>

          <TabsContent value="availability" className="space-y-4 mt-6">
            <AvailabilityManager />
          </TabsContent>

          <TabsContent value="blocks" className="space-y-4 mt-6">
            <TimeBlockManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}