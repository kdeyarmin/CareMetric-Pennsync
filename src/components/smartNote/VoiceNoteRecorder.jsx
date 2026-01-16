import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function VoiceNoteRecorder({ onTranscriptionComplete, appendMode = true }) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef(null);

  useEffect(() => {
    // Check if browser supports speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.warn("Speech recognition not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcriptPiece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcriptPiece + ' ';
        } else {
          interimTranscript += transcriptPiece;
        }
      }

      setTranscript(prev => prev + finalTranscript);
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        toast.error('No speech detected. Please try again.');
      } else if (event.error === 'not-allowed') {
        toast.error('Microphone access denied. Please enable microphone permissions.');
      } else {
        toast.error('Error recognizing speech: ' + event.error);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      if (isRecording) {
        // Auto-restart if still recording
        try {
          recognition.start();
        } catch (err) {
          console.error('Error restarting recognition:', err);
          setIsRecording(false);
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [isRecording]);

  const startRecording = () => {
    if (!recognitionRef.current) {
      toast.error('Speech recognition not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    try {
      setTranscript("");
      recognitionRef.current.start();
      setIsRecording(true);
      toast.success('Recording started. Speak clearly into your microphone.');
    } catch (err) {
      console.error('Error starting recognition:', err);
      toast.error('Failed to start recording. Please try again.');
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
      
      if (transcript.trim()) {
        onTranscriptionComplete(transcript.trim());
        toast.success('Transcription completed');
      } else {
        toast.warning('No speech was detected');
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          variant={isRecording ? "destructive" : "outline"}
          size="sm"
          className={isRecording ? "animate-pulse" : ""}
        >
          {isRecording ? (
            <>
              <MicOff className="w-4 h-4 mr-2" />
              Stop Recording
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 mr-2" />
              Start Voice Dictation
            </>
          )}
        </Button>
        
        {isRecording && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
            Recording...
          </div>
        )}
      </div>

      {isRecording && transcript && (
        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Live transcription:</p>
          <p className="text-sm text-slate-700 dark:text-slate-300">{transcript}</p>
        </div>
      )}
    </div>
  );
}