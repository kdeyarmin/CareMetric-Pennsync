import { useState, useRef, useEffect, useCallback } from "react";
import { structureDictatedVisit } from '@/functions/structureDictatedVisit';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Mic, MicOff, Loader2, FileText, Copy, Check, RefreshCw,
  Stethoscope, ClipboardList, AlertCircle, Wand2
} from "lucide-react";
import {
  createAuthorityBoundSpeechRecognition,
  preferLocalSpeechRecognition,
  LOCAL_SPEECH_REFUSED_MESSAGE,
  SPEECH_LOCALITY,
} from '@/lib/tenantMediaDevices';

const VISIT_TYPES = [
  { value: "skilled_nursing", label: "Skilled Nursing Visit", tag: "SN" },
  { value: "admission", label: "Admission Assessment", tag: "ADM" },
  { value: "recertification", label: "Recertification Visit", tag: "RECERT" },
  { value: "discharge", label: "Discharge Summary", tag: "DC" },
  { value: "hospice_comfort", label: "Hospice Comfort Care", tag: "HSP" },
  { value: "prn", label: "PRN Visit", tag: "PRN" },
  { value: "medication_review", label: "Medication Review", tag: "MED" },
];



export default function RealTimeDictationScribe({ currentUser }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [visitType, setVisitType] = useState("skilled_nursing");
  const [structuredNote, setStructuredNote] = useState("");
  const [isStructuring, setIsStructuring] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [browserSupported, setBrowserSupported] = useState(true);

  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  // The on-device check is asynchronous and this recognizer is configured in an
  // effect but STARTED from a click, so the promise is held and awaited at the
  // click rather than raced: a nurse who taps the moment the panel opens still
  // gets the local requirement applied before `start()`.
  // Both refs are widened to `string` deliberately: seeding one from a single
  // member of SPEECH_LOCALITY narrows it to that literal, and checkJs then calls
  // the comparison below always-false — which the typecheck gate catches as a
  // real defect even though the ref is reassigned at runtime.
  const localityRef = useRef(/** @type {Promise<string>} */ (Promise.resolve(SPEECH_LOCALITY.NO_FLAG)));
  // The settled value, written before `start()` so the synchronous error handler
  // can read it without resolving a promise of its own.
  const resolvedLocalityRef = useRef(/** @type {string} */ (SPEECH_LOCALITY.NO_FLAG));
  // Only the newest tap may start. While the on-device check is still pending
  // `isListening` is false and the button is live, so two taps both reach the
  // start branch with the same stale render state; both continuations would then
  // call `start()` on the SAME recognizer, and the second throws
  // `InvalidStateError` from an async callback with nothing to catch it.
  const startGenerationRef = useRef(0);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setBrowserSupported(false);
      return;
    }

    let binding;
    try {
      binding = createAuthorityBoundSpeechRecognition(SpeechRecognition);
    } catch {
      setError("Dictation expired because workspace authority changed.");
      return;
    }
    const recognition = binding.recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;
    // Keep the audio on the device where this browser can.
    localityRef.current = preferLocalSpeechRecognition(recognition, SpeechRecognition, recognition.lang);

    recognition.onresult = (event) => {
      if (!binding.isCurrent()) return;
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalChunk += text + " ";
        } else {
          interim += text;
        }
      }
      if (finalChunk) {
        transcriptRef.current += finalChunk;
        setTranscript(transcriptRef.current);
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event) => {
      if (!binding.isCurrent()) return;
      if (event.error === "no-speech") return;
      // A refusal cannot succeed on retry, and `onend` below restarts whenever
      // `_shouldBeListening` is still true — so clear it here or a permission or
      // service refusal spins, re-reporting itself every cycle.
      if (event.error === "service-not-allowed" || event.error === "not-allowed") {
        recognition._shouldBeListening = false;
      }
      // Only OUR local requirement gets the plain-language sentence.
      // `service-not-allowed` also means the user agent declined the requested
      // service for its own reasons, which is not the same thing to say.
      if (resolvedLocalityRef.current === SPEECH_LOCALITY.LOCAL && event.error === "service-not-allowed") {
        setError(LOCAL_SPEECH_REFUSED_MESSAGE);
      } else {
        setError(`Microphone error: ${event.error}. Please allow microphone access.`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      if (!binding.isCurrent()) return;
      // Auto-restart if still supposed to be listening
      if (recognitionRef.current && recognitionRef.current._shouldBeListening) {
        try { recognition.start(); } catch { /* no-op */ }
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    recognitionRef.current._shouldBeListening = false;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current._shouldBeListening = false;
      }
      binding.dispose();
      recognitionRef.current = null;
    };
  }, []);

  const toggleListening = useCallback(async () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      // Also retires any start still pending, so stopping wins over a tap whose
      // availability check has not come back yet.
      startGenerationRef.current += 1;
      recognitionRef.current._shouldBeListening = false;
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setError("");
      const generation = (startGenerationRef.current += 1);
      // Settle the on-device decision before starting, so the requirement is in
      // place for the first session rather than the second.
      resolvedLocalityRef.current = await localityRef.current;
      // Unmounted, or superseded by a later tap while this one was pending.
      if (!recognitionRef.current || startGenerationRef.current !== generation) return;
      recognitionRef.current._shouldBeListening = true;
      try {
        recognitionRef.current.start();
      } catch {
        // An already-started recognizer throws here. Do not leave the restart
        // flag set, or `onend` would spin on it.
        recognitionRef.current._shouldBeListening = false;
        setError("Unable to start dictation. Please try again.");
        return;
      }
      setIsListening(true);
    }
  }, [isListening]);

  const clearTranscript = () => {
    transcriptRef.current = "";
    setTranscript("");
    setInterimTranscript("");
    setStructuredNote("");
    setError("");
  };

  const structureNote = async () => {
    const fullText = transcript.trim();
    if (!fullText) return;

    setIsStructuring(true);
    setError("");



    try {
      const result = await structureDictatedVisit({ transcript: fullText, visitType });
      setStructuredNote(result);
    } catch {
      setError("Failed to structure note. Please try again.");
    } finally {
      setIsStructuring(false);
    }
  };

  const copyNote = async () => {
    // clipboard.writeText rejects in non-secure contexts, when the tab is
    // unfocused, or when permission is denied — surface it instead of leaving
    // an unhandled rejection with no user feedback.
    try {
      await navigator.clipboard.writeText(structuredNote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy to clipboard. Please copy the note manually.");
    }
  };

  const selectedVisitType = VISIT_TYPES.find(v => v.value === visitType);

  if (!browserSupported) {
    return (
      <Alert className="bg-amber-50 border-amber-200">
        <AlertCircle className="w-4 h-4 text-amber-600" />
        <AlertDescription className="text-amber-800">
          Real-time dictation requires Chrome, Edge, or Safari. Please use the Record or Upload tabs instead.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      {/* Visit Type Selector */}
      <Card className="modern-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="w-4 h-4 text-indigo-600" />
            Visit Type & Template
          </CardTitle>
          <CardDescription>Select the visit type to apply the correct documentation template</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={visitType} onValueChange={setVisitType}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIT_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-mono">{t.tag}</Badge>
                      {t.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge className="bg-indigo-100 text-indigo-800 border border-indigo-200">
              {selectedVisitType?.label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Live Dictation */}
      <Card className="modern-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Stethoscope className="w-4 h-4 text-indigo-600" />
                Live Dictation
              </CardTitle>
              <CardDescription>Speak naturally — your observations are transcribed in real time</CardDescription>
            </div>
            {isListening && (
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-medium text-red-600">Recording</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Controls */}
          <div className="flex gap-3 flex-wrap">
            <Button
              onClick={toggleListening}
              className={isListening
                ? "bg-red-600 hover:bg-red-700 text-white gap-2"
                : "bg-indigo-600 hover:bg-indigo-700 text-white gap-2"}
              size="lg"
            >
              {isListening ? (
                <><MicOff className="w-5 h-5" /> Stop Dictation</>
              ) : (
                <><Mic className="w-5 h-5" /> Start Dictation</>
              )}
            </Button>
            {transcript && !isListening && (
              <Button variant="outline" onClick={clearTranscript} className="gap-2">
                <RefreshCw className="w-4 h-4" /> Clear & Restart
              </Button>
            )}
          </div>

          {/* Transcript Display */}
          <div className="min-h-[140px] bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono text-sm leading-relaxed">
            {!transcript && !interimTranscript && !isListening && (
              <p className="text-slate-400 italic">Transcript will appear here as you speak...</p>
            )}
            {!transcript && !interimTranscript && isListening && (
              <p className="text-slate-400 italic animate-pulse">Listening... speak your observations now</p>
            )}
            <span className="text-slate-800">{transcript}</span>
            <span className="text-slate-400 italic">{interimTranscript}</span>
          </div>

          {/* Word count */}
          {transcript && (
            <p className="text-xs text-slate-500">
              {transcript.trim().split(/\s+/).filter(Boolean).length} words transcribed
            </p>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Structure Note Button */}
      {transcript && !isListening && (
        <div className="flex justify-center">
          <Button
            onClick={structureNote}
            disabled={isStructuring}
            className="gap-2"
            size="lg"
          >
            {isStructuring ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Structuring Note...</>
            ) : (
              <><Wand2 className="w-5 h-5" /> Generate Structured Note</>
            )}
          </Button>
        </div>
      )}

      {/* Structured Note Output */}
      {structuredNote && (
        <Card className="modern-card border-indigo-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  Structured Clinical Note
                  <Badge className="bg-green-100 text-green-800 border border-green-200 text-xs">
                    {selectedVisitType?.label}
                  </Badge>
                </CardTitle>
                <CardDescription>Medicare-compliant documentation formatted for {selectedVisitType?.label}</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={copyNote} className="gap-2">
                {copied ? <><Check className="w-4 h-4 text-green-600" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Note</>}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-white border border-slate-200 rounded-lg p-5 whitespace-pre-wrap text-sm text-slate-800 leading-relaxed font-mono max-h-[500px] overflow-y-auto">
              {structuredNote}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}