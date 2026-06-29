import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Video, Plus, Calendar, Clock, CheckCircle2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import StatCard from "@/components/ui/stat-card";
import { toast } from "sonner";
import TelehealthCall from "../components/telehealth/TelehealthCall";
import SessionCard from "../components/telehealth/SessionCard";
import SessionDocumentation from "../components/telehealth/SessionDocumentation";
import RealtimeVitalMonitor from "../components/telehealth/RealtimeVitalMonitor";
import { generateJoinToken, buildPatientJoinLink } from "../components/telehealth/telehealthUtils";

const visitTypes = [
  { value: "routine_followup", label: "Routine Follow-up" },
  { value: "urgent_care", label: "Urgent Care" },
  { value: "medication_review", label: "Medication Review" },
  { value: "care_plan_review", label: "Care Plan Review" },
  { value: "admission_assessment", label: "Admission Assessment" },
  { value: "discharge_planning", label: "Discharge Planning" }
];

export default function Telehealth() {
  const [activeSession, setActiveSession] = useState(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const endingRef = useRef(false);
  const autoJoinedRef = useRef(false);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["telehealth-sessions"],
    queryFn: () => base44.entities.TelehealthSession.list("-created_date", 50),
    refetchInterval: 30000
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["patients-list"],
    queryFn: () => base44.entities.Patient.list("-created_date", 100)
  });

  const createSession = useMutation({
    mutationFn: (data) => {
      // Guard against creating an orphaned session before the current user has
      // loaded — host_email is what scopes the session to its clinician.
      if (!data.host_email) {
        throw new Error("Still loading your account — please try again in a moment.");
      }
      return base44.entities.TelehealthSession.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telehealth-sessions"] });
      setShowNewSession(false);
      toast.success("Session created successfully");
    },
    onError: (e) => toast.error(e?.message || "Couldn't create the session")
  });

  const updateSession = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TelehealthSession.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["telehealth-sessions"] })
  });

  const textLink = useMutation({
    mutationFn: ({ to_number, body, patient_id }) => base44.functions.invoke("sendSms", { to_number, body, patient_id }),
    onSuccess: () => toast.success("Join link texted to the patient"),
    onError: (e) => toast.error(e?.message || "Couldn't send the text")
  });

  const handleTextPatient = (session) => {
    const patient = patients.find((p) => p.id === session.patient_id);
    const phone = patient?.phone || patient?.phone_number || patient?.cell;
    if (!phone) {
      toast.error("No phone number on file for this patient");
      return;
    }
    const greeting = patient?.first_name ? `Hi ${patient.first_name}, ` : "Hi, ";
    textLink.mutate({
      to_number: phone,
      body: `${greeting}here's your secure telehealth visit link: ${session.invite_link}`,
      patient_id: session.patient_id
    });
  };

  const { mutateAsync: updateSessionAsync } = updateSession;

  const handleJoin = useCallback(async (session) => {
    endingRef.current = false;
    await updateSessionAsync({ id: session.id, data: { status: "active", started_at: new Date().toISOString() } });
    setActiveSession(session);
    setShowDocumentation(false);
  }, [updateSessionAsync]);

  const handleDisconnect = async () => {
    if (!activeSession) {
      setShowDocumentation(false);
      return;
    }
    // The in-room "End session" control, the outer button, and Telnyx's own
    // "disconnected" event can all fire at nearly the same moment. Complete the
    // session exactly once so we don't double-write the chart or stack toasts.
    if (endingRef.current) return;
    endingRef.current = true;

    const endTime = new Date();
    const startTime = activeSession.started_at ? new Date(activeSession.started_at) : endTime;
    const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));
    await updateSession.mutateAsync({
      id: activeSession.id,
      data: {
        status: "completed",
        ended_at: endTime.toISOString(),
        duration_minutes: durationMinutes
      }
    });
    setShowDocumentation(true);
    toast.success("Session ended — please complete documentation");
  };

  const handleSaveDocumentation = async (docData) => {
    if (activeSession) {
      await updateSession.mutateAsync({
        id: activeSession.id,
        data: docData
      });
      setActiveSession(null);
      setShowDocumentation(false);
      endingRef.current = false;
    }
  };

  const handleCancel = async (session) => {
    await updateSession.mutateAsync({ id: session.id, data: { status: "cancelled" } });
    toast.success("Session cancelled");
  };

  // Deep link support: /Telehealth?room=<room_name> opens and joins that
  // session for the authorized staff member who followed an invite/join link.
  // Sessions are server-scoped, so an unmatched/forbidden room simply no-ops.
  useEffect(() => {
    const roomParam = searchParams.get("room");
    if (!roomParam || autoJoinedRef.current || activeSession || sessions.length === 0) return;
    const match = sessions.find((s) => s.room_name === roomParam);
    if (match && (match.status === "scheduled" || match.status === "active")) {
      autoJoinedRef.current = true;
      handleJoin(match);
    }
  }, [searchParams, sessions, activeSession, handleJoin]);

  const upcoming = sessions.filter(s => s.status === "scheduled" || s.status === "active");
  const past = sessions.filter(s => s.status === "completed" || s.status === "cancelled");

  const stats = {
    total: sessions.length,
    completed: sessions.filter(s => s.status === "completed").length,
    scheduled: sessions.filter(s => s.status === "scheduled").length,
    totalMinutes: sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0)
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Video}
        eyebrow="Communication"
        title="Telehealth"
        description="Secure video visits with patients via Telnyx"
        favoritePage="Telehealth"
        actions={
          <Button onClick={() => setShowNewSession(true)} className="gap-2 w-full sm:w-auto">
            <Plus className="w-4 h-4" /> Schedule Telehealth
          </Button>
        }
      />

      {/* Stats — shared StatCard treatment, matching Dashboard/Patients. */}
      <div className="px-3 sm:px-4 md:px-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Total Sessions" value={stats.total} icon={Video} tone="navy" />
        <StatCard label="Completed" value={stats.completed} icon={CheckCircle2} tone="emerald" />
        <StatCard label="Upcoming" value={stats.scheduled} icon={Calendar} tone="amber" />
        <StatCard label="Total Minutes" value={stats.totalMinutes} icon={Clock} tone="gold" />
      </div>

      {/* Active session */}
      {activeSession && !showDocumentation && (
        <div className="px-3 sm:px-4 md:px-6 space-y-4 max-w-4xl">
          <Card className="border-emerald-400 bg-emerald-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="font-semibold text-emerald-800">Active Session — {activeSession.patient_name}</span>
                </div>
                <Button size="sm" variant="outline" onClick={handleDisconnect} className="text-red-600 border-red-300">
                  End Session
                </Button>
              </div>
              <TelehealthCall
                roomName={activeSession.room_name}
                identity={currentUser?.full_name || currentUser?.email}
                role="staff"
                onDisconnect={handleDisconnect}
              />
            </CardContent>
          </Card>
          <RealtimeVitalMonitor
            sessionId={activeSession.id}
            patientId={activeSession.patient_id}
          />
        </div>
      )}

      {/* Post-session documentation */}
      {showDocumentation && activeSession && (
        <div className="px-3 sm:px-4 md:px-6">
          <SessionDocumentation
          sessionId={activeSession.id}
            onSave={handleSaveDocumentation}
            initialData={activeSession}
          />
        </div>
      )}

      {/* Session lists */}
      <div className="px-3 sm:px-4 md:px-6">
      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">
            Upcoming <Badge className="ml-1.5 bg-blue-100 text-blue-700">{upcoming.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="past">
            Past <Badge className="ml-1.5 bg-slate-100 text-slate-600">{past.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-4 space-y-3">
          {upcoming.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Video className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>No upcoming sessions. Create one to get started.</p>
            </div>
          ) : upcoming.map(s => (
            <SessionCard key={s.id} session={s} onJoin={handleJoin} onCancel={handleCancel} onTextPatient={handleTextPatient} />
          ))}
        </TabsContent>

        <TabsContent value="past" className="mt-4 space-y-3">
          {past.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Clock className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>No completed sessions yet.</p>
            </div>
          ) : past.map(s => (
            <SessionCard key={s.id} session={s} onJoin={() => {}} onCancel={() => {}} />
          ))}
        </TabsContent>
      </Tabs>
      </div>

      {/* New Session Dialog */}
      <Dialog open={showNewSession} onOpenChange={setShowNewSession}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto sm:rounded-2xl border-0 shadow-2xl">
          <DialogTitle className="text-xl font-bold text-slate-900">Schedule Telehealth Visit</DialogTitle>
          <NewSessionForm
            patients={patients}
            currentUser={currentUser}
            onSubmit={(data) => createSession.mutate(data)}
            loading={createSession.isPending}
          />
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function NewSessionForm({ patients, currentUser, onSubmit, loading }) {
  const [form, setForm] = useState({
    patient_id: "",
    visit_type: "routine_followup",
    scheduled_at: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const patient = patients.find(p => p.id === form.patient_id);
    const roomName = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : "Unknown";
    // Patient-facing capability link: the token is the patient's access grant.
    const inviteLink = buildPatientJoinLink(window.location.origin, roomName, generateJoinToken());
    onSubmit({
      room_name: roomName,
      patient_id: form.patient_id,
      patient_name: patientName,
      host_email: currentUser?.email,
      host_name: currentUser?.full_name,
      visit_type: form.visit_type,
      scheduled_at: form.scheduled_at || new Date().toISOString(),
      status: "scheduled",
      invite_link: inviteLink,
      participant_list: [currentUser?.full_name || currentUser?.email, patientName].filter(Boolean)
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 py-2">
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-slate-900">Patient</Label>
        <Select value={form.patient_id} onValueChange={v => setForm(f => ({ ...f, patient_id: v }))}>
          <SelectTrigger className="w-full h-11 border-slate-300 rounded-lg shadow-sm hover:border-slate-400">
            <SelectValue placeholder="Select patient..." />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            {patients.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-semibold text-slate-900">Visit Type</Label>
        <Select value={form.visit_type} onValueChange={v => setForm(f => ({ ...f, visit_type: v }))}>
          <SelectTrigger className="w-full h-11 border-slate-300 rounded-lg shadow-sm hover:border-slate-400">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            {visitTypes.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-semibold text-slate-900">Scheduled Date & Time</Label>
        <Input
          type="datetime-local"
          className="w-full h-11 border-slate-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500"
          value={form.scheduled_at}
          onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
        />
      </div>

      <Button type="submit" className="w-full gap-2 h-11 rounded-lg font-semibold mt-2" disabled={loading || !form.patient_id}>
        <Video className="w-4 h-4" />
        {loading ? "Scheduling..." : "Schedule Telehealth Visit"}
      </Button>
    </form>
  );
}