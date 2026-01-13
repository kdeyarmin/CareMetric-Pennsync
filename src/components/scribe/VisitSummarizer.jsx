import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Copy, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function VisitSummarizer({ noteContent, diagnosis, visitType, patientName }) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateSummary = async () => {
    if (!noteContent || noteContent.length < 100) {
      toast.error('Note content too short to summarize');
      return;
    }

    setLoading(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Create a concise, 2-3 sentence patient visit summary for ${patientName || 'patient'} that captures the key clinical findings and plan.

Visit Type: ${visitType}
Diagnosis: ${diagnosis}

Clinical Note:
${noteContent}

Summary should be:
- Professional and suitable for handoff communication
- Include patient status, key findings, and plan
- Be clear and actionable
- Suitable for EHR summary field`,
      });

      setSummary(response);
    } catch (error) {
      console.error('Summary generation error:', error);
      toast.error('Failed to generate summary');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Summary copied to clipboard');
  };

  return (
    <Card className="border-blue-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm md:text-base">Visit Summary</CardTitle>
          {!summary && (
            <Button
              size="sm"
              onClick={generateSummary}
              disabled={loading || !noteContent || noteContent.length < 100}
              className="h-7 text-xs"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate'
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {summary ? (
          <div className="space-y-3">
            <div className="bg-blue-50 p-3 rounded-md border border-blue-200">
              <p className="text-sm text-slate-700 leading-relaxed">{summary}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                className="h-8 text-xs"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 mr-1 text-green-600" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSummary('')}
                className="h-8 text-xs"
              >
                Regenerate
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-600">
            Generate a concise summary of this visit for quick reference or handoff communication.
          </p>
        )}
      </CardContent>
    </Card>
  );
}