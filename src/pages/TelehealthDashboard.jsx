import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Video, 
  Calendar, 
  Clock, 
  User, 
  Phone, 
  CheckCircle2, 
  AlertCircle,
  Plus,
  FileText,
  Shield,
  Play
} from "lucide-react";
import { formatEastern, todayEastern } from "../components/utils/timezone";
import CreateAppointmentDialog from "../components/scheduling/CreateAppointmentDialog";
import AppointmentDetailDialog from "../components/scheduling/AppointmentDetailDialog";

export default function TelehealthDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  // Fetch telehealth appointments
  const { data: appointments = [] } = useQuery({
    queryKey: ['telehealthAppointments', currentUser?.email],
    queryFn: () => base44.entities.Appointment.filter({
      provider_email: currentUser.email,
      appointment_type: 'telehealth'
    }, '-appointment_date'),
    enabled: !!currentUser?.email
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  // Categorize appointments
  const today = todayEastern();
  const upcomingAppointments = appointments.filter(apt => 
    apt.appointment_date >= today && apt.status === 'scheduled'
  );
  const todayAppointments = appointments.filter(apt => 
    apt.appointment_date === today && ['scheduled', 'confirmed'].includes(apt.status)
  );
  const completedAppointments = appointments.filter(apt => 
    apt.status === 'completed'
  ).slice(0, 10);

  const getPatient = (patientId) => {
    return patients.find(p => p.id === patientId);
  };

  const handleStartCall = async (appointment) => {
    const patient = getPatient(appointment.patient_id);
    if (!patient) {
      alert('Patient not found');
      return;
    }

    // Navigate to telehealth visit
    navigate(createPageUrl("TelehealthVisit") + `?appointmentId=${appointment.id}`);
  };

  const getStatusBadge = (status) => {
    const configs = {
      scheduled: { color: "bg-blue-100 text-blue-800", label: "Scheduled" },
      confirmed: { color: "bg-green-100 text-green-800", label: "Confirmed" },
      in_progress: { color: "bg-yellow-100 text-yellow-800", label: "In Progress" },
      completed: { color: "bg-gray-100 text-gray-800", label: "Completed" },
      cancelled: { color: "bg-red-100 text-red-800", label: "Cancelled" },
      no_show: { color: "bg-orange-100 text-orange-800", label: "No Show" }
    };
    const config = configs[status] || configs.scheduled;
    return <Badge className={config.color}>{config.label}</Badge>;
  };

  return (
    <div className="p-2 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full overflow-x-hidden">
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-2">
          <div className="flex items-center gap-2 sm:gap-3 w-full">
            <div className="p-2 sm:p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg sm:rounded-xl flex-shrink-0">
              <Video className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 truncate">Telehealth Center</h1>
              <p className="text-xs sm:text-sm text-gray-600 hidden sm:block">Virtual visits and remote care</p>
            </div>
          </div>
          <Button 
            onClick={() => setShowCreateDialog(true)}
            className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto flex-shrink-0"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Schedule Visit</span>
            <span className="sm:hidden">Schedule</span>
          </Button>
          </div>
          </div>

      <CreateAppointmentDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onAppointmentCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['telehealthAppointments'] });
          setShowCreateDialog(false);
        }}
        defaultAppointmentType="telehealth"
        currentUser={currentUser}
      />

      {selectedAppointment && (
        <AppointmentDetailDialog
          appointment={selectedAppointment}
          patient={getPatient(selectedAppointment.patient_id)}
          onClose={() => setSelectedAppointment(null)}
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ['telehealthAppointments'] });
            setSelectedAppointment(null);
          }}
        />
      )}

      {/* Today's Appointments - Priority View */}
      {todayAppointments.length > 0 && (
        <Card className="mb-4 sm:mb-6 border-2 border-green-400 bg-gradient-to-r from-green-50 to-emerald-50 overflow-hidden">
          <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6 py-3 sm:py-4">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2 flex-wrap">
              <Clock className="w-5 h-5 text-green-600" />
              Today's Virtual Visits ({todayAppointments.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 sm:space-y-3 px-3 sm:px-6 py-3 sm:py-4">
            {todayAppointments.map(apt => {
              const patient = getPatient(apt.patient_id);
              return (
                <div key={apt.id} className="bg-white rounded-lg p-3 sm:p-4 border border-green-200 hover:shadow-md transition-shadow">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold text-gray-900 text-sm break-words">
                          {patient?.first_name} {patient?.last_name}
                        </h3>
                        {getStatusBadge(apt.status)}
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-xs sm:text-sm text-gray-600 flex-wrap">
                        <span className="flex items-center gap-1 whitespace-nowrap">
                          <Clock className="w-3 h-3 flex-shrink-0" />
                          {apt.start_time}
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3 flex-shrink-0" />
                          {apt.visit_type?.replace(/_/g, ' ')}
                        </span>
                      </div>
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedAppointment(apt)}
                        className="flex-1 sm:flex-initial text-xs sm:text-sm"
                      >
                        Details
                      </Button>
                      <Button
                        onClick={() => handleStartCall(apt)}
                        className="bg-green-600 hover:bg-green-700 flex-1 sm:flex-initial text-xs sm:text-sm"
                        size="sm"
                      >
                        <Play className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                        <span className="hidden sm:inline">Start</span>
                      </Button>
                      </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="upcoming" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="consent">Consent Forms</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="space-y-4 mt-4">
          {upcomingAppointments.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 mb-4">No upcoming telehealth appointments</p>
                <Button onClick={() => setShowCreateDialog(true)}>
                  Schedule First Virtual Visit
                </Button>
              </CardContent>
            </Card>
          ) : (
            upcomingAppointments.map(apt => {
              const patient = getPatient(apt.patient_id);
              return (
                <Card key={apt.id} className="hover:shadow-lg transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900">
                            {patient?.first_name} {patient?.last_name}
                          </h3>
                          {getStatusBadge(apt.status)}
                        </div>
                        <div className="space-y-1 text-sm text-gray-600">
                          <p className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            {formatEastern(new Date(apt.appointment_date), 'EEEE, MMMM d, yyyy')}
                          </p>
                          <p className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            {apt.start_time} - {apt.end_time}
                          </p>
                          <p className="flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            {apt.visit_type?.replace(/_/g, ' ')}
                          </p>
                          {apt.notes && (
                            <p className="text-xs text-gray-500 mt-2">{apt.notes}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedAppointment(apt)}
                      >
                        View Details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-4 mt-4">
          {completedAppointments.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No completed telehealth visits yet</p>
              </CardContent>
            </Card>
          ) : (
            completedAppointments.map(apt => {
              const patient = getPatient(apt.patient_id);
              return (
                <Card key={apt.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900">
                            {patient?.first_name} {patient?.last_name}
                          </h3>
                          {getStatusBadge(apt.status)}
                        </div>
                        <div className="space-y-1 text-sm text-gray-600">
                          <p>{formatEastern(new Date(apt.appointment_date), 'MMM d, yyyy')} at {apt.start_time}</p>
                          <p className="text-xs text-gray-500">{apt.visit_type?.replace(/_/g, ' ')}</p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(createPageUrl("PatientDetails") + `?id=${patient.id}`)}
                      >
                        View Chart
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="consent" className="space-y-4 mt-4">
          <TelehealthConsentManager currentUser={currentUser} patients={patients} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TelehealthConsentManager({ currentUser, patients }) {
  const queryClient = useQueryClient();

  const { data: consents = [] } = useQuery({
    queryKey: ['telehealthConsents', currentUser?.email],
    queryFn: () => base44.entities.TelehealthConsent.filter({ 
      provider_email: currentUser.email,
      is_active: true 
    }),
    enabled: !!currentUser?.email
  });

  const getPatient = (patientId) => {
    return patients.find(p => p.id === patientId);
  };

  return (
    <div className="space-y-4">
      <Alert className="bg-blue-50 border-blue-200">
        <Shield className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-sm">
          <strong>Consent Required:</strong> All patients must provide telehealth consent before virtual visits. 
          Consent is obtained during the first telehealth session.
        </AlertDescription>
      </Alert>

      {consents.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Shield className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">No active telehealth consents on file</p>
            <p className="text-sm text-gray-500 mt-2">Consent will be collected during first virtual visit</p>
          </CardContent>
        </Card>
      ) : (
        consents.map(consent => {
          const patient = getPatient(consent.patient_id);
          return (
            <Card key={consent.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">
                      {patient?.first_name} {patient?.last_name}
                    </h3>
                    <div className="space-y-1 text-sm text-gray-600">
                      <p className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        Consented on {formatEastern(new Date(consent.consent_date), 'MMM d, yyyy')}
                      </p>
                      <p>Type: {consent.consent_type}</p>
                      <p>Recording consent: {consent.recording_consent ? '✓ Yes' : '✗ No'}</p>
                      {consent.state_of_service && (
                        <p className="text-xs">Service location: {consent.state_of_service}</p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}