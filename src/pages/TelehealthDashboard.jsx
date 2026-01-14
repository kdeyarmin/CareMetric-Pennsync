import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import TelehealthInitiator from "../components/telehealth/TelehealthInitiator";
import { Video, Users, Clock } from "lucide-react";

export default function TelehealthDashboard() {
  const [selectedPatient, setSelectedPatient] = useState("");
  const [selectedVisit, setSelectedVisit] = useState("");

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: upcomingVisits } = useQuery({
    queryKey: ["upcomingVisits"],
    queryFn: async () => {
      const visits = await base44.entities.Visit.list();
      const now = new Date();
      return visits.filter(v => new Date(v.visit_date) >= now && v.status === 'scheduled');
    },
    initialData: []
  });

  const { data: patients } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  const { data: telehealthVisits } = useQuery({
    queryKey: ["telehealthVisits"],
    queryFn: async () => {
      const visits = await base44.entities.Visit.list();
      return visits.filter(v => v.telehealth_room_id);
    },
    initialData: []
  });

  const selectedVisitData = upcomingVisits.find(v => v.id === selectedVisit);
  const selectedPatientData = patients.find(p => p.id === selectedPatient);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-4xl font-bold">Telehealth Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Upcoming Visits</p>
                <p className="text-3xl font-bold">{upcomingVisits.length}</p>
              </div>
              <Calendar className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Telehealth Sessions</p>
                <p className="text-3xl font-bold">{telehealthVisits.length}</p>
              </div>
              <Video className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Patients</p>
                <p className="text-3xl font-bold">{patients.length}</p>
              </div>
              <Users className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="upcoming" className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="upcoming">Upcoming Visits</TabsTrigger>
          <TabsTrigger value="initiate">Start Session</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="space-y-4">
          <div className="grid gap-4">
            {upcomingVisits.map(visit => {
              const patient = patients.find(p => p.id === visit.patient_id);
              return (
                <Card key={visit.id}>
                  <CardContent className="pt-6">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1">
                        <p className="font-semibold">{patient?.first_name} {patient?.last_name}</p>
                        <p className="text-sm text-gray-600">{visit.visit_type}</p>
                        <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                          <Clock className="w-4 h-4" />
                          {new Date(visit.visit_date).toLocaleString()}
                        </div>
                      </div>
                      {visit.telehealth_room_id ? (
                        <Button 
                          onClick={() => window.open(`/telehealth/${visit.telehealth_room_name}?isProvider=true`, '_blank')}
                          className="gap-2"
                        >
                          <Video className="w-4 h-4" />
                          Join Call
                        </Button>
                      ) : (
                        <TelehealthInitiator 
                          visit={visit} 
                          patient={patient}
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="initiate" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Start a New Telehealth Session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-semibold mb-2 block">Select Patient</label>
                <select 
                  value={selectedPatient}
                  onChange={(e) => setSelectedPatient(e.target.value)}
                  className="w-full border rounded p-2"
                >
                  <option value="">Choose a patient...</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                  ))}
                </select>
              </div>

              {selectedPatient && (
                <>
                  <div>
                    <label className="text-sm font-semibold mb-2 block">Select Visit</label>
                    <select 
                      value={selectedVisit}
                      onChange={(e) => setSelectedVisit(e.target.value)}
                      className="w-full border rounded p-2"
                    >
                      <option value="">Choose a visit...</option>
                      {upcomingVisits
                        .filter(v => v.patient_id === selectedPatient)
                        .map(v => (
                          <option key={v.id} value={v.id}>
                            {new Date(v.visit_date).toLocaleString()} - {v.visit_type}
                          </option>
                        ))}
                    </select>
                  </div>

                  {selectedVisitData && selectedPatientData && (
                    <TelehealthInitiator 
                      visit={selectedVisitData} 
                      patient={selectedPatientData}
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <div className="grid gap-4">
            {telehealthVisits.map(visit => {
              const patient = patients.find(p => p.id === visit.patient_id);
              return (
                <Card key={visit.id}>
                  <CardContent className="pt-6">
                    <div className="space-y-2">
                      <p className="font-semibold">{patient?.first_name} {patient?.last_name}</p>
                      <p className="text-sm text-gray-600">{visit.visit_type}</p>
                      <div className="text-xs text-gray-500 space-y-1">
                        <p>Date: {new Date(visit.visit_date).toLocaleString()}</p>
                        {visit.telehealth_call_duration && (
                          <p>Duration: {Math.floor(visit.telehealth_call_duration / 60)} minutes</p>
                        )}
                        {visit.telehealth_summary && (
                          <p>Summary: {visit.telehealth_summary}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}