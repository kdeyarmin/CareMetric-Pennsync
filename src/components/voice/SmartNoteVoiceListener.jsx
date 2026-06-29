import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Mic,
  MicOff,
  CheckCircle2
} from "lucide-react";
import { toast } from 'sonner';

// Voice command patterns for Smart Note Assistant
const _VOICE_COMMANDS = {
  vitals: {
    patterns: [
      /(?:blood pressure|bp)\s*(?:is\s*)?(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/i,
      /(?:heart rate|pulse|hr)\s*(?:is\s*)?(\d{2,3})/i,
      /(?:temp(?:erature)?)\s*(?:is\s*)?(\d{2,3}(?:\.\d)?)/i,
      /(?:o2|oxygen|sat(?:uration)?)\s*(?:is\s*)?(\d{2,3})/i,
      /(?:pain)\s*(?:level\s*)?(?:is\s*)?(\d{1,2})\s*(?:out of|\/)\s*10/i,
      /(?:resp(?:iratory)?(?:\s*rate)?|rr)\s*(?:is\s*)?(\d{1,2})/i,
      /(?:weight)\s*(?:is\s*)?(\d{2,3})/i
    ],
    handler: 'vital'
  },
  actions: {
    patterns: [
      /start\s*(?:dictation|recording)/i,
      /stop\s*(?:dictation|recording)/i,
      /enhance\s*(?:the\s*)?note/i,
      /save\s*(?:the\s*)?note/i,
      /copy\s*(?:the\s*)?note/i,
      /clear\s*(?:the\s*)?note/i,
      /generate\s*(?:care\s*)?plan/i,
      /report\s*(?:an\s*)?incident/i
    ],
    handler: 'action'
  }
};

export default function SmartNoteVoiceListener({ 
  onVitalChange, 
  onPhraseInsert, 
  onAction,
  isEnabled = true 
}) {
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const recognitionRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  // Mirror isListening into a ref so the recognition.onend handler (created once,
  // deps []) reads the LIVE value instead of the stale mount-time `false`, which
  // previously broke continuous-listening auto-restart.
  const isListeningRef = useRef(false);

  // Stop and release the mic stream, AudioContext, and animation frame.
  const stopAudioCapture = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  };

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const processCommand = useCallback((transcript) => {
    // Check for vital signs
    const bpMatch = transcript.match(/(?:blood pressure|bp)\s*(?:is\s*)?(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/i);
    if (bpMatch) {
      const bp = `${bpMatch[1]}/${bpMatch[2]}`;
      setLastCommand({ type: 'vital', value: `BP: ${bp}` });
      onVitalChange && onVitalChange('bp', bp);
      return;
    }

    const hrMatch = transcript.match(/(?:heart rate|pulse|hr)\s*(?:is\s*)?(\d{2,3})/i);
    if (hrMatch) {
      setLastCommand({ type: 'vital', value: `HR: ${hrMatch[1]}` });
      onVitalChange && onVitalChange('hr', hrMatch[1]);
      return;
    }

    const tempMatch = transcript.match(/(?:temp(?:erature)?)\s*(?:is\s*)?(\d{2,3}(?:\.\d)?)/i);
    if (tempMatch) {
      setLastCommand({ type: 'vital', value: `Temp: ${tempMatch[1]}` });
      onVitalChange && onVitalChange('temp', tempMatch[1]);
      return;
    }

    const o2Match = transcript.match(/(?:o2|oxygen|sat(?:uration)?)\s*(?:is\s*)?(\d{2,3})/i);
    if (o2Match) {
      setLastCommand({ type: 'vital', value: `O2: ${o2Match[1]}%` });
      onVitalChange && onVitalChange('o2', o2Match[1]);
      return;
    }

    const painMatch = transcript.match(/(?:pain)\s*(?:level\s*)?(?:is\s*)?(\d{1,2})/i);
    if (painMatch) {
      setLastCommand({ type: 'vital', value: `Pain: ${painMatch[1]}/10` });
      onVitalChange && onVitalChange('pain', painMatch[1]);
      return;
    }

    const rrMatch = transcript.match(/(?:resp(?:iratory)?(?:\s*rate)?|rr)\s*(?:is\s*)?(\d{1,2})/i);
    if (rrMatch) {
      setLastCommand({ type: 'vital', value: `RR: ${rrMatch[1]}` });
      onVitalChange && onVitalChange('rr', rrMatch[1]);
      return;
    }

    const weightMatch = transcript.match(/(?:weight)\s*(?:is\s*)?(\d{2,3})/i);
    if (weightMatch) {
      setLastCommand({ type: 'vital', value: `Weight: ${weightMatch[1]}` });
      onVitalChange && onVitalChange('weight', weightMatch[1]);
      return;
    }

    // Check for actions
    if (/start\s*(?:dictation|recording)/i.test(transcript)) {
      setLastCommand({ type: 'action', value: 'Start Dictation' });
      onAction && onAction('start_dictation');
      return;
    }
    if (/stop\s*(?:dictation|recording)/i.test(transcript)) {
      setLastCommand({ type: 'action', value: 'Stop Dictation' });
      onAction && onAction('stop_dictation');
      return;
    }
    if (/enhance\s*(?:the\s*)?note/i.test(transcript)) {
      setLastCommand({ type: 'action', value: 'Enhance Note' });
      onAction && onAction('enhance_note');
      return;
    }
    if (/save\s*(?:the\s*)?note/i.test(transcript)) {
      setLastCommand({ type: 'action', value: 'Save Note' });
      onAction && onAction('save_note');
      return;
    }
    if (/copy\s*(?:the\s*)?note/i.test(transcript)) {
      setLastCommand({ type: 'action', value: 'Copy Note' });
      onAction && onAction('copy_note');
      return;
    }
    if (/clear\s*(?:the\s*)?note/i.test(transcript)) {
      setLastCommand({ type: 'action', value: 'Clear Note' });
      onAction && onAction('clear_note');
      return;
    }
    if (/generate\s*(?:care\s*)?plan/i.test(transcript)) {
      setLastCommand({ type: 'action', value: 'Generate Care Plan' });
      onAction && onAction('generate_care_plan');
      return;
    }
    if (/report\s*(?:an\s*)?incident/i.test(transcript)) {
      setLastCommand({ type: 'action', value: 'Report Incident' });
      onAction && onAction('report_incident');
      return;
    }

    // Common clinical phrases - insert as text
    const phrases = {
      'lungs clear': 'Lungs clear to auscultation bilaterally. ',
      'no edema': 'No peripheral edema noted. ',
      'alert and oriented': 'Patient alert and oriented x4. ',
      'wound healing': 'Wound healing well with no signs of infection. ',
      'med compliant': 'Patient reports medication compliance. ',
      'denies pain': 'Patient denies pain at this time. ',
      'tolerating diet': 'Patient tolerating diet well. ',
      'homebound': 'Patient remains homebound due to medical condition. ',
      'skilled need': 'Skilled nursing required for assessment and teaching. '
    };

    for (const [trigger, phrase] of Object.entries(phrases)) {
      if (transcript.includes(trigger)) {
        setLastCommand({ type: 'phrase', value: trigger });
        onPhraseInsert && onPhraseInsert(phrase);
        return;
      }
    }
  }, [onVitalChange, onAction, onPhraseInsert]);

  useEffect(() => {
    // Check for Web Speech API support
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const lastResult = event.results[event.results.length - 1];
      if (lastResult.isFinal) {
        const transcript = lastResult[0].transcript.toLowerCase().trim();
        processCommand(transcript);
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech') {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Restart if still meant to be listening (read the ref, not stale state).
      if (isListeningRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch {
          // Recognition may already be running; ignore the redundant start.
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      // Release the mic stream + AudioContext too (previously leaked on unmount).
      stopAudioCapture();
    };
  }, [processCommand]);

  const toggleListening = async () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      // Release the mic + AudioContext (previously left live after "stop").
      stopAudioCapture();
    } else {
      try {
        // Get audio for visual feedback
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (analyserRef.current) {
            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            setAudioLevel(average / 255);
          }
          animationRef.current = requestAnimationFrame(updateLevel);
        };
        updateLevel();

        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        console.error('Error starting voice listener:', e);
        toast.error('Could not access microphone. Please grant permission.');
      }
    }
  };

  if (!isEnabled) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Card className={`shadow-lg transition-all ${isListening ? 'border-green-400 bg-green-50' : 'border-slate-200'}`}>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={toggleListening}
              className={`rounded-full w-10 h-10 ${isListening ? 'bg-green-600 hover:bg-green-700' : 'bg-slate-600 hover:bg-slate-700'}`}
            >
              {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </Button>
            
            <div className="min-w-[140px]">
              {isListening ? (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className="bg-green-600 text-xs animate-pulse">Listening</Badge>
                    <div className="flex gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <div
                          key={i}
                          className="w-1 bg-green-500 rounded-full transition-all"
                          style={{ height: `${Math.max(4, audioLevel * 20 * (i + 1))}px` }}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">Say vitals or commands</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-medium text-slate-700">Voice Commands</p>
                  <p className="text-xs text-slate-500">Click to activate</p>
                </>
              )}
            </div>

            {lastCommand && (
              <Badge className="bg-blue-100 text-blue-800 text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {lastCommand.value}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}