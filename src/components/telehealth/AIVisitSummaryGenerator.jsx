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
      const prompt = `Generate a comprehensive, Medicare-compliant telehealth visit encounter note based on the following information:

PATIENT INFORMATION:
- Name: ${patient?.first_name} ${patient?.last_name}
- DOB: ${patient?.date_of_birth}
- MRN: ${patient?.medical_record_number || 'N/A'}
- Primary Diagnosis: ${patient?.primary_diagnosis}
- Secondary Diagnoses: ${patient?.secondary_diagnoses?.join(', ') || 'None documented'}
- Medications: ${patient?.current_medications?.map(m => m.name).join(', ') || 'None documented'}

VISIT DETAILS:
- Visit Type: ${visit?.visit_type}
- Date: ${visit?.visit_date}
- Time: ${visit?.visit_time}
- Duration: ${visit?.telehealth_call_duration ? Math.round(visit.telehealth_call_duration / 60) : 'N/A'} minutes
- Modality: Telehealth Video Consultation

PROVIDER NOTES:
${visit?.nurse_notes || 'Not documented yet'}

VITAL SIGNS (if collected):
- Temperature: ${visit?.vital_signs?.temperature || 'Not collected'}°F
- Blood Pressure: ${visit?.vital_signs?.blood_pressure_systolic || 'N/A'}/${visit?.vital_signs?.blood_pressure_diastolic || 'N/A'} mmHg
- Heart Rate: ${visit?.vital_signs?.heart_rate || 'Not collected'} bpm
- Respiratory Rate: ${visit?.vital_signs?.respiratory_rate || 'Not collected'} breaths/min
- O2 Saturation: ${visit?.vital_signs?.oxygen_saturation || 'Not collected'}%
- Pain Level: ${visit?.vital_signs?.pain_level || 'Not collected'}/10
- Weight: ${visit?.vital_signs?.weight || 'Not collected'} lbs

${messages.length > 0 ? `CONVERSATION SUMMARY:\n${messages.slice(-15).map(m => `${m.sender_type}: ${m.message_text}`).join('\n')}` : ''}

Generate a complete clinical encounter note in SOAP format with the following sections:

**SUBJECTIVE:**
- Chief complaint
- History of present illness (HPI)
- Review of systems (ROS) - relevant systems only
- Current medication compliance and side effects
- Functional status updates

**OBJECTIVE:**
- General appearance and demeanor (from video observation)
- Vital signs interpretation
- Visual assessment findings (mobility, skin color, respiratory effort, etc.)
- Home environment observations if relevant
- Technology/connectivity quality during visit

**ASSESSMENT:**
- Clinical impression
- Problem list with ICD-10 codes if applicable
- Progress toward treatment goals
- Risk factors identified
- Medicare homebound status confirmation (if applicable)

**PLAN:**
- Interventions provided during visit
- Patient education topics discussed
- Medication adjustments (if any)
- Follow-up plan and timeline
- Referrals or coordination needs
- Documentation of telehealth consent and HIPAA compliance

**BILLING JUSTIFICATION:**
Include specific documentation elements to support telehealth billing:
- Medical necessity of visit
- Time spent and complexity
- Skilled services provided
- Patient progress and response to treatment

Format as a professional clinical note ready for EHR documentation.`;

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