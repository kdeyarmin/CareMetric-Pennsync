import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
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

const HOME_HEALTH_VISIT_TYPES = [
  { value: "routine_visit", label: "Routine SN Visit" },
  { value: "admission", label: "Start of Care (SOC)" },
  { value: "recertification", label: "Recertification" },
  { value: "discharge", label: "Discharge" },
  { value: "prn", label: "PRN Visit" },
];
const HOSPICE_VISIT_TYPES = [
  { value: "routine_visit", label: "Routine Hospice Visit" },
  { value: "admission", label: "Hospice Admission" },
  { value: "recertification", label: "Recertification" },
  { value: "discharge", label: "Discharge / Revocation" },
  { value: "prn", label: "After-Hours / Crisis Visit" },
];

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
  // Monotonic id bumped on each new transcription — used to re-mount the reviewer
  // so two different recordings that happen to be the same length still reset its
  // compliance state (a length-based key would not).
  const [noteSeq, setNoteSeq] = useState(0);
  const [activeTab, setActiveTab] = useState("record");

  // Visit context + chart-save state (parity with the Smart Note flow).
  const [patientId, setPatientId] = useState("");
  const [visitType, setVisitType] = useState("routine_visit");
  const [vitals, setVitals] = useState({});
  const [savedVisitId, setSavedVisitId] = useState(null);
  const [savedAuditId, setSavedAuditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signatureImage, setSignatureImage] = useState(null);
  // Visit binding (?visitId): COMPLETE an existing scheduled visit rather than
  // create a duplicate. Cleared once saved or when the patient changes away.
  const [existingVisitId, setExistingVisitId] = useState(null);
  const boundPatientRef = useRef(null);
  const visitDate = todayEastern();

  // Mirror SmartNoteAssistant's query exactly: both flows share the ["patients"]
  // react-query cache, so they must resolve to the same data (a different filter
  // or limit under the same key would serve whichever loaded first).
  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: async () => {
      try {
        return await base44.entities.Patient.filter({ status: "active" }, "first_name", 200);
      } catch {
        return [];
      }
    },
    initialData: [],
  });
  const patient = patients.find(p => p.id === patientId);
  // Full record for the selected patient (the list query may omit large fields).
  const { data: patientDetail } = useQuery({
    queryKey: ["patientDetail", patientId],
    queryFn: () => base44.entities.Patient.get(patientId),
    enabled: !!patientId,
  });

  // Visit binding: when deep-linked with ?visitId, load it and pre-select its
  // patient + visit type so saving completes that visit instead of duplicating it.
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

  // A new patient must start a fresh visit — clear the prior save target (so a
  // re-save can't update the previous patient's visit) and the per-visit vitals
  // and signature (so one patient's readings/signature never land on another's
  // chart). The transcribed note itself is intentionally kept: the audio is often
  // captured before the patient is picked. Keep the ?visitId binding only while the
  // selected patient still matches the bound visit's.
  useEffect(() => {
    setSavedVisitId(null);
    setSavedAuditId(null);
    setSaved(false);
    setVitals({});
    setSignatureImage(null);
    if (patientId !== boundPatientRef.current) setExistingVisitId(null);
  }, [patientId]);

  const careScope = patient?.care_type || currentUser?.care_scope;
  const serviceLine = careScope === "hospice" ? "hospice" : "home_health";
  const visitTypes = careScope === "hospice" ? HOSPICE_VISIT_TYPES : HOME_HEALTH_VISIT_TYPES;

  // Process audio file (both recorded and uploaded)
  const processAudioMutation = useMutation({
    mutationFn: async (audioFile) => {
      const uploadResult = await base44.integrations.Core.UploadFile({ file: audioFile });
      const result = await base44.functions.invoke('generateNoteFromRecording', {
        audio_url: uploadResult.file_url,
      });
      return result;
    },
    onSuccess: (data) => {
      // functions.invoke returns the full axios response; this function's body
      // additionally nests its payload under `data`, so peel two layers. The
      // field is `generatedNote` (not `rough_note`).
      const body = data?.data || data;
      const payload = body?.data || body;
      setTranscription(payload.transcription || "");
      setRoughNote(payload.generatedNote || payload.transcription || "");
      // A new transcription is a new note — clear any prior save so the reviewer
      // creates a fresh visit rather than updating the last one, and bump the
      // re-mount key so its review state resets even for an equal-length note.
      setSavedVisitId(null);
      setSavedAuditId(null);
      setSaved(false);
      setNoteSeq(n => n + 1);
      logActivity(ActivityActions.NOTE_AI_GENERATED, { page: 'ClinicalDocumentation', source: 'audio_recording' });
    },
  });

  const handleRecordingComplete = (audioBlob) => {
    setRecordedAudio(audioBlob);
    processAudioMutation.mutate(audioBlob);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // The accept="audio/*" attribute is only a UI hint (trivially bypassed by
    // renaming a file); validate type + size before uploading.
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
        if (!result) { setSaving(false); return; } // fact-check failed → reviewer shows the fix panel
      }
      const out = await persistVisitNote({
        result, patientId, visitDate, visitType, roughNote, vitals,
        currentUser, patientDiagnosis: patientDetail?.primary_diagnosis || patient?.primary_diagnosis || "",
        savedVisitId, savedAuditId, existingVisitId,
      });
      if (out) {
        if (out.mode === 'create') {
          setSavedVisitId(out.visitId);
          // Bound visit is now the same-session target; re-saves update it.
          setExistingVisitId(null);
          if (out.auditId) setSavedAuditId(out.auditId);
        }
        setSaved(true);
      }
    } catch (err) {
      console.error("Save to chart error:", err);
      toast.error("Saving to the chart failed.");
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
      {/* Visit setup — patient, visit type, and structured vitals saved to the chart. */}
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

        {/* Record Tab */}
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

        {/* Upload Tab */}
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

      {/* Processing Status */}
      {isProcessing && (
        <Alert className="bg-blue-50 border-blue-200">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          <AlertDescription className="text-blue-700">Processing audio and generating rough note...</AlertDescription>
        </Alert>
      )}

      {/* Error Alert */}
      {processAudioMutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Error processing audio: {processAudioMutation.error?.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Rough Note Section */}
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

      {/* Review, enhance & save to the chart — shared constrained-scribe pipeline.
          Keyed so a new transcription / patient / visit type re-initializes it. */}
      {hasRoughNote && (
        <ConstrainedNoteReviewer
          // Re-mount only on a genuinely new note (noteSeq) or a visit-type change
          // that alters the required elements — NOT on patientId, so selecting the
          // patient last (to enable saving) doesn't discard the generated note.
          // The reviewer consumes patient/priorNote as live props for its chart
          // cross-check, so it still reflects the chosen patient without remounting.
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
              saveDisabled={saving || !!(api.fixRequired && !api.fixRequired.offlinePending) || !patientId || api.chartRisk?.hasUnacknowledgedCritical}
            />
          )}
        />
      )}
    </div>
  );
}
