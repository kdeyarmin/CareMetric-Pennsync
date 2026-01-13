import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function MobileNoteInterface({ 
  patientId,
  visitType,
  diagnosis,
  onNoteGenerated 
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [roughNote, setRoughNote] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);
  const timerRef = React.useRef(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      // Vibrate on start (mobile feedback)
      if (navigator.vibrate) navigator.vibrate(50);
      toast.success('Recording started');
    } catch (error) {
      toast.error('Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      clearInterval(timerRef.current);

      // Vibrate on stop
      if (navigator.vibrate) navigator.vibrate([50, 50, 50]);

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        await transcribeAndEnhance(audioBlob);
      };
    }
  };

  const transcribeAndEnhance = async (audioBlob) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.wav');
      
      const response = await base44.functions.invoke('transcribeAndGenerateScribeNote', {
        audio: audioBlob,
        patientId,
        visitType,
        diagnosis
      });

      const data = response.data || response;
      if (data.success && data.enhanced_note) {
        onNoteGenerated?.(data.enhanced_note);
        toast.success('Note generated!');
        if (navigator.vibrate) navigator.vibrate(200);
      }
    } catch (error) {
      toast.error('Failed to process audio');
    }
    setIsProcessing(false);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-3 w-full">
      {/* Large Recording Button - Touch Optimized */}
      <div className="flex flex-col gap-2">
        <Button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
          className={`h-32 rounded-2xl text-lg font-bold ${
            isRecording 
              ? 'bg-red-600 hover:bg-red-700 active:bg-red-800' 
              : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
          }`}
        >
          <div className="flex flex-col items-center gap-2">
            {isRecording ? (
              <>
                <div className="relative">
                  <MicOff className="w-12 h-12" />
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full animate-pulse" />
                </div>
                <span>Stop Recording</span>
                <span className="text-sm font-mono">{formatTime(recordingTime)}</span>
              </>
            ) : (
              <>
                <Mic className="w-12 h-12" />
                <span>Tap to Record Visit</span>
              </>
            )}
          </div>
        </Button>

        {isProcessing && (
          <div className="bg-purple-50 border-2 border-purple-300 rounded-xl p-4 text-center">
            <Loader2 className="w-8 h-8 mx-auto mb-2 text-purple-600 animate-spin" />
            <p className="text-sm font-medium text-purple-900">Processing audio...</p>
            <p className="text-xs text-purple-700">Transcribing & generating note</p>
          </div>
        )}
      </div>

      {/* Quick Text Input - For manual notes */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">Or Type Quick Notes:</label>
        <Textarea
          value={roughNote}
          onChange={(e) => setRoughNote(e.target.value)}
          placeholder="Tap to type quick notes..."
          className="min-h-[120px] text-base"
          disabled={isRecording || isProcessing}
        />
        {roughNote.length > 20 && (
          <Button
            onClick={async () => {
              setIsProcessing(true);
              try {
                const response = await base44.functions.invoke('enhanceNoteOptimized', {
                  roughNote,
                  patientId,
                  visitType,
                  diagnosis,
                  vitalSigns: {},
                  nurseType: 'RN'
                });
                const data = response.data || response;
                if (data.success) {
                  onNoteGenerated?.(data.enhanced_note);
                  toast.success('Note enhanced!');
                }
              } catch (error) {
                toast.error('Enhancement failed');
              }
              setIsProcessing(false);
            }}
            disabled={isProcessing}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Enhance Note
          </Button>
        )}
      </div>
    </div>
  );
}