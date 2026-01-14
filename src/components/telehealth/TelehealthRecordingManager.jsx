import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Loader, Lock, AlertCircle, CheckCircle2, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';

/**
 * HIPAA-compliant recording manager for telehealth sessions
 * Handles recording status, transcription, and secure storage
 */
export default function TelehealthRecordingManager({ 
  visitId, 
  patientId, 
  isRecording, 
  onRecordingStatusChange 
}) {
  const queryClient = useQueryClient();
  const [recordingStatus, setRecordingStatus] = useState(isRecording ? 'recording' : 'idle');
  const [transcript, setTranscript] = useState(null);
  const [isGeneratingTranscript, setIsGeneratingTranscript] = useState(false);

  // Fetch recording metadata
  const { data: recordingData } = useQuery({
    queryKey: ['recording', visitId],
    queryFn: async () => {
      try {
        const logs = await base44.asServiceRole.entities.SystemLog.filter({
          details: { visitId }
        });
        return logs.find(l => l.action === 'telehealth_recording_started');
      } catch {
        return null;
      }
    },
    enabled: !!visitId
  });

  // Generate transcript mutation
  const generateTranscriptMutation = useMutation({
    mutationFn: async (audioUrl) => {
      setIsGeneratingTranscript(true);
      try {
        const response = await base44.functions.invoke('generateTelehealthTranscript', {
          visitId,
          audioUrl,
          patientId,
          deidentify: true // HIPAA-compliant de-identification
        });
        return response.data;
      } finally {
        setIsGeneratingTranscript(false);
      }
    },
    onSuccess: (data) => {
      setTranscript(data);
      toast.success('Transcript generated successfully');
      queryClient.invalidateQueries({ queryKey: ['recording', visitId] });
    },
    onError: (error) => {
      toast.error('Failed to generate transcript: ' + error.message);
    }
  });

  const handleGenerateTranscript = async () => {
    if (recordingData?.details?.recordingUrl) {
      generateTranscriptMutation.mutate(recordingData.details.recordingUrl);
    } else {
      toast.error('Recording URL not available');
    }
  };

  const downloadTranscript = () => {
    if (!transcript) return;

    const element = document.createElement('a');
    const file = new Blob([transcript.transcript], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `transcript-${visitId}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const getRecordingStatusColor = () => {
    switch (recordingStatus) {
      case 'recording':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <Card className={`border-2 ${getRecordingStatusColor()}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="w-4 h-4" />
            HIPAA-Compliant Recording
          </CardTitle>
          <Badge className={`${getRecordingStatusColor()}`}>
            {recordingStatus === 'recording' && (
              <>
                <span className="animate-pulse mr-1">●</span>
                Recording
              </>
            )}
            {recordingStatus === 'paused' && 'Paused'}
            {recordingStatus === 'completed' && 'Completed'}
            {recordingStatus === 'idle' && 'Not Recording'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Compliance Alert */}
        <Alert className="bg-blue-50 border-blue-200">
          <CheckCircle2 className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-xs text-blue-900">
            All recordings are encrypted end-to-end, HIPAA-compliant, and stored securely with automatic de-identification for transcripts.
          </AlertDescription>
        </Alert>

        {/* Recording Status */}
        {recordingData && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between p-2 bg-gray-50 rounded">
              <span className="text-gray-600">Composition ID:</span>
              <code className="text-xs font-mono text-gray-800 truncate">
                {recordingData.details?.compositionSid || 'N/A'}
              </code>
            </div>
            <div className="flex justify-between p-2 bg-gray-50 rounded">
              <span className="text-gray-600">Recording Method:</span>
              <span className="font-medium text-gray-900">
                {recordingData.details?.recordingMethod || 'Participant Record'}
              </span>
            </div>
          </div>
        )}

        {/* Transcript Section */}
        {transcript ? (
          <div className="space-y-2">
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-green-900 text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Transcript Generated
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={downloadTranscript}
                  className="gap-1"
                >
                  <Download className="w-3 h-3" />
                  Download
                </Button>
              </div>
              <div className="text-xs text-green-800 space-y-1">
                <p>Duration: {transcript.metadata?.estimatedMinutes} minutes</p>
                <p>Words: {transcript.metadata?.wordCount}</p>
                <p>Status: {transcript.deidentified ? 'De-identified ✓' : 'Original'}</p>
              </div>
            </div>

            {/* Transcript Preview */}
            <div className="max-h-32 overflow-y-auto p-2 bg-gray-50 rounded text-xs text-gray-700 border border-gray-200">
              {transcript.transcript.substring(0, 300)}...
            </div>
          </div>
        ) : (
          <Button
            onClick={handleGenerateTranscript}
            disabled={!recordingData || isGeneratingTranscript}
            variant="outline"
            className="w-full"
            size="sm"
          >
            {isGeneratingTranscript ? (
              <>
                <Loader className="w-3 h-3 mr-2 animate-spin" />
                Generating Transcript...
              </>
            ) : (
              'Generate AI Transcript'
            )}
          </Button>
        )}

        {/* Privacy Notice */}
        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex gap-2 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Privacy:</strong> Recording requires explicit patient consent. Transcripts are automatically de-identified and stored in HIPAA-compliant secure storage.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}