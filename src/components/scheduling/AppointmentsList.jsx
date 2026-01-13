import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Video, MapPin } from "lucide-react";
import AppointmentDetailDialog from "./AppointmentDetailDialog";

export default function AppointmentsList({ appointments }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [showDetail, setShowDetail] = useState(false);

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list('first_name', 1000)
  });

  const getPatientName = (patientId) => {
    const patient = patients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : "Unknown";
  };

  const filteredAppointments = appointments
    .filter(apt => {
      const matchesSearch = getPatientName(apt.patient_id).toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "all" || apt.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const dateA = new Date(`${a.appointment_date} ${a.start_time}`);
      const dateB = new Date(`${b.appointment_date} ${b.start_time}`);
      return dateB - dateA;
    });

  const getStatusColor = (status) => {
    const colors = {
      scheduled: "bg-gray-100 text-gray-700",
      confirmed: "bg-green-100 text-green-700",
      in_progress: "bg-blue-100 text-blue-700",
      completed: "bg-purple-100 text-purple-700",
      cancelled: "bg-red-100 text-red-700",
      no_show: "bg-orange-100 text-orange-700"
    };
    return colors[status] || colors.scheduled;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle>All Appointments</CardTitle>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search patients..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-full sm:w-64"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="all">All Status</option>
                <option value="scheduled">Scheduled</option>
                <option value="confirmed">Confirmed</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredAppointments.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                No appointments found
              </div>
            ) : (
              filteredAppointments.map(apt => (
                <div
                  key={apt.id}
                  onClick={() => {
                    setSelectedAppointment(apt);
                    setShowDetail(true);
                  }}
                  className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  <div className="flex flex-col sm:flex-row justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {getPatientName(apt.patient_id)}
                        </span>
                        <Badge className={getStatusColor(apt.status)}>
                          {apt.status}
                        </Badge>
                        <Badge className={
                          apt.appointment_type === 'telehealth'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }>
                          {apt.appointment_type === 'telehealth' ? (
                            <><Video className="w-3 h-3 mr-1" />Telehealth</>
                          ) : (
                            <><MapPin className="w-3 h-3 mr-1" />In-Person</>
                          )}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {new Date(apt.appointment_date).toLocaleDateString('en-US', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })}
                      </div>
                      <div className="text-sm text-gray-500">
                        {apt.start_time} {apt.end_time && `- ${apt.end_time}`} • {apt.visit_type?.replace(/_/g, ' ')}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

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
    </>
  );
}