import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FileText, Brain, Loader2, Copy, Mail, Download, CheckCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function AIFollowUpGenerator({ visitId, patientId, transcript, assessment }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [followUpInstructions, setFollowUpInstructions] = useState(null);
  const [customNotes, setCustomNotes] = useState("");

  const generateFollowUpInstructions = async () => {
    setIsGenerating(true);
    try {
      // Fetch patient and visit data
      const patient = await base44.entities.Patient.filter({ id: patientId }).then(p => p[0]);
      const visit = visitId ? await base44.entities.Visit.filter({ id: visitId }).then(v => v[0]) : null;

      const contextData = {
        patientName: `${patient.first_name} ${patient.last_name}`,
        diagnosis: patient.primary_diagnosis || visit?.diagnosis || 'General consultation',
        medications: patient.current_medications?.map(m => `${m.name} ${m.dosage}`).join(', ') || 'None',
        allergies: patient.allergies || 'None',
        transcript: transcript || visit?.ai_transcript || '',
        symptomAssessment: assessment || (visit?.ai_symptom_assessment ? JSON.parse(visit.ai_symptom_assessment) : null),
        customNotes: customNotes
      };

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate comprehensive follow-up care instructions for a telehealth consultation.

Patient: ${contextData.patientName}
Diagnosis: ${contextData.diagnosis}
Current Medications: ${contextData.medications}
Allergies: ${contextData.allergies}

${contextData.transcript ? `Consultation Summary:\n${contextData.transcript.substring(0, 1000)}` : ''}

${contextData.symptomAssessment ? `AI Assessment:\n${JSON.stringify(contextData.symptomAssessment, null, 2)}` : ''}

${contextData.customNotes ? `Provider Notes:\n${contextData.customNotes}` : ''}

Generate detailed, patient-friendly follow-up instructions including:
1. Summary of consultation (2-3 sentences)
2. Diagnosis/Assessment in plain language
3. Medication instructions (if any changes)
4. Home care instructions (what to do, what to avoid)
5. Warning signs to watch for (when to seek immediate care)
6. Follow-up appointment recommendations
7. Lifestyle/self-care recommendations
8. Questions to prepare for next visit

Make it clear, actionable, and easy for patients to understand. Format as JSON.`,
        response_json_schema: {
          type: "object",
          properties: {
            consultationSummary: { type: "string" },
            diagnosis: { type: "string" },
            medicationInstructions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  medication: { type: "string" },
                  instruction: { type: "string" },
                  timing: { type: "string" }
                }
              }
            },
            homeCareInstructions: { type: "array", items: { type: "string" } },
            warningSigns: { type: "array", items: { type: "string" } },
            followUpSchedule: {
              type: "object",
              properties: {
                timeframe: { type: "string" },
                reason: { type: "string" },
                provider: { type: "string" }
              }
            },
            lifestyleRecommendations: { type: "array", items: { type: "string" } },
            questionsForNextVisit: { type: "array", items: { type: "string" } },
            emergencyContacts: {
              type: "object",
              properties: {
                primary: { type: "string" },
                urgent: { type: "string" }
              }
            }
          }
        }
      });

      setFollowUpInstructions(result);

      // Save to visit record
      if (visitId) {
        await base44.entities.Visit.update(visitId, {
          telehealth_follow_up_instructions: JSON.stringify(result)
        });
      }

      toast.success('Follow-up instructions generated');
    } catch (error) {
      console.error('Error generating instructions:', error);
      toast.error('Failed to generate follow-up instructions');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = () => {
    if (!followUpInstructions) return;
    
    const formatted = formatInstructionsForCopy(followUpInstructions);
    navigator.clipboard.writeText(formatted);
    toast.success('Instructions copied to clipboard');
  };

  const emailToPatient = async () => {
    if (!followUpInstructions) return;

    try {
      const patient = await base44.entities.Patient.filter({ id: patientId }).then(p => p[0]);
      if (!patient.email) {
        toast.error('Patient email not found');
        return;
      }

      const formatted = formatInstructionsForEmail(followUpInstructions);

      await base44.integrations.Core.SendEmail({
        to: patient.email,
        subject: 'Your Telehealth Visit Follow-Up Instructions',
        body: formatted
      });

      toast.success('Instructions emailed to patient');
    } catch (error) {
      console.error('Error emailing instructions:', error);
      toast.error('Failed to email instructions');
    }
  };

  const downloadPDF = async () => {
    if (!followUpInstructions) return;
    
    toast.info('PDF generation coming soon');
  };

  const formatInstructionsForCopy = (instructions) => {
    return `
FOLLOW-UP CARE INSTRUCTIONS

Consultation Summary:
${instructions.consultationSummary}

Diagnosis/Assessment:
${instructions.diagnosis}

${instructions.medicationInstructions?.length > 0 ? `
Medication Instructions:
${instructions.medicationInstructions.map(m => `• ${m.medication}: ${m.instruction} - ${m.timing}`).join('\n')}
` : ''}

Home Care Instructions:
${instructions.homeCareInstructions?.map(i => `• ${i}`).join('\n')}

⚠️ WARNING SIGNS - Seek immediate care if you experience:
${instructions.warningSigns?.map(w => `• ${w}`).join('\n')}

Follow-Up Appointments:
${instructions.followUpSchedule?.timeframe ? `Schedule ${instructions.followUpSchedule.timeframe} for ${instructions.followUpSchedule.reason}` : 'As discussed'}

Lifestyle Recommendations:
${instructions.lifestyleRecommendations?.map(r => `• ${r}`).join('\n')}

Questions for Next Visit:
${instructions.questionsForNextVisit?.map(q => `• ${q}`).join('\n')}

Emergency Contacts:
${instructions.emergencyContacts?.primary || '911 for emergencies'}
`;
  };

  const formatInstructionsForEmail = (instructions) => {
    return `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #2563eb;">Your Telehealth Visit Follow-Up Instructions</h2>
  
  <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
    <h3>Consultation Summary</h3>
    <p>${instructions.consultationSummary}</p>
  </div>

  <div style="margin-bottom: 20px;">
    <h3 style="color: #2563eb;">Diagnosis/Assessment</h3>
    <p>${instructions.diagnosis}</p>
  </div>

  ${instructions.medicationInstructions?.length > 0 ? `
  <div style="margin-bottom: 20px;">
    <h3 style="color: #2563eb;">Medication Instructions</h3>
    <ul>
      ${instructions.medicationInstructions.map(m => `
        <li><strong>${m.medication}:</strong> ${m.instruction} - ${m.timing}</li>
      `).join('')}
    </ul>
  </div>
  ` : ''}

  <div style="margin-bottom: 20px;">
    <h3 style="color: #2563eb;">Home Care Instructions</h3>
    <ul>
      ${instructions.homeCareInstructions?.map(i => `<li>${i}</li>`).join('')}
    </ul>
  </div>

  <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-bottom: 20px;">
    <h3 style="color: #dc2626;">⚠️ Warning Signs - Seek Immediate Care If:</h3>
    <ul>
      ${instructions.warningSigns?.map(w => `<li>${w}</li>`).join('')}
    </ul>
  </div>

  <div style="margin-bottom: 20px;">
    <h3 style="color: #2563eb;">Follow-Up Appointments</h3>
    <p>${instructions.followUpSchedule?.timeframe ? `Schedule ${instructions.followUpSchedule.timeframe} for ${instructions.followUpSchedule.reason}` : 'As discussed during your visit'}</p>
  </div>

  <div style="margin-bottom: 20px;">
    <h3 style="color: #2563eb;">Lifestyle Recommendations</h3>
    <ul>
      ${instructions.lifestyleRecommendations?.map(r => `<li>${r}</li>`).join('')}
    </ul>
  </div>

  <div style="background: #eff6ff; padding: 15px; border-radius: 8px;">
    <h4>Questions to Prepare for Next Visit:</h4>
    <ul>
      ${instructions.questionsForNextVisit?.map(q => `<li>${q}</li>`).join('')}
    </ul>
  </div>

  <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e5e7eb; font-size: 12px; color: #6b7280;">
    <p><strong>Emergency Contacts:</strong> ${instructions.emergencyContacts?.primary || 'Call 911 for emergencies'}</p>
    <p>This information is for your reference. Always contact your healthcare provider if you have questions or concerns.</p>
  </div>
</body>
</html>
`;
  };

  return (
    <Card className="border-green-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-green-50 to-emerald-50">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="w-4 h-4 text-green-600" />
          AI Follow-Up Instructions Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {/* Custom Notes Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">
            Additional Provider Notes (Optional):
          </label>
          <Textarea
            placeholder="Add any specific instructions or concerns to include in follow-up..."
            value={customNotes}
            onChange={(e) => setCustomNotes(e.target.value)}
            rows={3}
            className="text-sm"
          />
        </div>

        {/* Generate Button */}
        <Button
          onClick={generateFollowUpInstructions}
          disabled={isGenerating}
          className="w-full bg-green-600 hover:bg-green-700"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Instructions...
            </>
          ) : (
            <>
              <Brain className="w-4 h-4 mr-2" />
              Generate Follow-Up Instructions
            </>
          )}
        </Button>

        {/* Generated Instructions Display */}
        {followUpInstructions && (
          <div className="space-y-3">
            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button onClick={copyToClipboard} variant="outline" size="sm" className="flex-1">
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
              <Button onClick={emailToPatient} variant="outline" size="sm" className="flex-1">
                <Mail className="w-4 h-4 mr-2" />
                Email
              </Button>
              <Button onClick={downloadPDF} variant="outline" size="sm" className="flex-1">
                <Download className="w-4 h-4 mr-2" />
                PDF
              </Button>
            </div>

            {/* Summary */}
            <div className="bg-green-50 rounded-lg p-3 border border-green-200">
              <h4 className="text-sm font-semibold text-green-900 mb-2">Consultation Summary</h4>
              <p className="text-sm text-green-800">{followUpInstructions.consultationSummary}</p>
            </div>

            {/* Diagnosis */}
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">Diagnosis/Assessment</h4>
              <p className="text-sm text-blue-800">{followUpInstructions.diagnosis}</p>
            </div>

            {/* Medications */}
            {followUpInstructions.medicationInstructions?.length > 0 && (
              <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                <h4 className="text-sm font-semibold text-purple-900 mb-2">Medication Instructions</h4>
                <div className="space-y-2">
                  {followUpInstructions.medicationInstructions.map((med, idx) => (
                    <div key={idx} className="text-sm">
                      <strong className="text-purple-900">{med.medication}:</strong>
                      <p className="text-purple-800 ml-4">{med.instruction}</p>
                      <p className="text-purple-700 text-xs ml-4">{med.timing}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Home Care */}
            <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
              <h4 className="text-sm font-semibold text-yellow-900 mb-2">Home Care Instructions</h4>
              <ul className="text-sm text-yellow-800 space-y-1">
                {followUpInstructions.homeCareInstructions?.map((instruction, idx) => (
                  <li key={idx} className="flex gap-2">
                    <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{instruction}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Warning Signs */}
            <div className="bg-red-50 rounded-lg p-3 border-l-4 border-red-500">
              <h4 className="text-sm font-semibold text-red-900 mb-2 flex items-center gap-2">
                ⚠️ Warning Signs - Seek Immediate Care
              </h4>
              <ul className="text-sm text-red-800 space-y-1">
                {followUpInstructions.warningSigns?.map((sign, idx) => (
                  <li key={idx}>• {sign}</li>
                ))}
              </ul>
            </div>

            {/* Follow-Up Schedule */}
            {followUpInstructions.followUpSchedule && (
              <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-200">
                <h4 className="text-sm font-semibold text-indigo-900 mb-2">Follow-Up Appointments</h4>
                <p className="text-sm text-indigo-800">
                  Schedule {followUpInstructions.followUpSchedule.timeframe} for {followUpInstructions.followUpSchedule.reason}
                </p>
              </div>
            )}

            {/* Lifestyle Recommendations */}
            {followUpInstructions.lifestyleRecommendations?.length > 0 && (
              <div className="bg-teal-50 rounded-lg p-3 border border-teal-200">
                <h4 className="text-sm font-semibold text-teal-900 mb-2">Lifestyle Recommendations</h4>
                <ul className="text-sm text-teal-800 space-y-1">
                  {followUpInstructions.lifestyleRecommendations.map((rec, idx) => (
                    <li key={idx}>• {rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}