import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useScopedPatients } from "@/hooks/useScopedPatients";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, Loader2, Check, User, ClipboardList } from "lucide-react";
import AudioRecorder from "./AudioRecorder";
import VitalSignsForm from "./VitalSignsForm";
import ConstrainedNoteReviewer from "../smartNote/ConstrainedNoteReviewer";
import FinalNoteDisplay from "../smartNote/FinalNoteDisplay";
import { persistVisitNote } from "../smartNote/persistVisitNote";
import { getPriorNote, parseNoteSections } from "../smartNote/noteHelpers";
import SearchablePatientSelect from "@/components/ui/SearchablePatientSelect";
import { logActivity, ActivityActions } from "../utils/activityLogger";
import { todayEastern } from "../utils/timezone";
import { toast } from "sonner";
import { validateFileUpload } from "@/components/utils/security";
import { HOME_HEALTH_VISIT_TYPES, HOSPICE_VISIT_TYPES } from "@/components/visit/visitTypes";

/**
 * AudioVisitCapture — the "Visit Scribe" choice in the Clinical Notes hub.
 *
 * Record or upload a visit audio file, transcribe it into a rough note, then
 * review/enhance it into a compliant clinical note and save it to the patient's
 * chart. Mirrors the Smart Note flow's setup (patient, visit type, structured
 * vitals) and shares its exact chart-write path via persistVisitNote, so an
 * audio-documented visit lands the same Visit / NoteConversion / ComplianceAudit
 * records — and the same vital_signs — as a typed Smart Note.
 */
