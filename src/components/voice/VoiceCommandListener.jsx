import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Mic, MicOff, HelpCircle, CheckCircle2, Volume2 } from "lucide-react";

export default function VoiceCommandListener({ onCommand, commands = [], context = "global" }) {
  const [isListening, setIsListening] = useState(false);
  const [recognizedCommand, setRecognizedCommand] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  // "User wants to listen" intent (distinct from the recognizer's transient
  // active state). onend restarts only while this is true.
  const isListeningRef = useRef(false);
  // Latest commands/handler via refs so the recognizer (created ONCE below) can
  // match against current props without being torn down and rebuilt on every
  // `commands` identity change (which churned the recognizer and spawned
  // overlapping recognizers).
  const commandsRef = useRef(commands);
  const onCommandRef = useRef(onCommand);
  useEffect(() => { commandsRef.current = commands; }, [commands]);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);

  useEffect(() => {
    // Check if browser supports speech recognition
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setError("Voice commands not supported in this browser. Please use Chrome, Edge, or Safari.");
      return;
    }

    // Initialize speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Restart only while the user still intends to listen (continuous mode).
      if (isListeningRef.current) {
        try {
          recognition.start();
        } catch {
          // Already started
        }
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        // Ignore no-speech errors
        return;
      }
      setError(`Voice recognition error: ${event.error}`);
    };

    recognition.onresult = (event) => {
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

      const fullTranscript = finalTranscript || interimTranscript;
      setTranscript(fullTranscript);

      // Check if transcript matches any commands
      if (finalTranscript) {
        processCommand(finalTranscript.toLowerCase().trim());
      }
    };

    recognitionRef.current = recognition;

    return () => {
      // Stop intending to listen so the final onend doesn't auto-restart.
      isListeningRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
    // Create the recognizer once; commands/handler are read via refs.
  }, []);

  const processCommand = (spokenText) => {
    // Find matching command (read the latest commands via ref).
    for (const cmd of commandsRef.current) {
      // Check if any trigger phrase matches
      const matched = cmd.triggers.some(trigger =>
        spokenText.includes(trigger.toLowerCase())
      );

      if (matched) {
        setRecognizedCommand(cmd);

        // Execute command (latest handler via ref)
        if (onCommandRef.current) {
          onCommandRef.current(cmd.action, spokenText);
        }

        // Show feedback
        setTimeout(() => {
          setRecognizedCommand(null);
          setTranscript("");
        }, 3000);

        return;
      }
    }
  };

  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      // Clear intent FIRST so onend doesn't auto-restart. Keep the recognizer
      // instance (don't null it) so the user can start again.
      isListeningRef.current = false;
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        isListeningRef.current = true;
        recognitionRef.current.start();
      } catch (error) {
        isListeningRef.current = false;
        console.error('Error starting recognition:', error);
      }
    }
  };

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {/* Voice feedback */}
        {isListening && (
          <div className="bg-white rounded-lg shadow-xl p-4 max-w-sm border-2 border-blue-400 animate-in fade-in slide-in-from-bottom-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="relative">
                <Mic className="w-5 h-5 text-blue-600" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              </div>
              <span className="text-sm font-semibold text-slate-900">Listening...</span>
            </div>
            
            {transcript && (
              <p className="text-sm text-slate-600 italic">"{transcript}"</p>
            )}
            
            {recognizedCommand && (
              <div className="mt-2 flex items-center gap-2 text-green-600">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm font-medium">✓ {recognizedCommand.name}</span>
              </div>
            )}
          </div>
        )}

        {/* Error message */}
        {error && (
          <Alert className="max-w-sm bg-red-50 border-red-300">
            <AlertDescription className="text-red-900 text-sm">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {/* Control buttons */}
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => setShowHelp(true)}
            className="rounded-full shadow-lg"
            title="View voice commands"
          >
            <HelpCircle className="w-5 h-5" />
          </Button>

          <Button
            size="lg"
            onClick={toggleListening}
            className={`rounded-full shadow-lg ${
              isListening 
                ? 'bg-red-600 hover:bg-red-700' 
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
            title={isListening ? 'Stop listening' : 'Start voice commands'}
          >
            {isListening ? (
              <>
                <MicOff className="w-6 h-6 mr-2" />
                Stop
              </>
            ) : (
              <>
                <Mic className="w-6 h-6 mr-2" />
                Voice Commands
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Help Dialog */}
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Volume2 className="w-6 h-6 text-blue-600" />
              Available Voice Commands
            </DialogTitle>
            <DialogDescription>
              Say any of these commands while voice mode is active. Commands work in {context} context.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {commands.length === 0 ? (
              <p className="text-slate-500 text-center py-8">
                No voice commands available in this context.
              </p>
            ) : (
              commands.map((cmd, index) => (
                <div 
                  key={index} 
                  className="p-4 bg-slate-50 rounded-lg border border-slate-200"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-slate-900">{cmd.name}</h4>
                    <Badge variant="outline" className="text-xs">
                      {cmd.category}
                    </Badge>
                  </div>
                  
                  <p className="text-sm text-slate-600 mb-3">{cmd.description}</p>
                  
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-700">Say any of these:</p>
                    <div className="flex flex-wrap gap-2">
                      {cmd.triggers.map((trigger, idx) => (
                        <Badge key={idx} variant="secondary" className="font-mono text-xs">
                          "{trigger}"
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {cmd.example && (
                    <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded">
                      <p className="text-xs text-blue-900">
                        <strong>Example:</strong> {cmd.example}
                      </p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="border-t pt-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-blue-900 text-sm">
                <strong>💡 Tips:</strong>
                <ul className="list-disc ml-5 mt-2 space-y-1">
                  <li>Speak clearly and at normal pace</li>
                  <li>Wait for visual confirmation before next command</li>
                  <li>Commands work best in quiet environments</li>
                  <li>Use Chrome, Edge, or Safari for best results</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}