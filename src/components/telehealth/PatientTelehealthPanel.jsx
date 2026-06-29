import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Video, Copy, Calendar, MessageSquare } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SessionDocumentation from "@/components/telehealth/SessionDocumentation";
import TelehealthCall from "@/components/telehealth/TelehealthCall";
import { generateJoinToken, buildPatientJoinLink } from "@/components/telehealth/telehealthUtils";
import { toast } from "sonner";

const visitTypes = {
  routine_followup: { label: "Routine Follow-up", visitType: "routine_visit" },
  urgent_care: { label: "Urgent Care", visitType: "prn" },
  medication_review: { label: "Medication Review", visitType: "routine_visit" },
  care_plan_review: { label: "Care Plan Review", visitType: "routine_visit" },
  admission_assessment: { label: "Admission Assessment", visitType: "admission" },
  discharge_planning: { label: "Discharge Planning", visitType: "discharge" },
};

export default function PatientTelehealthPanel({ patient, currentUser }) {
  const queryClient = useQueryClient();
  const [activeSession, setActiveSession] = useState(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [participantList, setParticipantList] = useState([]);
  const [newSession, setNewSession] = useState({ visit_type: "routine_followup", scheduled_at: "" });
  const endingRef = useRef(false);

  const { data: sessions = [] } = useQuery({
    queryKey: ["patient-telehealth-sessions", patient?.id],
    queryFn: () => base44.entities.TelehealthSession.filter({ patient_id: patient?.id }, '-created_date', 50),
    enabled: !!patient?.id,
    initialData: []
  });

  const createMutation = useMutation({
    mutationFn: (payload) => base44.entities.TelehealthSession.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-telehealth-sessions", patient?.id] });
      setShowNewSession(false);
      setNewSession({ visit_type: "routine_followup", scheduled_at: "" });
      toast.success("Telehealth visit created");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TelehealthSession.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patient-telehealth-sessions", patient?.id] })
  });

  const createVisitMutation = useMutation({
    mutationFn: (payload) => base44.entities.Visit.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patientVisits", patient?.id] })
  });

  const textLink = useMutation({
    mutationFn: ({ to_number, body }) => base44.functions.invoke("sendSms", { to_number, body, patient_id: patient?.id }),
    onSuccess: () => toast.success("Join link texted to the patient"),
    onError: (e) => toast.error(e?.message || "Couldn't send the text")
  });

  const textPatient = (session) => {
    const phone = patient?.phone || patient?.phone_number || patient?.cell;
    if (!phone) {
      toast.error("No phone number on file for this patient");
      return;
    }
    const greeting = patient?.first_name ? `Hi ${patient.first_name}, ` : "Hi, ";
    textLink.mutate({
      to_number: phone,
      body: `${greeting}here's your secure telehealth visit link: ${session.invite_link}`
    });
  };

  const upcomingSessions = useMemo(() => sessions.filter((session) => ["scheduled", "active"].includes(session.status)), [sessions]);
  const pastSessions = useMemo(() => sessions.filter((session) => ["completed", "cancelled"].includes(session.status)), [sessions]);

  const startSession = async (session) => {
    endingRef.current = false;
    const participants = [...new Set([currentUser?.full_name || currentUser?.email, patient?.first_name ? `${patient.first_name} ${patient.last_name}` : patient?.id])].filter(Boolean);
    setParticipantList(participants);
    await updateMutation.mutateAsync({
      id: session.id,
      data: { status: "active", started_at: new Date().toISOString(), participant_list: participants }
    });
    setActiveSession({ ...session, participant_list: participants, started_at: new Date().toISOString() });
  };

  const endSession = async () => {
    // Guard against the End button + Telnyx "disconnected" event both firing.
    if (!activeSession || endingRef.current) return;
    endingRef.current = true;
    const endedAt = new Date();
    const startedAt = activeSession.started_at ? new Date(activeSession.started_at) : endedAt;
    const duration = Math.max(1, Math.round((endedAt - startedAt) / 60000));
    await updateMutation.mutateAsync({
      id: activeSession.id,
      data: { status: "completed", ended_at: endedAt.toISOString(), duration_minutes: duration, participant_list: participantList }
    });
    setActiveSession({ ...activeSession, ended_at: endedAt.toISOString(), duration_minutes: duration, participant_list: participantList });
    setShowDocumentation(true);
  };

  const saveDocumentation = async (docData) => {
    if (!activeSession) return;
    const visitLabel = visitTypes[activeSession.visit_type]?.label || activeSession.visit_type;
    const compiledNote = [
      `Telehealth Visit Type: ${visitLabel}`,
      `Patient: ${patient.first_name} ${patient.last_name}`,
      `Participants: ${(activeSession.participant_list || participantList).join(", ") || "Not recorded"}`,
      `Duration: ${activeSession.duration_minutes || 0} minutes`,
      docData.chief_complaint ? `Chief Complaint: ${docData.chief_complaint}` : "",
      docData.assessment ? `Assessment: ${docData.assessment}` : "",
      docData.plan ? `Plan: ${docData.plan}` : "",
      docData.follow_up_needed ? `Follow-up Needed: Yes${docData.follow_up_timeframe ? ` (${docData.follow_up_timeframe})` : ""}` : "Follow-up Needed: No",
      docData.notes ? `Additional Notes: ${docData.notes}` : "",
    ].filter(Boolean).join("\n");

    const visit = await createVisitMutation.mutateAsync({
      patient_id: patient.id,
      visit_date: new Date().toISOString().slice(0, 10),
      visit_time: new Date().toTimeString().slice(0, 5),
      visit_type: visitTypes[activeSession.visit_type]?.visitType || "routine_visit",
      status: "completed",
      start_time: activeSession.started_at,
      end_time: activeSession.ended_at || new Date().toISOString(),
      nurse_notes: compiledNote,
      vital_signs: docData.vitals_captured,
      ai_tags: ["telehealth", activeSession.visit_type],
    });

    await updateMutation.mutateAsync({
      id: activeSession.id,
      data: { ...docData, notes: compiledNote, participant_list: activeSession.participant_list || participantList, linked_visit_id: visit.id }
    });

    toast.success("Telehealth visit logged to patient chart");
    setShowDocumentation(false);
    setActiveSession(null);
    endingRef.current = false;
    queryClient.invalidateQueries({ queryKey: ["patient-telehealth-sessions", patient?.id] });
  };

  const createSession = async () => {
    const roomName = `telehealth-${patient.id}-${Date.now()}`;
    // Patient-facing capability link: the token is the patient's access grant.
    const inviteLink = buildPatientJoinLink(window.location.origin, roomName, generateJoinToken());
    await createMutation.mutateAsync({
      room_name: roomName,
      patient_id: patient.id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      host_email: currentUser?.email,
      host_name: currentUser?.full_name,
      visit_type: newSession.visit_type,
      scheduled_at: newSession.scheduled_at || new Date().toISOString(),
      status: "scheduled",
      invite_link: inviteLink,
      participant_list: [currentUser?.full_name || currentUser?.email, `${patient.first_name} ${patient.last_name}`].filter(Boolean),
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2"><Video className="w-5 h-5 text-blue-600" />Telehealth Visits</CardTitle>
            <Button onClick={() => setShowNewSession((value) => !value)}>New Virtual Visit</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showNewSession && (
            <div className="rounded-2xl border p-4 bg-blue-50 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Visit type</Label>
                  <Select value={newSession.visit_type} onValueChange={(value) => setNewSession({ ...newSession, visit_type: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(visitTypes).map(([value, config]) => <SelectItem key={value} value={value}>{config.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Scheduled date & time</Label>
                  <Input type="datetime-local" value={newSession.scheduled_at} onChange={(e) => setNewSession({ ...newSession, scheduled_at: e.target.value })} />
                </div>
              </div>
              <Button onClick={createSession} disabled={createMutation.isPending}>{createMutation.isPending ? 'Creating...' : 'Create Telehealth Session'}</Button>
            </div>
          )}

          {activeSession && !showDocumentation && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-green-50 p-3">
                <div>
                  <p className="font-medium text-green-900">Active telehealth visit</p>
                  <p className="text-sm text-green-700">Participants: {(participantList || []).join(", ")}</p>
                </div>
                <Button variant="outline" className="text-red-600 border-red-200" onClick={endSession}>End Session</Button>
              </div>
              <TelehealthCall
                roomName={activeSession.room_name}
                identity={currentUser?.full_name || currentUser?.email}
                role="staff"
                onDisconnect={endSession}
                onParticipantListChange={setParticipantList}
              />
            </div>
          )}

          {showDocumentation && activeSession && (
            <SessionDocumentation sessionId={activeSession.id} initialData={activeSession} onSave={saveDocumentation} />
          )}

          <div className="space-y-3">
            {upcomingSessions.map((session) => (
              <div key={session.id} className="rounded-xl border p-4 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{visitTypes[session.visit_type]?.label || session.visit_type}</p>
                  <p className="text-sm text-slate-500 flex items-center gap-2"><Calendar className="w-3 h-3" />{session.scheduled_at ? new Date(session.scheduled_at).toLocaleString() : 'Now'}</p>
                  {session.invite_link && (
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      <button type="button" className="text-sm text-indigo-600 underline flex items-center gap-1" onClick={async () => { try { await navigator.clipboard.writeText(session.invite_link); toast.success('Join link copied'); } catch { toast.error("Couldn't copy the link — copy it manually."); } }}><Copy className="w-3 h-3" />Copy join link</button>
                      <button type="button" className="text-sm text-indigo-600 underline flex items-center gap-1 disabled:opacity-50" disabled={textLink.isPending} onClick={() => textPatient(session)}><MessageSquare className="w-3 h-3" />Text to patient</button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{session.status}</Badge>
                  <Button size="sm" onClick={() => startSession(session)}>Join Visit</Button>
                </div>
              </div>
            ))}
            {upcomingSessions.length === 0 && <div className="text-sm text-slate-500">No telehealth visits scheduled for this patient.</div>}
          </div>
        </CardContent>
      </Card>

      {pastSessions.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Telehealth Visit History</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {pastSessions.map((session) => (
              <div key={session.id} className="rounded-xl border p-4 bg-white">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="font-semibold text-slate-900">{visitTypes[session.visit_type]?.label || session.visit_type}</p>
                  <Badge variant="outline">{session.duration_minutes || 0} min</Badge>
                </div>
                <p className="text-sm text-slate-500">Participants: {(session.participant_list || []).join(", ") || 'Not recorded'}</p>
                {session.notes && <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-700 bg-slate-50 rounded-xl p-3">{session.notes}</pre>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}