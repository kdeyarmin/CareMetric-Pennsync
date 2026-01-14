import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Copy, Zap, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function EnhancedPostCallSummary({
  visitId,
  patient,
  callDuration,
  callNotes,
  transcription,
  keyPoints,
  actionItems,
  onSummaryGenerated
}) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visitId && patient) {
      generateSummary();
    }
  }, [visitId, patient]);

  const generateSummary = async () => {
    setLoading(true);
    try {
      const summaryResult = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a professional medical visit summary for:
Patient: ${patient.first_name} ${patient.last_name}
Duration: ${Math.floor(callDuration / 60)} minutes
Visit Type: Telehealth

Transcription Summary:
${transcription?.substring(0, 500) || 'No transcription available'}

Key Points Discussed:
${keyPoints?.map(p => `- ${p}`).join('\n') || 'None identified'}

Action Items:
${actionItems?.map(a => `- ${a.item} (${a.priority} priority)`).join('\n') || 'None identified'}

Provider Notes:
${callNotes || 'None'}

Generate a concise, professional summary suitable for the patient's medical record.`,
        add_context_from_internet: false
      });

      setSummary(summaryResult);
      onSummaryGenerated?.(summaryResult);
    } catch (error) {
      console.error('Summary generation error:', error);
      setSummary('Failed to generate summary. Please try again.');
    }
    setLoading(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([summary], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `visit-summary-${visitId}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            AI-Generated Visit Summary
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={generateSummary}
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-4 min-h-48 border border-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            summary || 'No summary generated yet'
          )}
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            disabled={!summary}
            className="flex-1"
          >
            <Copy className="w-3 h-3 mr-1" />
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            disabled={!summary}
            className="flex-1"
          >
            <Download className="w-3 h-3 mr-1" />
            Download
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-blue-50 rounded p-2 border border-blue-200">
            <p className="text-gray-600">Duration</p>
            <p className="font-semibold text-gray-900">{Math.floor(callDuration / 60)} min</p>
          </div>
          <div className="bg-green-50 rounded p-2 border border-green-200">
            <p className="text-gray-600">Action Items</p>
            <p className="font-semibold text-gray-900">{actionItems?.length || 0}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}