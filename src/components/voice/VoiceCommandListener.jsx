import React, { useState, useEffect, useRef } from "react";
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
  const mediaRecorderRef = useRef(null);
  const wsRef = useRef(null);
  const audioChunksRef = useRef([]);

  const processCommand = (spokenText) => {
    // Find matching command
    for (const cmd of commands) {
      // Check if any trigger phrase matches
      const matched = cmd.triggers.some(trigger => 
        spokenText.includes(trigger.toLowerCase())
      );

      if (matched) {
        setRecognizedCommand(cmd);
        
        // Execute command
        if (onCommand) {
          onCommand(cmd.action, spokenText);
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

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Initialize Deepgram WebSocket for real-time transcription
      const deepgramApiKey = import.meta.env.VITE_DEEPGRAM_API_KEY;
      if (!deepgramApiKey) {
        setError('Deepgram API key not configured');
        return;
      }

      const ws = new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', [
        'token',
        deepgramApiKey
      ]);

      ws.onopen = () => {
        console.log('Deepgram WebSocket connected for voice commands');
        setIsListening(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const transcriptText = data.channel?.alternatives?.[0]?.transcript;
        
        if (transcriptText) {
          setTranscript(transcriptText);
          
          if (data.is_final) {
            processCommand(transcriptText.toLowerCase().trim());
          }
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('Voice recognition error. Please try again.');
      };

      ws.onclose = () => {
        console.log('Deepgram WebSocket closed');
        setIsListening(false);
      };

      wsRef.current = ws;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data);
        }
      };

      mediaRecorder.start(250); // Send data every 250ms
    } catch (err) {
      console.error('Error starting voice commands:', err);
      setError('Could not access microphone. Please check permissions.');
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsListening(false);
    setTranscript("");
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

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
              <span className="text-sm font-semibold text-gray-900">Listening...</span>
            </div>
            
            {transcript && (
              <p className="text-sm text-gray-600 italic">"{transcript}"</p>
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
              <p className="text-gray-500 text-center py-8">
                No voice commands available in this context.
              </p>
            ) : (
              commands.map((cmd, index) => (
                <div 
                  key={index} 
                  className="p-4 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-gray-900">{cmd.name}</h4>
                    <Badge variant="outline" className="text-xs">
                      {cmd.category}
                    </Badge>
                  </div>
                  
                  <p className="text-sm text-gray-600 mb-3">{cmd.description}</p>
                  
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-gray-700">Say any of these:</p>
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
                  <li>Powered by Deepgram for accurate voice recognition</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}