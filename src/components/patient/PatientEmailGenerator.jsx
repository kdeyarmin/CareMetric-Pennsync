import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, Send, Copy, Edit3, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function PatientEmailGenerator({ 
  patientData, 
  visitNote, 
  diagnosis,
  vitalSigns,
  providerName 
}) {
  const [generatedEmail, setGeneratedEmail] = useState("");
  const [recipientEmail, setRecipientEmail] = useState(patientData?.email || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const generateEmail = async () => {
    setIsGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a patient-friendly follow-up email based on this clinical visit.

PATIENT: ${patientData?.first_name} ${patientData?.last_name}

CLINICAL NOTE:
${visitNote}

VITAL SIGNS:
${vitalSigns ? Object.entries(vitalSigns).filter(([k,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ') : 'Not provided'}

DIAGNOSIS: ${diagnosis || 'General visit'}

Create a clear, empathetic email that:
1. Summarizes the visit in plain language (no medical jargon)
2. Lists key action items for the patient
3. Includes any important follow-up instructions
4. Mentions when to call if symptoms worsen
5. Is warm and reassuring in tone

Use short paragraphs and bullet points for readability.
Address the patient by first name.
Sign off as "${providerName || 'Your Healthcare Provider'}"

Return JSON with:
{
  "subject": "Email subject line",
  "body": "Email body text"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body: { type: "string" }
          }
        }
      });

      setGeneratedEmail(`Subject: ${result.subject}\n\n${result.body}`);
      toast.success("Patient email generated");
    } catch (error) {
      toast.error("Failed to generate email");
    }
    setIsGenerating(false);
  };

  const copyEmail = () => {
    navigator.clipboard.writeText(generatedEmail);
    toast.success("Email copied to clipboard");
  };

  const sendEmail = async () => {
    if (!recipientEmail || !recipientEmail.includes('@')) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsSending(true);
    try {
      const lines = generatedEmail.split('\n');
      const subject = lines[0].replace('Subject: ', '');
      const body = lines.slice(2).join('\n');

      await base44.integrations.Core.SendEmail({
        from_name: providerName || 'Your Healthcare Provider',
        to: recipientEmail,
        subject: subject,
        body: body
      });

      toast.success("Email sent successfully!");
      setEmailSent(true);
    } catch (error) {
      toast.error("Failed to send email");
    }
    setIsSending(false);
  };

  return (
    <Card className="border-2 border-green-300 bg-gradient-to-br from-green-50 to-emerald-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="w-5 h-5 text-green-600" />
          Patient Follow-up Email
        </CardTitle>
        <p className="text-xs text-gray-600">Auto-generate plain-language visit summaries for patients</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!generatedEmail ? (
          <>
            <Alert className="bg-blue-50 border-blue-200">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-sm text-blue-900">
                <strong>Patient Instructions:</strong> Transform your clinical note into easy-to-understand guidance with clear action items.
              </AlertDescription>
            </Alert>

            <Button
              onClick={generateEmail}
              disabled={isGenerating || !visitNote}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Email...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Patient Email
                </>
              )}
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            {/* Email Preview */}
            <div className="bg-white rounded-lg border border-green-200 p-4">
              {isEditing ? (
                <Textarea
                  value={generatedEmail}
                  onChange={(e) => setGeneratedEmail(e.target.value)}
                  className="min-h-[300px] text-sm font-sans"
                />
              ) : (
                <pre className="text-sm whitespace-pre-wrap font-sans text-gray-800">
                  {generatedEmail}
                </pre>
              )}
            </div>

            {/* Recipient Email */}
            {!emailSent && (
              <div>
                <label className="text-sm font-medium mb-1 block">Patient Email Address</label>
                <Input
                  type="email"
                  placeholder="patient@email.com"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  className="h-9"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {!emailSent && (
                <>
                  <Button
                    onClick={() => setIsEditing(!isEditing)}
                    variant="outline"
                    size="sm"
                  >
                    <Edit3 className="w-3 h-3 mr-1" />
                    {isEditing ? 'Preview' : 'Edit'}
                  </Button>
                  <Button
                    onClick={copyEmail}
                    variant="outline"
                    size="sm"
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy
                  </Button>
                  <Button
                    onClick={sendEmail}
                    disabled={isSending || !recipientEmail}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Email
                      </>
                    )}
                  </Button>
                </>
              )}
              {emailSent && (
                <Alert className="w-full bg-green-100 border-green-300">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-sm text-green-900">
                    Email sent successfully to {recipientEmail}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Generate New */}
            <Button
              onClick={() => {
                setGeneratedEmail("");
                setEmailSent(false);
                setIsEditing(false);
              }}
              variant="outline"
              size="sm"
              className="w-full"
            >
              Generate New Email
            </Button>
          </div>
        )}

        {/* Patient Info Display */}
        {patientData && (
          <div className="pt-2 border-t border-green-200">
            <p className="text-xs text-gray-600">
              Patient: <strong>{patientData.first_name} {patientData.last_name}</strong>
              {patientData.email && <span className="ml-2">({patientData.email})</span>}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}