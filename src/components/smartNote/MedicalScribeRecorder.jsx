import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mic, Square, Upload, Loader, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function MedicalScribeRecorder({ 
  diagnosis = "",
  visitType = "",
  patientId = "",
  onNoteGenerated = null
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

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

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        await processAudio(audioBlob);
      };
    }
  };

  const processAudio = async (audioBlob) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.wav');
      formData.append('diagnosis', diagnosis);
      formData.append('visitType', visitType);
      formData.append('patientId', patientId);

      const response = await base44.functions.invoke('transcribeAndGenerateScribeNote', {}, {
        body: formData
      });

      const data = response.data || response;

      if (!data.success) {
        throw new Error(data.error || 'Processing failed');
      }

      setResult(data);
      onNoteGenerated?.(data.generated_note);
      toast.success('Note generated successfully');
    } catch (error) {
      toast.error(error.message || 'Failed to process audio');
    }
    setIsProcessing(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('diagnosis', diagnosis);
      formData.append('visitType', visitType);
      formData.append('patientId', patientId);

      const response = await base44.functions.invoke('transcribeAndGenerateScribeNote', {}, {
        body: formData
      });

      const data = response.data || response;

      if (!data.success) {
        throw new Error(data.error || 'Processing failed');
      }

      setResult(data);
      onNoteGenerated?.(data.generated_note);
      toast.success('Audio processed successfully');
    } catch (error) {
      toast.error(error.message || 'Failed to process audio');
    }
    setIsProcessing(false);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (result) {
    return (
      <Card className="w-full max-w-full overflow-hidden bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-900">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Scribe Note Generated
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Transcript */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Transcript</h3>
            <div className="bg-white p-3 rounded border border-green-200 max-h-24 overflow-y-auto text-xs text-gray-700">
              {result.transcript}
            </div>
          </div>

          {/* Generated Note */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Generated Note</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(result.generated_note)}
              >
                Copy
              </Button>
            </div>
            <div className="bg-white p-3 rounded border border-green-200 max-h-48 overflow-y-auto text-sm text-gray-700 whitespace-pre-wrap">
              {result.generated_note}
            </div>
          </div>

          {/* Compliance Score */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-3 rounded border border-green-200">
              <p className="text-xs text-gray-600 mb-1">Compliance Score</p>
              <p className="text-2xl font-bold text-green-600">{result.compliance_score}%</p>
            </div>
            <div className="bg-white p-3 rounded border border-green-200">
              <p className="text-xs text-gray-600 mb-1">Recording Length</p>
              <p className="text-2xl font-bold text-blue-600">{formatTime(recordingTime)}</p>
            </div>
          </div>

          {/* Issues */}
          {result.missing_elements?.length > 0 && (
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-sm text-yellow-800">
                <p className="font-medium mb-1">Areas to Review:</p>
                <ul className="text-xs space-y-1">
                  {result.missing_elements.map((el, idx) => (
                    <li key={idx}>• {el}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={() => setResult(null)}
            className="w-full"
          >
            Start New Recording
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="w-5 h-5 text-blue-600" />
          Medical Scribe
        </CardTitle>
        <p className="text-sm text-gray-600 mt-2">Record a visit and AI will generate a clinical note</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recording Timer */}
        {isRecording && (
          <div className="flex items-center justify-center gap-2 p-4 bg-red-50 rounded-lg border border-red-200">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm font-semibold text-red-600">
              Recording: {formatTime(recordingTime)}
            </span>
          </div>
        )}

        {/* Recording Button */}
        <div className="flex gap-2">
          <Button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            className={`flex-1 ${isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {isRecording ? (
              <>
                <Square className="w-4 h-4 mr-2" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-2" />
                Start Recording
              </>
            )}
          </Button>
        </div>

        {/* File Upload */}
        <div className="relative">
          <input
            type="file"
            accept="audio/*"
            onChange={handleFileUpload}
            disabled={isRecording || isProcessing}
            className="hidden"
            id="audio-upload"
          />
          <label htmlFor="audio-upload">
            <Button
              asChild
              variant="outline"
              className="w-full cursor-pointer"
              disabled={isRecording || isProcessing}
            >
              <div className="flex items-center justify-center gap-2">
                <Upload className="w-4 h-4" />
                Upload Audio File
              </div>
            </Button>
          </label>
        </div>

        {/* Processing State */}
        {isProcessing && (
          <Alert className="bg-blue-50 border-blue-200">
            <Loader className="w-4 h-4 text-blue-600 animate-spin" />
            <AlertDescription className="text-sm text-blue-800">
              Transcribing and generating note...
            </AlertDescription>
          </Alert>
        )}

        {/* Info */}
        <div className="text-xs text-gray-600 bg-gray-50 p-3 rounded">
          <p className="font-medium mb-1">Tips:</p>
          <ul className="space-y-1">
            <li>• Speak clearly and at a normal pace</li>
            <li>• Include vital signs when mentioning them</li>
            <li>• Mention the patient's condition and response</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}