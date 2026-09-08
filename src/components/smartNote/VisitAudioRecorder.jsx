import { useState, useRef, useEffect } from "react";
import { configNotReadyMessage } from "@/lib/aiFeatureError";
import { formatTime } from "@/lib/formatTime";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { Mic, MicOff, X, CheckCircle2, AlertCircle, Loader2, FileAudio } from "lucide-react";
import { toast } from "sonner";
import { enhanceTranscription } from "../utils/medicalDictionary";
import DictationSectionMapper from "./DictationSectionMapper";
import { getAuthorityBoundUserMedia, stopMediaStream } from '@/lib/tenantMediaDevices';
import AuthorityBoundAudio from '@/components/ui/AuthorityBoundAudio';
import {
  getTenantSdkRealmAbortSignal,
  isTenantSdkRealmLeaseCurrent,
} from '@/lib/tenantSdkRealmGate';

// One unified record-and-transcribe control for Step 1, replacing the two separate
// recorders. The recording itself is mode-agnostic; only the post-stop processing
// differs, so a `mode` toggle selects the backend + output shape:
//   - "narrative": Whisper transcription -> medical-term enhancement -> the
//     DictationSectionMapper, which appends the mapped note via onTranscribed.
//   - "soap":      transcribeAndGenerateSOAPNote -> a formatted SOAP block appended
//     via onTranscribed.
// PHI-audio cleanup (detach onstop before stop, release the mic, revoke blob URLs,
// clear the timer) is ported verbatim from the prior EnhancedAudioRecorder so a mid-
// recording unmount never uploads audio or setStates after unmount.
export default function VisitAudioRecorder({ onTranscribed, disabled = false }) {
  const [mode, setMode] = useState("narrative");
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [showMapper, setShowMapper] = useState(false);
  // Advisory-only structured SOAP shown for reference. It is NEVER the saved /
  // grounded source — the raw transcript is, so the Step-2 value-guard + grounding
  // verify the final note against what was actually said (not an AI structuring
  // that could have invented a value).
  const [soapPreview, setSoapPreview] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const mediaAcquisitionRef = useRef(0);
  const mountedRef = useRef(true);
  const readerRef = useRef(null);
  const recordingLeaseRef = useRef(null);
  // Capture the mode at stop time so the async onstop handler doesn't read a stale
  // closure if the toggle changes after recording starts.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const startRecording = async () => {
    const acquisition = ++mediaAcquisitionRef.current;
    let acquiredStream = null;
    try {
      setError(null);
      // Clear any prior result so a new recording starts clean — otherwise a stale
      // SOAP preview / mapper from a previous take could linger under the new one.
      setSoapPreview(null);
      setTranscript(null);
      setShowMapper(false);
      const { realmLease, stream } = await getAuthorityBoundUserMedia({ audio: true });
      acquiredStream = stream;
      if (
        !mountedRef.current
        || acquisition !== mediaAcquisitionRef.current
        || !isTenantSdkRealmLeaseCurrent(realmLease)
      ) {
        stopMediaStream(stream);
        return;
      }
      recordingLeaseRef.current = realmLease;
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (
          mountedRef.current
          && acquisition === mediaAcquisitionRef.current
          && isTenantSdkRealmLeaseCurrent(realmLease)
          && e.data.size > 0
        ) {
          audioChunksRef.current.push(e.data);
        }
      };
      mediaRecorder.onstop = async () => {
        if (
          !mountedRef.current
          || acquisition !== mediaAcquisitionRef.current
          || !isTenantSdkRealmLeaseCurrent(realmLease)
        ) return;
        if (modeRef.current === "soap") {
          await processSOAP(realmLease, acquisition);
        } else {
          // Use the recorder's actual container type. MediaRecorder with no
          // explicit mimeType produces audio/webm (Opus) in Chromium, so
          // labeling it audio/mp3 makes Whisper mis-decode by extension.
          const type = mediaRecorderRef.current?.mimeType || "audio/webm";
          const blob = new Blob(audioChunksRef.current, { type });
          setAudioUrl(URL.createObjectURL(blob));
          await processNarrative(blob, realmLease, acquisition);
        }
      };

      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch {
      stopMediaStream(acquiredStream);
      if (streamRef.current === acquiredStream) streamRef.current = null;
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        recorder.ondataavailable = null;
      }
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
      if (acquisition === mediaAcquisitionRef.current) {
        setError("Microphone access denied. Please enable microphone in browser settings.");
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  // Narrative: upload the recorded Blob as a File (multipart, with auth) to the
  // Whisper backend, enhance medical terms, then hand to the section mapper.
  const processNarrative = async (blob, realmLease, acquisition) => {
    setProcessing(true);
    try {
      const mime = blob.type || "audio/webm";
      const ext = mime.split(";")[0].split("/")[1] || "webm";
      const audioFile = new File([blob], `recording-${Date.now()}.${ext}`, { type: mime });
      const response = await base44.functions.invoke("transcribeAudioWithWhisper", { file: audioFile });
      if (
        !mountedRef.current
        || acquisition !== mediaAcquisitionRef.current
        || !isTenantSdkRealmLeaseCurrent(realmLease)
      ) return;
      const enhanced = enhanceTranscription(response.data?.text || "");
      setTranscript(enhanced);
      setShowMapper(true);
    } catch (err) {
      if (
        !mountedRef.current
        || acquisition !== mediaAcquisitionRef.current
        || !isTenantSdkRealmLeaseCurrent(realmLease)
      ) return;
      const friendly = configNotReadyMessage(err);
      setError(friendly || `Transcription error: ${err.message}`);
      if (!friendly) console.error("Transcription error:", err);
    } finally {
      if (
        mountedRef.current
        && acquisition === mediaAcquisitionRef.current
        && isTenantSdkRealmLeaseCurrent(realmLease)
      ) setProcessing(false);
    }
  };

  // SOAP: send the audio as base64 to the SOAP backend, which transcribes AND
  // structures it; append the formatted block.
  const processSOAP = async (realmLease, acquisition) => {
    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    if (blob.size === 0) return;
    setProcessing(true);
    try {
      const signal = getTenantSdkRealmAbortSignal(realmLease);
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        readerRef.current = reader;
        const abort = () => {
          try { reader.abort(); } catch { /* already complete */ }
          reject(new Error('Audio processing expired because workspace authority changed'));
        };
        signal.addEventListener('abort', abort, { once: true });
        reader.onload = () => resolve(String(reader.result || '').split(",")[1] || '');
        reader.onerror = reject;
        reader.onabort = () => reject(
          new Error('Audio processing expired because workspace authority changed'),
        );
        reader.readAsDataURL(blob);
        reader.addEventListener('loadend', () => {
          signal.removeEventListener('abort', abort);
          if (readerRef.current === reader) readerRef.current = null;
        }, { once: true });
      });
      if (
        !mountedRef.current
        || acquisition !== mediaAcquisitionRef.current
        || !isTenantSdkRealmLeaseCurrent(realmLease)
      ) return;
      const res = await base44.functions.invoke("transcribeAndGenerateSOAPNote", {
        audio_base64: base64,
        mime_type: blob.type,
      });
      if (
        !mountedRef.current
        || acquisition !== mediaAcquisitionRef.current
        || !isTenantSdkRealmLeaseCurrent(realmLease)
      ) return;
      if (res.data && res.data.success) {
        const soap = res.data.data;
        const rawTranscript = (soap.raw_transcript || "").trim();
        if (rawTranscript) {
          // Feed the TRANSCRIPT (what was actually said) into the draft as the
          // grounding source of truth; the structured SOAP is kept only as an
          // advisory reference card. The constrained scribe in Step 2 re-voices
          // and grounds this transcript, so a backend AI fabrication can't slip
          // into the chart unverified.
          onTranscribed?.(enhanceTranscription(rawTranscript));
          setSoapPreview(soap);
          toast.success("Transcribed — review and generate a verified note in the next step.");
        } else {
          // No transcript came back: fall back to the structured block so the
          // recording isn't lost. It still passes through Step-2 verification.
          const formatted = `
[SOAP draft from audio — verify every detail in the next step]
Subjective: ${soap.subjective || "N/A"}

Objective: ${soap.objective || "N/A"}

Assessment: ${soap.assessment || "N/A"}

Plan: ${soap.plan || "N/A"}
`.trim();
          onTranscribed?.(formatted);
          toast.success("SOAP draft generated — verify it in the next step.");
        }
      } else {
        toast.error("Failed to generate SOAP note.");
      }
    } catch (err) {
      if (
        !mountedRef.current
        || acquisition !== mediaAcquisitionRef.current
        || !isTenantSdkRealmLeaseCurrent(realmLease)
      ) return;
      const friendly = configNotReadyMessage(err);
      if (friendly) toast.error(friendly);
      else { console.error("SOAP processing error:", err); toast.error("Error processing audio."); }
    } finally {
      if (
        mountedRef.current
        && acquisition === mediaAcquisitionRef.current
        && isTenantSdkRealmLeaseCurrent(realmLease)
      ) setProcessing(false);
    }
  };

  const clearRecording = () => {
    setAudioUrl(null);
    setRecordingTime(0);
    setError(null);
    setTranscript(null);
    setShowMapper(false);
    setSoapPreview(null);
  };

  // Release the mic, recorder, and timer on unmount mid-recording. Detach onstop
  // FIRST so cleanup only releases the mic — it must not upload PHI audio for a
  // recording the user never accepted, nor setState after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mediaAcquisitionRef.current += 1;
      const mr = mediaRecorderRef.current;
      if (mr) {
        mr.onstop = null;
        mr.ondataavailable = null;
      }
      if (mr && mr.state !== "inactive") {
        try { mr.stop(); } catch { /* already stopped */ }
      }
      try { readerRef.current?.abort(); } catch { /* already complete */ }
      readerRef.current = null;
      recordingLeaseRef.current = null;
      audioChunksRef.current = [];
      stopMediaStream(streamRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Revoke the recorded-audio object URL when it changes or the component unmounts.
  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl); };
  }, [audioUrl]);

  const busy = recording || processing;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
      {/* Format toggle — disabled mid-capture so the mode can't change under a recording. */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Transcription format">
        {[
          { key: "narrative", label: "Narrative" },
          { key: "soap", label: "SOAP" },
        ].map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            disabled={busy}
            aria-pressed={mode === m.key}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition disabled:opacity-50 ${mode === m.key ? "bg-white shadow-sm text-navy-700" : "text-slate-500 hover:text-slate-700"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded p-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto" aria-label="Dismiss error">
            <X className="w-3 h-3 text-red-600" />
          </button>
        </div>
      )}

      {!audioUrl ? (
        <Button
          onClick={recording ? stopRecording : startRecording}
          disabled={disabled || processing}
          variant={recording ? "destructive" : "outline"}
          size="sm"
          className="h-9 gap-1.5 text-xs w-full"
        >
          {recording ? (
            <><MicOff className="w-3.5 h-3.5 animate-pulse" /> Stop Recording ({formatTime(recordingTime)})</>
          ) : processing ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {mode === "soap" ? "Generating SOAP Note…" : "Transcribing…"}</>
          ) : (
            <>{mode === "soap" ? <FileAudio className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />} {mode === "soap" ? "Record SOAP Visit" : "Record Visit"}</>
          )}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded p-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            <span className="text-xs text-green-700 font-medium flex-1">
              {processing ? "Transcribing audio…" : "Audio recorded & transcribed"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <AuthorityBoundAudio src={audioUrl} controls className="flex-1 h-8 text-xs" />
            <Button onClick={clearRecording} variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" title="Clear recording" aria-label="Clear recording">
              <X className="w-4 h-4" />
            </Button>
          </div>

          {transcript && showMapper && (
            <div className="border-t border-slate-200 pt-3 mt-3">
              <p className="text-xs font-semibold text-slate-600 mb-2">📍 Auto-map transcription into note sections</p>
              <DictationSectionMapper
                transcript={transcript}
                onSectionsMapped={(sections) => {
                  if (sections && Object.values(sections).some((v) => v?.trim())) {
                    const fullNote = Object.entries(sections)
                      .filter(([, v]) => v?.trim())
                      .map(([, v]) => v.trim())
                      .join("\n\n");
                    onTranscribed?.(fullNote);
                  }
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Advisory SOAP structure. Rendered OUTSIDE the audioUrl branch: the SOAP
          path deliberately never keeps the PHI audio blob (audioUrl stays null),
          so if this card lived inside that branch it could never appear. */}
      {soapPreview && (
        <div className="border-t border-slate-200 pt-3 mt-3">
          <p className="text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1.5">
            <FileAudio className="w-3.5 h-3.5" /> AI SOAP structure — reference only (not saved)
          </p>
          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md p-2 space-y-1 leading-relaxed">
            {["subjective", "objective", "assessment", "plan"].map((k) => (
              <p key={k}><span className="font-semibold capitalize text-slate-700">{k}:</span> {soapPreview[k] || "N/A"}</p>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Your transcript was added to the note. Generate a verified note in the next step — every value is checked against what was said.</p>
        </div>
      )}
    </div>
  );
}
