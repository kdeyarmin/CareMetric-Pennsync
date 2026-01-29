import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2, Volume2 } from "lucide-react";
import { toast } from "sonner";

export default function VoiceDictationInput({ value, onChange, placeholder }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      toast.success("Recording started - speak now");
    } catch (error) {
      console.error('Error starting recording:', error);
      toast.error("Could not access microphone");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      setIsRecording(false);
      setIsProcessing(true);
      mediaRecorderRef.current.stop();
    }
  };

  const transcribeAudio = async (audioBlob) => {
    try {
      const { transcribeWithDeepgram } = await import('@/functions/transcribeWithDeepgram');
      
      // Create form data
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');

      // Call Deepgram via backend function
      const response = await transcribeWithDeepgram(formData);

      if (!response.data?.text) {
        throw new Error('No transcription received');
      }

      const transcribedText = response.data.text;

      // Append to existing text
      const newText = value ? `${value}\n\n${transcribedText}` : transcribedText;
      onChange({ target: { value: newText } });

      setIsProcessing(false);
      toast.success("Transcription complete!");
    } catch (error) {
      console.error('Transcription error:', error);
      setIsProcessing(false);
      toast.error("Failed to transcribe audio. Please try again.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
          variant={isRecording ? "destructive" : "outline"}
          size="sm"
          className="flex items-center gap-2"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : isRecording ? (
            <>
              <MicOff className="w-4 h-4 animate-pulse" />
              Stop Recording
            </>
          ) : (
            <>
              <Mic className="w-4 h-4" />
              Start Dictation
            </>
          )}
        </Button>

        {isRecording && (
          <div className="flex items-center gap-2 text-red-600 animate-pulse">
            <Volume2 className="w-4 h-4" />
            <span className="text-sm font-medium">Recording...</span>
          </div>
        )}
      </div>

      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full h-40 sm:h-48 p-3 border rounded-lg text-sm resize-none"
      />
    </div>
  );
}