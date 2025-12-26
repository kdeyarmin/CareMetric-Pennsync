import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, CheckCircle2 } from "lucide-react";

export default function AdvancedVoiceCommands({ 
  onVitalSigns, 
  onDiagnosis, 
  onTranscription,
  onCommand 
}) {
  const [listening, setListening] = useState(false);
  const [lastCommand, setLastCommand] = useState(null);
  const recognitionRef = React.useRef(null);

  const parseVitalSigns = (text) => {
    const lower = text.toLowerCase();
    const result = {};

    // Blood pressure
    const bpMatch = lower.match(/blood pressure (\d+) over (\d+)|bp (\d+) over (\d+)|(\d+) over (\d+)/);
    if (bpMatch) {
      result.bp = `${bpMatch[1] || bpMatch[3] || bpMatch[5]}/${bpMatch[2] || bpMatch[4] || bpMatch[6]}`;
    }

    // Heart rate
    const hrMatch = lower.match(/heart rate (\d+)|pulse (\d+)|hr (\d+)/);
    if (hrMatch) {
      result.hr = hrMatch[1] || hrMatch[2] || hrMatch[3];
    }

    // Temperature
    const tempMatch = lower.match(/temperature (\d+\.?\d*)|temp (\d+\.?\d*)/);
    if (tempMatch) {
      result.temp = tempMatch[1] || tempMatch[2];
    }

    // Oxygen saturation
    const o2Match = lower.match(/oxygen (\d+)|o2 (\d+)|spo2 (\d+)|sat (\d+)/);
    if (o2Match) {
      result.o2 = o2Match[1] || o2Match[2] || o2Match[3] || o2Match[4];
    }

    // Pain level
    const painMatch = lower.match(/pain (\d+)|pain level (\d+)/);
    if (painMatch) {
      result.pain = painMatch[1] || painMatch[2];
    }

    return Object.keys(result).length > 0 ? result : null;
  };

  const startListening = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition not supported');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const transcript = event.results[i][0].transcript.trim();
          
          // Check for vital signs patterns
          const vitals = parseVitalSigns(transcript);
          if (vitals) {
            onVitalSigns?.(vitals);
            setLastCommand('Vitals Captured');
            setTimeout(() => setLastCommand(null), 2000);
            continue;
          }

          // Check for specific commands
          const lower = transcript.toLowerCase();
          if (lower.includes('enhance note') || lower.includes('enhance my note')) {
            onCommand?.('enhance');
            setLastCommand('Enhancing Note');
            setTimeout(() => setLastCommand(null), 2000);
          } else if (lower.includes('save note') || lower.includes('save my note')) {
            onCommand?.('save');
            setLastCommand('Saving Note');
            setTimeout(() => setLastCommand(null), 2000);
          } else if (lower.includes('copy note')) {
            onCommand?.('copy');
            setLastCommand('Copied');
            setTimeout(() => setLastCommand(null), 2000);
          } else {
            // Regular transcription
            onTranscription?.(transcript);
          }
        }
      }
    };

    recognition.onend = () => {
      if (listening) {
        try {
          recognition.start();
        } catch (e) {
          console.error('Restart error:', e);
        }
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
    };

    setListening(true);
    recognition.start();
  };

  const stopListening = () => {
    setListening(false);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  React.useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={listening ? "destructive" : "outline"}
        onClick={listening ? stopListening : startListening}
        className="gap-2"
      >
        {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        {listening ? 'Stop' : 'Voice'}
      </Button>
      {listening && (
        <Badge className="bg-red-600 text-white animate-pulse">
          Listening...
        </Badge>
      )}
      {lastCommand && (
        <Badge className="bg-green-600 text-white">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          {lastCommand}
        </Badge>
      )}
    </div>
  );
}