export default function AudioVisitCapture({ currentUser, visitId = null }) {
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [uploadedAudio, setUploadedAudio] = useState(null);
  const [_transcription, setTranscription] = useState(null);
  const [roughNote, setRoughNote] = useState("");
  const [noteSeq, setNoteSeq] = useState(0);
  const [activeTab, setActiveTab] = useState("record");

  const [patientId, setPatientId] = useState("");
  const [visitType, setVisitType] = useState("routine_visit");
  const [vitals, setVitals] = useState({});
  const [savedVisitId, setSavedVisitId] = useState(null);
  const [savedAuditId, setSavedAuditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signatureImage, setSignatureImage] = useState(null);
  const [existingVisitId, setExistingVisitId] = useState(null);
  const boundPatientRef = useRef(null);
  const visitDate = todayEastern();

  const { data: patients = [] } = useScopedPatients({
    status: "active",
    sort: "first_name",
    limit: 200,
  });
  const patient = patients.find(p => p.id === patientId);
  const { data: patientDetail } = useQuery({
    queryKey: ["patientDetail", patientId],
    queryFn: () => base44.entities.Patient.get(patientId),
    enabled: !!patientId,
  });

  const { data: boundVisit } = useQuery({
    queryKey: ["visit", visitId],
    queryFn: () => base44.entities.Visit.get(visitId),
    enabled: !!visitId,
  });
  useEffect(() => {
    if (!boundVisit?.id) return;
    boundPatientRef.current = boundVisit.patient_id;
    setExistingVisitId(boundVisit.id);
    if (boundVisit.patient_id) setPatientId(boundVisit.patient_id);
    if (boundVisit.visit_type) setVisitType(boundVisit.visit_type);
  }, [boundVisit]);

  useEffect(() => {
    setSavedVisitId(null);
    setSavedAuditId(null);
    setSaved(false);
    setVitals({});
    setSignatureImage(null);
    setExistingVisitId(patientId === boundPatientRef.current && boundVisit?.patient_id === patientId ? boundVisit.id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundVisit intentionally omitted; this should only reset state on a patient switch, not on every boundVisit refetch
  }, [patientId]);

  const careScope = patient?.care_type || currentUser?.care_scope;
  const serviceLine = careScope === "hospice" ? "hospice" : "home_health";
  const visitTypes = careScope === "hospice" ? HOSPICE_VISIT_TYPES : HOME_HEALTH_VISIT_TYPES;

  const processAudioMutation = useMutation({
    mutationFn: async (audioFile) => {
      if (!patientId) throw new Error('Patient is required to generate a note from audio');
      const uploadResult = await base44.integrations.Core.UploadFile({ file: audioFile });
      const result = await base44.functions.invoke('generateNoteFromRecording', {
        audio_url: uploadResult.file_url,
        patient_id: patientId,
        visit_type: visitType || 'routine_visit',
        diagnosis: patient?.primary_diagnosis || undefined,
      });
      const body = result?.data ?? result;
      if (body?.error) throw new Error(body.error);
      return body;
    },
    onSuccess: (data) => {
      const payload = data?.data || data;
      const transcription = payload.transcription || "";
      setTranscription(transcription);
      setRoughNote(transcription || payload.generatedNote || "");
      setSavedVisitId(null);
      setSavedAuditId(null);
        setSaved(false);
      setNoteSeq(n => n + 1);
      logActivity(ActivityActions.NOTE_AI_GENERATED, { page: 'ClinicalDocumentation', source: 'audio_recording' });
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to generate note from recording');
    },
  });

  const handleRecordingComplete = (audioBlob) => {
    setRecordedAudio(audioBlob);
    processAudioMutation.mutate(audioBlob);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const check = validateFileUpload(file, {
      maxSize: 100 * 1024 * 1024,
      allowedTypes: ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg'],
      allowedExtensions: ['.webm', '.wav', '.mp3', '.mpeg', '.m4a', '.mp4', '.ogg'],
    });
    if (!check.valid) { toast.error(check.error); return; }
    setUploadedAudio(file);
    processAudioMutation.mutate(file);
  };

  const handleSave = async (api) => {
    if (!patientId || !currentUser?.email) {
      toast.error("Select a patient to save this note to their chart.");
      return;
    }
    if (api.chartRisk?.hasUnacknowledgedCritical) {
      toast.error("Acknowledge the chart safety conflict before saving to the chart.");
      return;
    }
    setSaving(true);
    try {
      let result = api.result;
      if (api.dirty) {
        result = await api.recheck();
        if (!result) { setSaving(false); return; }
      }
      const out = await persistVisitNote({
        result, patientId, visitDate, visitType, roughNote, vitals,
        currentUser, patientDiagnosis: patientDetail?.primary_diagnosis || patient?.primary_diagnosis || "",
        savedVisitId, savedAuditId, existingVisitId,
        source: "audio",
      });
      if (out) {
        if (out.mode === 'create') {
          setSavedVisitId(out.visitId);
          setExistingVisitId(null);
          if (out.auditId) setSavedAuditId(out.auditId);
        } else if (out.mode === 'update') {
          setSavedVisitId(out.visitId);
          if (out.auditId) setSavedAuditId(out.auditId);
        }
        setSaved(true);
      }
    } catch (err) {
      console.error("Save to chart error:", err);
      toast.error(err?.code === "OFFLINE_SAVE_BLOCKED" ? err.message : "Saving to the chart failed.");
    } finally {
      setSaving(false);
    }
  };

  const resetCapture = () => {
    setRecordedAudio(null);
    setUploadedAudio(null);
    setTranscription(null);
    setRoughNote("");
    setVitals({});
    setSavedVisitId(null);
    setSavedAuditId(null);
    setSaved(false);
    setSignatureImage(null);
    setExistingVisitId(null);
  };

  const hasAudio = recordedAudio || uploadedAudio;
  const isProcessing = processAudioMutation.isPending;
  const hasRoughNote = !!roughNote;

  return (
    <div className="space-y-4">
      <Card className="modern-card">
        <CardContent className="p-4 space-y-4">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <User className="w-3.5 h-3.5 text-navy-600" />
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Patient</span>
            </div>
            <SearchablePatientSelect
              patients={patients}
              value={patientId}
              onValueChange={setPatientId}
              className="bg-slate-50 border-slate-200 h-11 text-sm rounded-xl"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <ClipboardList className="w-3.5 h-3.5 text-navy-600" />
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Visit Type</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {visitTypes.map(v => (
                <button key={v.value} type="button" onClick={() => setVisitType(v.value)}
                  className={`py-2 px-2 rounded-xl text-xs font-semibold border-2 transition-all text-center leading-tight min-h-[44px] ${visitType === v.value ? "bg-navy-600 border-navy-600 text-white shadow-md" : "bg-slate-50 border-slate-200 text-slate-600 hover:border-navy-300 hover:bg-navy-50"}`}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <VitalSignsForm vitalSigns={vitals} onChange={setVitals} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="record">Record Visit</TabsTrigger>
          <TabsTrigger value="upload">Upload Audio</TabsTrigger>
        </TabsList>

        <TabsContent value="record" className="space-y-4">
          <Card className="modern-card">
            <CardHeader>
              <CardTitle>Record Patient Interaction</CardTitle>
              <CardDescription>Click record to capture the patient visit conversation</CardDescription>
            </CardHeader>
            <CardContent>
              {!hasAudio ? (
                <AudioRecorder onAudioProcessed={handleRecordingComplete} isProcessing={isProcessing} />
              ) : (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
                    <Check className="w-5 h-5 text-green-600" />
                    <span className="text-green-700 font-medium">Audio recorded successfully</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload" className="space-y-4">
          <Card className="modern-card">
            <CardHeader>
              <CardTitle>Upload Audio File</CardTitle>
              <CardDescription>Upload a previously recorded audio file (MP3, WAV, M4A)</CardDescription>
            </CardHeader>
            <CardContent>
              {!hasAudio ? (
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-indigo-400 transition-colors cursor-pointer">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="audio-upload"
                  />
                  <label htmlFor="audio-upload" className="cursor-pointer">
                    <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                    <p className="text-slate-900 font-medium">Click to upload or drag audio file</p>
                    <p className="text-slate-500 text-sm">MP3, WAV, M4A up to 100MB</p>
                  </label>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
                  <Check className="w-5 h-5 text-green-600" />
                  <span className="text-green-700 font-medium">Audio uploaded successfully</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {isProcessing && (
        <Alert className="bg-blue-50 border-blue-200">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          <AlertDescription className="text-blue-700">Processing audio and generating rough note...</AlertDescription>
        </Alert>
      )}

      {processAudioMutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Error processing audio: {processAudioMutation.error?.message}
          </AlertDescription>
        </Alert>
      )}

      {hasRoughNote && (
        <Card className="modern-card">
          <CardHeader>
            <CardTitle>Rough Note from Recording</CardTitle>
            <CardDescription>Review and refine the transcribed content</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-slate-50 rounded-lg p-4 max-h-64 overflow-y-auto border border-slate-200">
              <p className="text-slate-800 whitespace-pre-wrap">{roughNote}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {hasRoughNote && (
        <ConstrainedNoteReviewer
          key={`${visitType}|${noteSeq}`}
          roughNote={roughNote}
          serviceLine={serviceLine}
          visitType={visitType}
          priorNote={getPriorNote(patientDetail || patient)}
          patient={patientDetail || patient}
          currentUser={currentUser}
          renderFinalNote={(api) => (
            <FinalNoteDisplay
              finalNote={api.finalNote}
              setFinalNote={api.setFinalNote}
              onCopy={async () => {
                try {
                  await navigator.clipboard.writeText(api.finalNote);
                  setCopied(true); setTimeout(() => setCopied(false), 2500);
                } catch {
                  setCopied(false);
                  toast.error("Couldn't copy to the clipboard. Select the note text and copy manually.");
                }
              }}
              copied={copied}
              patient={patient}
              visitType={visitType}
              analysisScore={api.coverage}
              analysis={{ overall_score: api.coverage, compliance_score: api.coverage, findings: [] }}
              currentUser={currentUser}
              signatureImage={signatureImage}
              setSignatureImage={setSignatureImage}
              onReset={resetCapture}
              originalNote={roughNote}
              noteSections={parseNoteSections(api.finalNote)}
              onSave={() => handleSave(api)}
              saving={saving}
              saved={saved && !api.dirty}
              saveDisabled={saving || !!api.fixRequired || !patientId || api.chartRisk?.hasUnacknowledgedCritical}
            />
          )}
        />
      )}
    </div>
  );
}
