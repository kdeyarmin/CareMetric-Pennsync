import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Loader2, Sparkles, Copy, Check } from "lucide-react";
import { toast } from "sonner";

export default function AIVisitSummaryGenerator({ visit, patient, messages = [] }) {
  const [summary, setSummary] = useState('');
  const [copied, setCopied] = useState(false);

  const generateSummaryMutation = useMutation({
    mutationFn: async () => {
      const prompt = `Generate a comprehensive telehealth visit summary based on the following information:

PATIENT: ${patient?.first_name} ${patient?.last_name}
DOB: ${patient?.date_of_birth}
PRIMARY DIAGNOSIS: ${patient?.primary_diagnosis}

VISIT TYPE: ${visit?.visit_type}
DATE: ${visit?.visit_date}
DURATION: ${visit?.telehealth_call_duration ? Math.round(visit.telehealth_call_duration / 60) : 'N/A'} minutes

VISIT NOTES: ${visit?.nurse_notes || 'Not documented yet'}

VITAL SIGNS:
- Temperature: ${visit?.vital_signs?.temperature || 'N/A'}°F
- Blood Pressure: ${visit?.vital_signs?.blood_pressure_systolic || 'N/A'}/${visit?.vital_signs?.blood_pressure_diastolic || 'N/A'} mmHg
- Heart Rate: ${visit?.vital_signs?.heart_rate || 'N/A'} bpm
- O2 Saturation: ${visit?.vital_signs?.oxygen_saturation || 'N/A'}%
- Pain Level: ${visit?.vital_signs?.pain_level || 'N/A'}/10

${messages.length > 0 ? `VISIT CONVERSATION HIGHLIGHTS:\n${messages.slice(-10).map(m => `${m.sender_type}: ${m.message_text}`).join('\n')}` : ''}

Generate a professional, Medicare-compliant visit summary including:
1. Chief complaint and reason for visit
2. History of present illness
3. Review of systems
4. Physical assessment findings (based on visual observation)
5. Vital signs interpretation
6. Clinical impression
7. Plan of care and patient education provided
8. Follow-up recommendations

Format as a clinical note ready for documentation.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt
      });

      return result;
    },
    onSuccess: (result) => {
      setSummary(result);
      toast.success('Visit summary generated');
    },
    onError: () => {
      toast.error('Failed to generate summary');
    }
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
    setCopied(true);
    toast.success('Summary copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToVisit = async () => {
    try {
      await base44.entities.Visit.update(visit.id, {
        nurse_notes: summary,
        telehealth_summary: summary
      });
      toast.success('Summary saved to visit notes');
    } catch (error) {
      toast.error('Failed to save summary');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="w-4 h-4 text-blue-600" />
          AI Visit Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!summary ? (
          <Button
            onClick={() => generateSummaryMutation.mutate()}
            disabled={generateSummaryMutation.isPending}
            className="w-full"
            size="sm"
          >
            {generateSummaryMutation.isPending ? (
              <>
                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                Generating Summary...
              </>
            ) : (
              <>
                <FileText className="w-3 h-3 mr-2" />
                Generate Visit Summary
              </>
            )}
          </Button>
        ) : (
          <>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="min-h-[300px] text-sm font-mono"
              placeholder="AI-generated summary will appear here..."
            />
            <div className="flex gap-2">
              <Button
                onClick={handleCopy}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 mr-2" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 mr-2" />
                    Copy
                  </>
                )}
              </Button>
              <Button
                onClick={handleSaveToVisit}
                size="sm"
                className="flex-1"
              >
                <FileText className="w-3 h-3 mr-2" />
                Save to Visit
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}