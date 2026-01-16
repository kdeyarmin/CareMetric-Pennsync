import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Zap, Copy } from "lucide-react";
import { toast } from "sonner";

const SMART_PHRASES = {
  "assessment normal": "Patient assessment reveals all vital signs within normal limits. Patient is alert and oriented times three. No acute distress noted.",
  "wound care": "Wound care performed with sterile technique. Wound bed is clean with granulation tissue present. No signs of infection noted. Dressing applied as ordered.",
  "med compliant": "Patient reports compliance with all prescribed medications. No adverse effects reported. Medication reconciliation completed.",
  "pain management": "Patient reports pain level as [X]/10. Pain management strategies discussed and implemented. Patient demonstrates understanding.",
  "education provided": "Patient and family education provided regarding diagnosis, treatment plan, medications, and signs/symptoms to report. Patient verbalizes understanding.",
  "safety assessment": "Home safety assessment completed. Fall risk precautions reviewed with patient and caregiver. Environment deemed safe for patient care.",
  "vitals stable": "Vital signs obtained and documented. All measurements within acceptable range for this patient. No concerning trends noted.",
  "follow up ordered": "Follow-up visit scheduled as ordered. Patient instructed on when to contact physician. Emergency contact information provided.",
  "caregiver support": "Caregiver demonstrates competence with care tasks. Support resources reviewed. Caregiver burden assessment completed.",
  "discharge planning": "Discharge planning discussed with patient and family. Goals of care reviewed. Post-discharge plans confirmed."
};

export default function SmartPhraseVoiceInput({ onInsertText, disabled = false }) {
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [expandedPhrase, setExpandedPhrase] = useState(null);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recog = new SpeechRecognition();
      recog.continuous = true;
      recog.interimResults = true;

      recog.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        const currentTranscript = finalTranscript || interimTranscript;
        setTranscript(currentTranscript);

        // Check for smart phrase matches
        const lowerTranscript = currentTranscript.toLowerCase().trim();
        for (const [phrase, expansion] of Object.entries(SMART_PHRASES)) {
          if (lowerTranscript.includes(phrase)) {
            setExpandedPhrase({ phrase, expansion });
            setTranscript("");
            recog.stop();
            setIsListening(false);
            break;
          }
        }
      };

      recog.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recog.onend = () => {
        setIsListening(false);
      };

      setRecognition(recog);
    }

    return () => {
      if (recognition) {
        recognition.stop();
      }
    };
  }, []);

  const toggleListening = () => {
    if (!recognition) {
      toast.error("Speech recognition not supported in this browser");
      return;
    }

    if (isListening) {
      recognition.stop();
      setIsListening(false);
    } else {
      setTranscript("");
      setExpandedPhrase(null);
      recognition.start();
      setIsListening(true);
      toast.info("Listening for smart phrases...");
    }
  };

  const insertExpansion = () => {
    if (expandedPhrase) {
      onInsertText(expandedPhrase.expansion);
      setExpandedPhrase(null);
      toast.success("Smart phrase inserted");
    }
  };

  const insertRawTranscript = () => {
    if (transcript) {
      onInsertText(transcript);
      setTranscript("");
      toast.success("Text inserted");
    }
  };

  return (
    <Card className="border-purple-300 bg-purple-50 dark:bg-purple-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="w-5 h-5 text-purple-600" />
          Smart Phrase Voice Input
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Button
            onClick={toggleListening}
            disabled={disabled || !recognition}
            className={isListening ? "bg-red-600 hover:bg-red-700" : "bg-purple-600 hover:bg-purple-700"}
          >
            {isListening ? (
              <>
                <MicOff className="w-4 h-4 mr-2" />
                Stop Listening
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-2" />
                Start Voice Input
              </>
            )}
          </Button>
          {isListening && (
            <Badge className="bg-red-500 animate-pulse">
              Listening...
            </Badge>
          )}
        </div>

        {/* Live Transcript */}
        {transcript && (
          <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-purple-200">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Current transcript:</p>
            <p className="text-sm text-slate-900 dark:text-slate-100">{transcript}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={insertRawTranscript}
              className="mt-2"
            >
              Insert as is
            </Button>
          </div>
        )}

        {/* Expanded Phrase */}
        {expandedPhrase && (
          <div className="bg-green-50 dark:bg-green-900/30 p-3 rounded-lg border-2 border-green-400">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-green-600" />
              <p className="text-xs font-semibold text-green-800 dark:text-green-200">
                Smart Phrase Detected: "{expandedPhrase.phrase}"
              </p>
            </div>
            <p className="text-sm text-slate-900 dark:text-slate-100 mb-3">
              {expandedPhrase.expansion}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={insertExpansion}
                className="bg-green-600 hover:bg-green-700"
              >
                <Copy className="w-3 h-3 mr-1" />
                Insert Expanded Text
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setExpandedPhrase(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Available Smart Phrases */}
        <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-purple-200">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
            Available Smart Phrases:
          </p>
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(SMART_PHRASES).map((phrase, idx) => (
              <Badge
                key={idx}
                variant="outline"
                className="text-xs justify-center cursor-help"
                title={SMART_PHRASES[phrase]}
              >
                {phrase}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}