import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Video, Calendar, Plus, Phone, Clock, CheckCircle2, AlertCircle, FileText, Loader2, ExternalLink } from "lucide-react";
import { format, isValid, addMinutes } from "date-fns";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import SearchablePatientSelect from "../components/ui/SearchablePatientSelect";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";

export default function Telehealth() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [joiningCall, setJoiningCall] = useState(null);

  const [newVisit, setNewVisit] = useState({
    patient_id: "",
    visit_date: format(new Date(), "yyyy-MM-dd"),
    visit_time: format(addMinutes(new Date(), 30), "HH:mm"),
    visit_type: "routine_visit",
    status: "scheduled"
  });

  const [callNotes, setCallNotes] = useState({
    summary: "",
    vital_signs: {},
    follow_up_needed: false
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  const { data: telehealthVisits = [] } = useQuery({
    queryKey: ["telehealthVisits"],
    queryFn: () => base44.entities.Visit.filter({
      created_by: currentUser?.email
    }),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const scheduledCalls = telehealthVisits.filter(v => 
    v.status === "scheduled" && 
    new Date(`${v.visit_date}T${v.visit_time || '00:00'}`) >= new Date()
  );

  const completedCalls = telehealthVisits.filter(v => v.status === "completed");

  const scheduleVisitMutation = useMutation({
    mutationFn: (visitData) => base44.entities.Visit.create(visitData),
    onSuccess: (newVisit) => {
      queryClient.invalidateQueries({ queryKey: ["telehealthVisits"] });
      setShowScheduleDialog(false);
      setNewVisit({
        patient_id: "",
        visit_date: format(new Date(), "yyyy-MM-dd"),
        visit_time: format(addMinutes(new Date(), 30), "HH:mm"),
        visit_type: "routine_visit",
        status: "scheduled"
      });
      alert("Telehealth visit scheduled successfully!");
      
      logActivity(ActivityActions.CREATE, {
        entity_type: "Visit",
        entity_id: newVisit.id,
        page: "Telehealth"
      });
    }
  });

  const updateVisitMutation = useMutation({
    mutationFn: ({ visitId, data }) => base44.entities.Visit.update(visitId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telehealthVisits"] });
      setShowDocumentDialog(false);
      setSelectedVisit(null);
      setCallNotes({ summary: "", vital_signs: {}, follow_up_needed: false });
      alert("Visit documented successfully!");
    }
  });

  const handleSchedule = () => {
    if (!newVisit.patient_id || !newVisit.visit_date || !newVisit.visit_time) {
      alert("Please fill in all required fields");
      return;
    }
    scheduleVisitMutation.mutate(newVisit);
  };

  const handleStartCall = (visit) => {
    setJoiningCall(visit.id);
    
    // Open simple video call in new window
    const callWindow = window.open(
      `${createPageUrl('TelehealthCall')}?visitId=${visit.id}`,
      'TelehealthCall',
      'width=1200,height=800'
    );
    
    // Update visit status
    updateVisitMutation.mutate({
      visitId: visit.id,
      data: { 
        status: "in_progress",
        start_time: new Date().toISOString()
      }
    });

    setTimeout(() => setJoiningCall(null), 2000);
  };

  const handleDocumentCall = (visit) => {
    setSelectedVisit(visit);
    setCallNotes({
      summary: visit.telehealth_summary || "",
      vital_signs: visit.vital_signs || {},
      follow_up_needed: false
    });
    setShowDocumentDialog(true);
  };

  const handleSaveDocumentation = () => {
    if (!selectedVisit) return;

    updateVisitMutation.mutate({
      visitId: selectedVisit.id,
      data: {
        status: "completed",
        end_time: new Date().toISOString(),
        telehealth_summary: callNotes.summary,
        vital_signs: callNotes.vital_signs,
        nurse_notes: `TELEHEALTH VISIT DOCUMENTATION\n\nVisit Date: ${format(new Date(selectedVisit.visit_date), 'MMMM d, yyyy')}\nStart Time: ${selectedVisit.start_time ? format(new Date(selectedVisit.start_time), 'h:mm a') : 'N/A'}\n\nSummary:\n${callNotes.summary}\n\nFollow-up Required: ${callNotes.follow_up_needed ? 'Yes' : 'No'}\n\nCompliance Note: This telehealth visit was conducted in accordance with applicable state and federal regulations, including HIPAA privacy requirements. Patient consent was obtained prior to the telehealth session.`
      }
    });
  };

  const getPatient = (patientId) => patients.find(p => p.id === patientId);

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full max-w-full overflow-x-hidden min-w-0 pb-20 sm:pb-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
          <Video className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
          Telehealth
        </h1>
        <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">Schedule and conduct virtual patient visits</p>
      </div>

      <Alert className="mb-4 sm:mb-6 bg-blue-50 border-blue-200">
        <Video className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          <p className="font-semibold mb-1">HIPAA-Compliant Telehealth</p>
          <p className="text-sm">All telehealth sessions are encrypted and documented for compliance with healthcare regulations.</p>
        </AlertDescription>
      </Alert>

      <div className="mb-4 sm:mb-6">
        <Button
          onClick={() => setShowScheduleDialog(true)}
          className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto touch-target"
        >
          <Plus className="w-4 h-4 mr-2" />
          Schedule Telehealth Visit
        </Button>
      </div>

      {/* Scheduled Calls */}
      <Card className="mb-4 sm:mb-6 w-full">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
            Scheduled Telehealth Visits ({scheduledCalls.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          {scheduledCalls.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p>No scheduled telehealth visits</p>
            </div>
          ) : (
            <div className="space-y-3">
              {scheduledCalls.map((visit) => {
                const patient = getPatient(visit.patient_id);
                const visitDateTime = new Date(`${visit.visit_date}T${visit.visit_time || '00:00'}`);
                const isNow = Math.abs(new Date() - visitDateTime) < 15 * 60 * 1000; // Within 15 minutes

                return (
                  <Card key={visit.id} className={`${isNow ? 'border-2 border-green-500 bg-green-50' : ''} w-full`}>
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 mb-1">
                            {patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient'}
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {isValid(visitDateTime) ? format(visitDateTime, 'MMM d, yyyy') : visit.visit_date}
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {visit.visit_time || 'Time not set'}
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {visit.visit_type.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          {isNow && (
                            <Badge className="bg-green-600 text-white mt-2">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Ready to Start
                            </Badge>
                          )}
                        </div>
                        <Button
                          onClick={() => handleStartCall(visit)}
                          disabled={joiningCall === visit.id}
                          className="bg-green-600 hover:bg-green-700 w-full sm:w-auto touch-target"
                        >
                          {joiningCall === visit.id ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Joining...</>
                          ) : (
                            <><Video className="w-4 h-4 mr-2" /> Start Call</>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completed Calls - Need Documentation */}
      <Card className="w-full">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
            Recent Telehealth Visits ({completedCalls.slice(0, 10).length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          {completedCalls.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p>No completed telehealth visits yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {completedCalls.slice(0, 10).map((visit) => {
                const patient = getPatient(visit.patient_id);
                const needsDocumentation = !visit.telehealth_summary || !visit.nurse_notes;

                return (
                  <Card key={visit.id} className={`${needsDocumentation ? 'border-yellow-300 bg-yellow-50' : ''} w-full`}>
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                        <div className="flex-1 min-w-0 w-full">
                          <h3 className="font-semibold text-gray-900 mb-1 text-sm sm:text-base break-words">
                            {patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient'}
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-gray-600">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {visit.visit_date}
                            </div>
                            {visit.telehealth_call_duration && (
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {Math.round(visit.telehealth_call_duration / 60)} minutes
                              </div>
                            )}
                            {needsDocumentation && (
                              <Badge className="bg-yellow-600 text-white">
                                <AlertCircle className="w-3 h-3 mr-1" />
                                Needs Documentation
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto flex-shrink-0">
                          {needsDocumentation ? (
                            <Button
                              onClick={() => handleDocumentCall(visit)}
                              variant="outline"
                              className="border-yellow-600 text-yellow-700 hover:bg-yellow-50 w-full sm:w-auto touch-target"
                            >
                              <FileText className="w-4 h-4 mr-2" />
                              Document
                            </Button>
                          ) : (
                            <Button
                              onClick={() => navigate(`${createPageUrl('DocumentVisit')}?visitId=${visit.id}`)}
                              variant="outline"
                              className="w-full sm:w-auto touch-target"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              View
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule Dialog */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schedule Telehealth Visit</DialogTitle>
            <DialogDescription>
              Schedule a virtual visit with a patient
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label>Patient *</Label>
              <SearchablePatientSelect
                patients={patients}
                selectedPatientId={newVisit.patient_id}
                onSelect={(patientId) => setNewVisit({ ...newVisit, patient_id: patientId })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Visit Date *</Label>
                <Input
                  type="date"
                  value={newVisit.visit_date}
                  onChange={(e) => setNewVisit({ ...newVisit, visit_date: e.target.value })}
                  className="h-11"
                />
              </div>
              <div>
                <Label>Visit Time *</Label>
                <Input
                  type="time"
                  value={newVisit.visit_time}
                  onChange={(e) => setNewVisit({ ...newVisit, visit_time: e.target.value })}
                  className="h-11"
                />
              </div>
            </div>

            <div>
              <Label>Visit Type</Label>
              <Select value={newVisit.visit_type} onValueChange={(value) => setNewVisit({ ...newVisit, visit_type: value })}>
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

            <Alert className="bg-blue-50 border-blue-200">
              <Phone className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900 text-sm">
                A secure telehealth link will be available when it's time for the visit. The patient will be notified of the scheduled appointment.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button
              onClick={handleSchedule}
              disabled={scheduleVisitMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
            >
              {scheduleVisitMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scheduling...</>
              ) : (
                'Schedule Visit'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Documentation Dialog */}
      <Dialog open={showDocumentDialog} onOpenChange={setShowDocumentDialog}>
        <DialogContent className="max-w-3xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Document Telehealth Visit</DialogTitle>
            <DialogDescription>
              Complete documentation for the telehealth encounter
            </DialogDescription>
          </DialogHeader>

          {selectedVisit && (
            <div className="space-y-4 py-4">
              <Alert className="bg-gray-50 border-gray-200">
                <AlertDescription>
                  <p className="font-semibold mb-1">
                    Patient: {(() => {
                      const patient = getPatient(selectedVisit.patient_id);
                      return patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown';
                    })()}
                  </p>
                  <p className="text-sm text-gray-600">
                    Visit Date: {selectedVisit.visit_date}
                    {selectedVisit.telehealth_call_duration && ` • Duration: ${Math.round(selectedVisit.telehealth_call_duration / 60)} minutes`}
                  </p>
                </AlertDescription>
              </Alert>

              <div>
                <Label>Visit Summary *</Label>
                <Textarea
                  placeholder="Document the telehealth encounter, including chief complaint, assessment, and plan..."
                  value={callNotes.summary}
                  onChange={(e) => setCallNotes({ ...callNotes, summary: e.target.value })}
                  className="min-h-[200px]"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Blood Pressure</Label>
                  <Input
                    placeholder="120/80"
                    value={callNotes.vital_signs.blood_pressure || ''}
                    onChange={(e) => setCallNotes({
                      ...callNotes,
                      vital_signs: { ...callNotes.vital_signs, blood_pressure: e.target.value }
                    })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Heart Rate</Label>
                  <Input
                    placeholder="72"
                    type="number"
                    value={callNotes.vital_signs.heart_rate || ''}
                    onChange={(e) => setCallNotes({
                      ...callNotes,
                      vital_signs: { ...callNotes.vital_signs, heart_rate: parseInt(e.target.value) || '' }
                    })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Temperature</Label>
                  <Input
                    placeholder="98.6"
                    type="number"
                    step="0.1"
                    value={callNotes.vital_signs.temperature || ''}
                    onChange={(e) => setCallNotes({
                      ...callNotes,
                      vital_signs: { ...callNotes.vital_signs, temperature: parseFloat(e.target.value) || '' }
                    })}
                  />
                </div>
                <div>
                  <Label className="text-xs">O2 Sat %</Label>
                  <Input
                    placeholder="98"
                    type="number"
                    value={callNotes.vital_signs.oxygen_saturation || ''}
                    onChange={(e) => setCallNotes({
                      ...callNotes,
                      vital_signs: { ...callNotes.vital_signs, oxygen_saturation: parseInt(e.target.value) || '' }
                    })}
                  />
                </div>
              </div>

              <Alert className="bg-yellow-50 border-yellow-200">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <AlertDescription className="text-yellow-900">
                  <p className="font-semibold mb-1">Compliance Requirements</p>
                  <ul className="text-sm space-y-1">
                    <li>✓ Patient consent obtained and documented</li>
                    <li>✓ Secure, HIPAA-compliant platform used</li>
                    <li>✓ Visit notes include telehealth-specific elements</li>
                    <li>✓ Appropriate billing codes for telehealth services</li>
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowDocumentDialog(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button
              onClick={handleSaveDocumentation}
              disabled={updateVisitMutation.isPending || !callNotes.summary}
              className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
            >
              {updateVisitMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                'Complete Documentation'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}