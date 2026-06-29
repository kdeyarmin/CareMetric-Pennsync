import { useState, useRef, useEffect, useCallback } from "react";
import { invokeLLM } from "@/lib/invokeLLM";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Mic, MicOff, Loader2, FileText, Copy, Check, RefreshCw,
  Stethoscope, ClipboardList, AlertCircle, Wand2
} from "lucide-react";

const VISIT_TYPES = [
  { value: "skilled_nursing", label: "Skilled Nursing Visit", tag: "SN" },
  { value: "admission", label: "Admission Assessment", tag: "ADM" },
  { value: "recertification", label: "Recertification Visit", tag: "RECERT" },
  { value: "discharge", label: "Discharge Summary", tag: "DC" },
  { value: "hospice_comfort", label: "Hospice Comfort Care", tag: "HSP" },
  { value: "prn", label: "PRN Visit", tag: "PRN" },
  { value: "medication_review", label: "Medication Review", tag: "MED" },
];

const TEMPLATE_PROMPTS = {
  skilled_nursing: `Structure into a SOAP-format home health skilled nursing visit note:
SUBJECTIVE: Patient/caregiver-reported symptoms, complaints, pain (0-10), medication adherence
OBJECTIVE: Vital signs, physical assessment findings, wound status, clinical observations
ASSESSMENT: Clinical interpretation, response to treatment, homebound status justification, skilled need
PLAN: Interventions performed, patient/caregiver education, physician notification if applicable, follow-up frequency
Include Medicare-compliant homebound justification and skilled nursing need statement.`,

  admission: `Structure into a home health ADMISSION ASSESSMENT note with these sections:
REASON FOR ADMISSION: Diagnosis, referral source, admission source
CURRENT STATUS: Chief complaint, functional status, ADL independence level
VITAL SIGNS & CLINICAL ASSESSMENT: All obtained vital signs, systems review
MEDICATIONS: Current medication list as mentioned, allergies
SAFETY & ENVIRONMENT: Home safety, fall risk, caregiver support
PSYCHOSOCIAL/SOCIAL HISTORY: Living situation, support system, mental status
HOMEBOUND STATUS: Specific homebound justification per Medicare criteria
PLAN OF CARE: Goals, visit frequency, disciplines ordered, physician orders obtained`,

  recertification: `Structure into a RECERTIFICATION visit note:
PERIOD OF CARE: Certification period dates, episode number
CLINICAL STATUS: Current condition vs. admission, progress toward goals
VITAL SIGNS: All recorded vitals
ASSESSMENT BY SYSTEM: Relevant body systems reviewed
GOAL REVIEW: Goals met, goals revised, ongoing skilled need justification
HOMEBOUND STATUS: Continued homebound justification
PLAN: Continued or revised care plan, frequency for next certification period`,

  discharge: `Structure into a DISCHARGE SUMMARY note:
DISCHARGE DATE & REASON: Reason for discharge (goals met, patient request, etc.)
CLINICAL SUMMARY: Overall response to treatment, progress from admission to discharge
DISCHARGE STATUS: Functional status at discharge, vital signs, wound status if applicable
PATIENT/CAREGIVER EDUCATION COMPLETED: Topics covered, teach-back demonstrated
DISCHARGE DISPOSITION: Where patient is going, community resources, referrals made
OUTSTANDING ISSUES: Any unresolved items, follow-up recommendations
PHYSICIAN NOTIFICATION: Physician informed of discharge`,

  hospice_comfort: `Structure into a HOSPICE COMFORT CARE visit note:
COMFORT STATUS: Current symptom burden (pain, dyspnea, nausea, anxiety), comfort assessment
VITAL SIGNS: Obtained vitals, trajectory noted
CLINICAL ASSESSMENT: Systems review focused on comfort, prognosis indicators
SYMPTOM MANAGEMENT: Current medications for symptom control, effectiveness
PSYCHOSOCIAL/SPIRITUAL: Emotional and spiritual needs of patient and family
CAREGIVER ASSESSMENT: Caregiver burden, coping, education provided
GOALS OF CARE: Alignment with patient/family wishes, advance directives reviewed
INTERDISCIPLINARY TEAM COMMUNICATION: Items to report to team`,

  prn: `Structure into a PRN (as needed) visit note:
REASON FOR PRN VISIT: Precipitating event or symptom change
ASSESSMENT: Clinical findings that necessitated the visit, vital signs
INTERVENTIONS: Actions taken, treatments provided
OUTCOME: Patient response to interventions
PHYSICIAN NOTIFICATION: Was physician contacted, orders obtained
PLAN: Follow-up actions, frequency adjustment if needed`,

  medication_review: `Structure into a MEDICATION REVIEW visit note:
MEDICATIONS REVIEWED: Complete list of current medications reviewed
ADHERENCE: Patient/caregiver medication adherence assessment
SIDE EFFECTS: Any reported or observed adverse effects
EDUCATION PROVIDED: Medication teaching topics covered
RECONCILIATION: Discrepancies identified and resolved
RECOMMENDATIONS: Changes recommended or made, physician notification`,
};

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

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setBrowserSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
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
      if (event.error !== "no-speech") {
        setError(`Microphone error: ${event.error}. Please allow microphone access.`);
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (recognitionRef.current && recognitionRef.current._shouldBeListening) {
        try { recognition.start(); } catch {}
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    recognitionRef.current._shouldBeListening = false;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current._shouldBeListening = false;
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current._shouldBeListening = false;
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setError("");
      recognitionRef.current._shouldBeListening = true;
      recognitionRef.current.start();
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

    const selectedType = VISIT_TYPES.find(v => v.value === visitType);
    const templatePrompt = TEMPLATE_PROMPTS[visitType];

    const prompt = `You are a clinical documentation specialist for home health and hospice care.
A nurse has dictated the following raw observations during a patient visit:

"${fullText}"

${templatePrompt}

IMPORTANT RULES:
- Use only information provided in the dictation. Do not fabricate clinical data.
- If a section has no dictated content, write "[Not documented - clinician to complete]"
- Use professional clinical language and standard medical abbreviations
- Ensure all documentation meets Medicare home health conditions of participation
- Format cleanly with section headers in ALL CAPS followed by content
- Visit Type: ${selectedType?.label}
- Clinician: ${currentUser?.full_name || "Clinician"}

Return only the structured clinical note, no preamble.`;

    try {
      const result = await invokeLLM({ prompt, model: "claude_opus_4_8" });
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
            className="bg-gradient-to-r from-navy-600 to-indigo-600 text-white gap-2 px-8 py-3 text-base shadow-md hover:shadow-lg"
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