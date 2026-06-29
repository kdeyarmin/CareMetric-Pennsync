import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mic, MicOff, Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { invokeLLM, invokeLLMWithFile } from "@/lib/invokeLLM";
import { toast } from "sonner";

export default function VoiceClinicalNoteRecorder({ onTranscriptionComplete, initialText = "" }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcription, setTranscription] = useState(initialText);
  const [enhancedNote, setEnhancedNote] = useState("");
  const [error, setError] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        await processAudio();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      setError("Unable to access microphone. Please check permissions.");
      console.error("Microphone error:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  const processAudio = async () => {
    if (audioChunksRef.current.length === 0) return;

    setIsProcessing(true);
    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      // Wrap the Blob in a File so the SDK uploads it as multipart/form-data.
      // A bare Blob is not `instanceof File`, so the SDK JSON-serializes it into
      // an empty object and the API rejects it ("'file' field is an empty object").
      const audioFile = new File([audioBlob], `clinical-note-${Date.now()}.webm`, {
        type: "audio/webm",
      });

      // Upload audio file
      const uploadRes = await base44.integrations.Core.UploadFile({ file: audioFile });
      const audioUrl = uploadRes.file_url;

      // Transcribe with Gemini
      const transcribeRes = await invokeLLMWithFile({
        prompt: `Transcribe the following medical/clinical audio recording. Preserve all clinical details and terminology. Return only the transcribed text.`,
        file_urls: [audioUrl],
        model: "gemini_3_flash"
      });

      const rawTranscription = transcribeRes;
      setTranscription(rawTranscription);

      // Enhance with medical terminology
      const enhanceRes = await invokeLLM({
        prompt: `You are a clinical documentation specialist. Take the following clinical observation transcription and enhance it into proper medical narrative format with appropriate clinical terminology, while preserving all clinical details. Structure it as a cohesive paragraph suitable for medical records. Ensure all clinical observations are properly documented with appropriate medical terminology.

Transcription: "${rawTranscription}"

Return only the enhanced clinical narrative, no explanations.`,
        model: "claude_opus_4_8"
      });

      setEnhancedNote(enhanceRes);
      toast.success("Clinical note transcribed and enhanced");

      if (onTranscriptionComplete) {
        onTranscriptionComplete(enhanceRes);
      }
    } catch (err) {
      setError(`Processing error: ${err.message}`);
      console.error("Audio processing error:", err);
      toast.error("Failed to process audio recording");
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch (err) {
      console.error("Clipboard write failed:", err);
      toast.error("Failed to copy to clipboard");
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="w-5 h-5 text-blue-600" />
          Voice-to-Text Clinical Note
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert className="bg-red-50 border-red-300">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {/* Recording Controls */}
        <div className="flex items-center gap-3">
          <Button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            className={isRecording ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}
            size="lg"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Processing...
              </>
            ) : isRecording ? (
              <>
                <MicOff className="w-5 h-5 mr-2" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="w-5 h-5 mr-2" />
                Start Recording
              </>
            )}
          </Button>
          {isRecording && (
            <span className="text-lg font-mono text-slate-700">{formatTime(recordingTime)}</span>
          )}
        </div>

        {/* Raw Transcription */}
        {transcription && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">Raw Transcription</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(transcription)}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <div className="bg-white p-3 rounded-lg border border-slate-200 text-sm text-slate-900 max-h-32 overflow-y-auto">
              {transcription}
            </div>
          </div>
        )}

        {/* Enhanced Clinical Note */}
        {enhancedNote && (
          <div className="space-y-2 bg-white p-4 rounded-lg border-2 border-green-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="font-semibold text-slate-700">Enhanced Clinical Narrative</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(enhancedNote)}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">
              {enhancedNote}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}