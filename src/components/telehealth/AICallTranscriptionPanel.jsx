import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageSquare, Copy, Download, Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function AICallTranscriptionPanel({ visitId, isActive, callStartTime }) {
  const [transcription, setTranscription] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isActive && visitId) {
      setIsTranscribing(true);
      // Real-time transcription would integrate with WebSocket or polling
      // For now, this component displays transcription as it's updated
    }
  }, [isActive, visitId]);

  const handleCopyTranscript = async () => {
    await navigator.clipboard.writeText(transcription);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTranscript = () => {
    const element = document.createElement('a');
    const file = new Blob([transcription], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `transcript-${visitId}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Real-Time Transcription
          {isTranscribing && <Zap className="w-3 h-3 text-blue-600 animate-pulse" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="bg-gray-50 rounded-lg p-3 h-32 overflow-y-auto text-sm text-gray-700 border border-gray-200">
          {transcription ? (
            <p>{transcription}</p>
          ) : (
            <p className="text-gray-400">Transcription will appear here...</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopyTranscript}
            className="flex-1"
          >
            <Copy className="w-3 h-3 mr-1" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadTranscript}
            className="flex-1"
            disabled={!transcription}
          >
            <Download className="w-3 h-3 mr-1" />
            Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}