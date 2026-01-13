import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Smartphone, 
  Calendar, 
  FileText, 
  CheckCircle2,
  Clock,
  AlertCircle,
  ListTodo
} from "lucide-react";
import MobileNoteInterface from "../components/mobile/MobileNoteInterface";
import QuickPatientAccess from "../components/mobile/QuickPatientAccess";
import PushNotificationManager from "../components/notifications/PushNotificationManager";
import MobileTaskList from "../components/mobile/MobileTaskList";
import { todayEastern } from "../components/utils/timezone";

export default function MobileWorkflow() {
  const [selectedPatient, setSelectedPatient] = useState("");
  const [visitType, setVisitType] = useState("routine_visit");
  const [diagnosis, setDiagnosis] = useState("");
  const [generatedNote, setGeneratedNote] = useState("");
  const [showCreatePatient, setShowCreatePatient] = useState(false);
  const [newPatientData, setNewPatientData] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    medical_record_number: "",
  });
  const [creatingPatient, setCreatingPatient] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    }
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 100),
    initialData: []
  });

  const selectedPatientData = patients.find(p => p.id === selectedPatient);

  const createNewPatient = async () => {
    if (!newPatientData.first_name.trim() || !newPatientData.last_name.trim()) {
      alert("First and last name are required");
      return;
    }

    setCreatingPatient(true);
    try {
      const created = await base44.entities.Patient.create({
        first_name: newPatientData.first_name,
        last_name: newPatientData.last_name,
        date_of_birth: newPatientData.date_of_birth || null,
        medical_record_number: newPatientData.medical_record_number || "",
      });

      setSelectedPatient(created.id);
      setShowCreatePatient(false);
      setNewPatientData({
        first_name: "",
        last_name: "",
        date_of_birth: "",
        medical_record_number: "",
      });
      alert("Patient created successfully");
    } catch (error) {
      alert("Failed to create patient");
      console.error(error);
    } finally {
      setCreatingPatient(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Mobile Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 sticky top-0 z-10 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            <h1 className="text-lg font-bold">Mobile Workflow</h1>
          </div>
          <PushNotificationManager userEmail={currentUser?.email} />
        </div>
        <p className="text-xs text-blue-100">Optimized for on-the-go documentation</p>
      </div>

      <div className="p-3 space-y-3">
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-2">
          <Card>
            <CardContent className="p-3 text-center">
              <Calendar className="w-5 h-5 mx-auto mb-1 text-blue-600" />
              <p className="text-lg font-bold text-gray-900">5</p>
              <p className="text-xs text-gray-600">Today</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <FileText className="w-5 h-5 mx-auto mb-1 text-green-600" />
              <p className="text-lg font-bold text-gray-900">12</p>
              <p className="text-xs text-gray-600">This Week</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <Clock className="w-5 h-5 mx-auto mb-1 text-purple-600" />
              <p className="text-lg font-bold text-gray-900">2.5h</p>
              <p className="text-xs text-gray-600">Saved</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="patients" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="patients" className="text-xs sm:text-sm">Patients</TabsTrigger>
            <TabsTrigger value="document" className="text-xs sm:text-sm">Quick Note</TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs sm:text-sm">Tasks</TabsTrigger>
          </TabsList>

          <TabsContent value="patients" className="space-y-3">
            <QuickPatientAccess userEmail={currentUser?.email} />
          </TabsContent>
          
          <TabsContent value="tasks" className="space-y-3">
            <MobileTaskList userEmail={currentUser?.email} />
          </TabsContent>

          <TabsContent value="document" className="space-y-3">
            {/* Patient Selection */}
            <Card>
              <CardContent className="p-3 space-y-3">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Patient</label>
                  <div className="space-y-2">
                    <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                      <SelectTrigger className="h-12 text-base">
                        <SelectValue placeholder="Select patient..." />
                      </SelectTrigger>
                      <SelectContent>
                        {patients.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.first_name} {p.last_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full border-dashed text-xs"
                      onClick={() => setShowCreatePatient(true)}
                    >
                      + Add New Patient
                    </Button>
                  </div>
                  </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Visit Type</label>
                    <Select value={visitType} onValueChange={setVisitType}>
                      <SelectTrigger className="h-12 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="routine_visit">Routine</SelectItem>
                        <SelectItem value="admission">Admission</SelectItem>
                        <SelectItem value="recertification">Recert</SelectItem>
                        <SelectItem value="discharge">Discharge</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Diagnosis</label>
                    <Select value={diagnosis} onValueChange={setDiagnosis}>
                      <SelectTrigger className="h-12 text-sm">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CHF">CHF</SelectItem>
                        <SelectItem value="COPD">COPD</SelectItem>
                        <SelectItem value="Diabetes">Diabetes</SelectItem>
                        <SelectItem value="Wound care">Wound Care</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Mobile Note Interface */}
            {selectedPatient && (
              <MobileNoteInterface
                patientId={selectedPatient}
                visitType={visitType}
                diagnosis={diagnosis}
                onNoteGenerated={(note) => {
                  setGeneratedNote(note);
                  toast.success('Note ready!');
                  if (navigator.vibrate) navigator.vibrate(200);
                }}
              />
            )}

            {/* Generated Note Display */}
            {generatedNote && (
              <Card className="border-2 border-green-400 bg-green-50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    Note Generated
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="bg-white rounded-lg p-3 max-h-60 overflow-y-auto text-sm">
                    {generatedNote}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedNote);
                        toast.success('Copied!');
                        if (navigator.vibrate) navigator.vibrate(50);
                      }}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                    >
                      Copy to EHR
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setGeneratedNote("")}
                    >
                      New
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Create Patient Dialog */}
        {showCreatePatient && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Create New Patient</CardTitle>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setShowCreatePatient(false)}
                    className="h-8 w-8"
                  >
                    ✕
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">
                    First Name *
                  </label>
                  <input
                    type="text"
                    value={newPatientData.first_name}
                    onChange={(e) =>
                      setNewPatientData({
                        ...newPatientData,
                        first_name: e.target.value,
                      })
                    }
                    placeholder="John"
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    value={newPatientData.last_name}
                    onChange={(e) =>
                      setNewPatientData({
                        ...newPatientData,
                        last_name: e.target.value,
                      })
                    }
                    placeholder="Doe"
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={newPatientData.date_of_birth}
                    onChange={(e) =>
                      setNewPatientData({
                        ...newPatientData,
                        date_of_birth: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">
                    Medical Record Number
                  </label>
                  <input
                    type="text"
                    value={newPatientData.medical_record_number}
                    onChange={(e) =>
                      setNewPatientData({
                        ...newPatientData,
                        medical_record_number: e.target.value,
                      })
                    }
                    placeholder="MRN-12345"
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1 text-sm"
                    onClick={() => setShowCreatePatient(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 text-sm"
                    onClick={createNewPatient}
                    disabled={creatingPatient}
                  >
                    {creatingPatient ? "Creating..." : "Create"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}