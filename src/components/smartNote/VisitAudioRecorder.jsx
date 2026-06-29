import { useState, useRef, useEffect } from "react";
import { configNotReadyMessage } from "@/lib/aiFeatureError";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { Mic, MicOff, X, CheckCircle2, AlertCircle, Loader2, FileAudio } from "lucide-react";
import { toast } from "sonner";
import { enhanceTranscription } from "../utils/medicalDictionary";
import DictationSectionMapper from "./DictationSectionMapper";

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
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  // Capture the mode at stop time so the async onstop handler doesn't read a stale
  // closure if the toggle changes after recording starts.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        if (modeRef.current === "soap") {
          await processSOAP();
        } else {
          const blob = new Blob(audioChunksRef.current, { type: "audio/mp3" });
          setAudioUrl(URL.createObjectURL(blob));
          await processNarrative(blob);
        }
      };

      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch {
      setError("Microphone access denied. Please enable microphone in browser settings.");
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
  const processNarrative = async (blob) => {
    setProcessing(true);
    try {
      const audioFile = new File([blob], `recording-${Date.now()}.mp3`, { type: "audio/mp3" });
      const response = await base44.functions.invoke("transcribeAudioWithWhisper", { file: audioFile });
      const enhanced = enhanceTranscription(response.data?.text || "");
      setTranscript(enhanced);
      setShowMapper(true);
    } catch (err) {
      const friendly = configNotReadyMessage(err);
      setError(friendly || `Transcription error: ${err.message}`);
      if (!friendly) console.error("Transcription error:", err);
    } finally {
      setProcessing(false);
    }
  };

  // SOAP: send the audio as base64 to the SOAP backend, which transcribes AND
  // structures it; append the formatted block.
  const processSOAP = async () => {
    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    if (blob.size === 0) return;
    setProcessing(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await base44.functions.invoke("transcribeAndGenerateSOAPNote", {
        audio_base64: base64,
        mime_type: blob.type,
      });
      if (res.data && res.data.success) {
        const soap = res.data.data;
        const formatted = `
[SOAP Note Generated from Audio]
Subjective: ${soap.subjective || "N/A"}

Objective: ${soap.objective || "N/A"}

Assessment: ${soap.assessment || "N/A"}

Plan: ${soap.plan || "N/A"}
`.trim();
        onTranscribed?.(formatted);
        toast.success("SOAP note generated!");
      } else {
        toast.error("Failed to generate SOAP note.");
      }
    } catch (err) {
      const friendly = configNotReadyMessage(err);
      if (friendly) toast.error(friendly);
      else { console.error("SOAP processing error:", err); toast.error("Error processing audio."); }
    } finally {
      setProcessing(false);
    }
  };

  const clearRecording = () => {
    setAudioUrl(null);
    setRecordingTime(0);
    setError(null);
    setTranscript(null);
    setShowMapper(false);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Release the mic, recorder, and timer on unmount mid-recording. Detach onstop
  // FIRST so cleanup only releases the mic — it must not upload PHI audio for a
  // recording the user never accepted, nor setState after unmount.
  useEffect(() => {
    return () => {
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") {
        mr.onstop = null;
        try { mr.stop(); } catch { /* already stopped */ }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
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
            <audio src={audioUrl} controls className="flex-1 h-8 text-xs" />
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
    </div>
  );
}
