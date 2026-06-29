import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, MicOff, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from 'sonner';

export default function AudioRecorder({ onAudioProcessed, isProcessing }) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  // Cleanup interval and media stream on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
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
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error("Error accessing microphone:", error);
      toast.error("Could not access microphone. Please check your browser permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const handleUpload = () => {
    if (audioBlob) {
      const file = new File([audioBlob], 'clinical-notes.webm', { type: 'audio/webm' });
      onAudioProcessed(file);
      setAudioBlob(null);
      setRecordingTime(0);
    }
  };

  const handleDiscard = () => {
    setAudioBlob(null);
    setRecordingTime(0);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Card className="bg-gradient-to-r from-navy-50 to-gold-50 border-navy-200">
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-navy-500 to-gold-500 rounded-full flex items-center justify-center flex-shrink-0">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-slate-900 mb-2">Voice Dictation - Penn Sync AI</h3>
            
            <Alert className="bg-white border-navy-200 mb-4">
              <AlertDescription className="text-sm text-slate-700">
                <strong>🎤 How Penn Sync Voice Works:</strong>
                <ul className="list-disc ml-5 mt-2 space-y-1">
                  <li>Click "Start Recording" and speak naturally about your patient visit</li>
                  <li>Describe observations, assessments, interventions, patient responses</li>
                  <li>Penn Sync AI will transcribe, format, and merge into your clinical narrative</li>
                  <li>Works seamlessly with existing templates and vital signs</li>
                </ul>
              </AlertDescription>
            </Alert>

            <div className="flex items-center gap-3">
              {!isRecording && !audioBlob && (
                <Button
                  onClick={startRecording}
                  className="bg-gradient-to-r from-navy-600 to-gold-600 hover:from-navy-700 hover:to-gold-700"
                >
                  <Mic className="w-4 h-4 mr-2" />
                  Start Recording
                </Button>
              )}

              {isRecording && (
                <>
                  <Button
                    onClick={stopRecording}
                    variant="destructive"
                    className="bg-red-600 hover:bg-red-700"
                  >
                    <MicOff className="w-4 h-4 mr-2" />
                    Stop Recording
                  </Button>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-sm font-medium text-slate-700">
                      {formatTime(recordingTime)}
                    </span>
                  </div>
                </>
              )}

              {audioBlob && !isProcessing && (
                <>
                  <Button
                    onClick={handleUpload}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Process with Penn Sync AI
                  </Button>
                  <Button
                    onClick={handleDiscard}
                    variant="outline"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Discard
                  </Button>
                  <span className="text-sm text-slate-600">
                    Recorded: {formatTime(recordingTime)}
                  </span>
                </>
              )}
            </div>

            {isProcessing && (
              <p className="text-sm text-navy-600 mt-3 font-medium">
                ⚡ Penn Sync AI is processing your dictation...
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}