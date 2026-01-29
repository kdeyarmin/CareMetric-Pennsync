import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function VoiceNoteRecorder({ onTranscriptionComplete, appendMode = true }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const wsRef = useRef(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Initialize Deepgram WebSocket for real-time transcription
      const deepgramApiKey = import.meta.env.VITE_DEEPGRAM_API_KEY;
      if (deepgramApiKey) {
        const ws = new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', [
          'token',
          deepgramApiKey
        ]);

        ws.onopen = () => {
          console.log('Deepgram WebSocket connected');
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          const transcriptText = data.channel?.alternatives?.[0]?.transcript;
          
          if (transcriptText && data.is_final) {
            setTranscript(prev => prev + transcriptText + ' ');
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
        };

        wsRef.current = ws;
      }

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          
          // Send audio to Deepgram WebSocket for real-time transcription
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(event.data);
          }
        }
      };

      mediaRecorder.onstop = async () => {
        // Close WebSocket
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());

        // If we have transcript, use it
        if (transcript.trim()) {
          onTranscriptionComplete(transcript.trim());
          toast.success('Transcription completed');
          setTranscript("");
        } else {
          toast.warning('No speech was detected');
        }
      };

      mediaRecorder.start(250); // Send data every 250ms for real-time
      setIsRecording(true);
      toast.success('Recording started. Speak clearly into your microphone.');
    } catch (err) {
      console.error('Error starting recording:', err);
      toast.error('Failed to start recording. Please allow microphone access.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
          variant={isRecording ? "destructive" : "outline"}
          size="sm"
          className={isRecording ? "animate-pulse" : ""}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : isRecording ? (
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