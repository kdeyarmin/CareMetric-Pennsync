import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function VoiceToSOAPConverter({
  visitType,
  diagnosis,
  nurseType = "RN",
  patientContext = null,
  onSOAPGenerated
}) {
  const [isRecording, isRecordingState] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [soapNote, setSOAPNote] = useState(null);
  const mediaRecorderRef = React.useRef(null);
  const streamRef = React.useRef(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/wav" });
        setAudioBlob(blob);
      };

      mediaRecorder.start();
      isRecordingState(true);
      toast.info("Recording voice note...");
    } catch (error) {
      toast.error("Microphone access denied");
      console.error(error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
      isRecordingState(false);
    }
  };

  const generateSOAPNote = async () => {
    if (!audioBlob) {
      toast.error("Please record a voice note first");
      return;
    }

    setIsGenerating(true);
    try {
      // Upload audio file
      const uploadRes = await base44.integrations.Core.UploadFile({ file: audioBlob });
      const audioUrl = uploadRes.file_url;

      // Generate SOAP note from voice
      const result = await base44.functions.invoke('transcribeAndGenerateSOAPNote', {
        audio_file_url: audioUrl,
        visit_type: visitType,
        diagnosis,
        nurse_type: nurseType,
        context_data: patientContext || {}
      });

      if (result?.data?.success) {
        setSOAPNote(result.data.soap_note);
        onSOAPGenerated?.(result.data.soap_note);
        toast.success("SOAP note generated successfully");
      } else {
        toast.error(result?.data?.error || "Failed to generate note");
      }
    } catch (error) {
      toast.error(`Error: ${error.message}`);
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card className="border-blue-200/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <Mic className="w-4 h-4 text-blue-600" />
          Voice-to-SOAP Converter
        </CardTitle>
        <p className="text-xs text-slate-600 mt-2">
          Record your clinical observations and AI will generate a structured SOAP note
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          {!isRecording ? (
            <Button
              onClick={startRecording}
              variant="outline"
              className="flex-1"
              size="sm"
            >
              <Mic className="w-4 h-4 mr-2" />
              Start Recording
            </Button>
          ) : (
            <Button
              onClick={stopRecording}
              className="flex-1 bg-red-600 hover:bg-red-700"
              size="sm"
            >
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Stop Recording
            </Button>
          )}
        </div>

        {audioBlob && (
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="text-xs font-semibold text-slate-700">Voice note recorded</span>
            </div>
            <Button
              onClick={generateSOAPNote}
              disabled={isGenerating}
              className="w-full"
              size="sm"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating SOAP Note...
                </>
              ) : (
                "Generate SOAP Note"
              )}
            </Button>
          </div>
        )}

        {soapNote && (
          <div className="bg-green-50 p-3 rounded-lg border border-green-200">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="text-xs font-semibold text-slate-700">SOAP note generated</span>
            </div>
            <div className="bg-white p-2 rounded text-xs text-slate-600 max-h-32 overflow-y-auto border border-slate-200">
              {soapNote.substring(0, 300)}...
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {nurseType && <Badge variant="secondary" className="text-xs">{nurseType}</Badge>}
          {visitType && <Badge variant="secondary" className="text-xs">{visitType}</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}