import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, CheckCircle, Clock, Upload, Video, Send, Download } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function TelehealthPostCallSummary({
  visitId,
  patient,
  callDuration,
  callNotes,
  sharedFiles,
  wasRecorded,
  onDocumentVisit,
  onReturnToPatients
}) {
  const [summary, setSummary] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const generateAISummary = async () => {
    setGenerating(true);
    try {
      const prompt = `Generate a professional telehealth visit summary based on the following information:

Patient: ${patient.first_name} ${patient.last_name}
Call Duration: ${formatDuration(callDuration)}
Provider Notes: ${callNotes || "No notes taken during call"}
Files Shared: ${sharedFiles.length > 0 ? sharedFiles.map(f => f.name).join(", ") : "None"}
Session Recorded: ${wasRecorded ? "Yes" : "No"}

Create a concise, professional summary that includes:
1. Visit overview
2. Key discussion points
3. Files shared during visit
4. Next steps or follow-up items
5. Any recommendations

Format this as a clinical note ready to be added to patient chart.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: null
      });

      setSummary(response);
      toast.success("Summary generated successfully");
    } catch (error) {
      toast.error("Failed to generate summary: " + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const saveSummaryToVisit = async () => {
    try {
      await base44.entities.Visit.update(visitId, {
        nurse_notes: summary,
        telehealth_call_duration: callDuration,
        telehealth_summary: summary
      });

      setSaved(true);
      toast.success("Summary saved to visit record");
    } catch (error) {
      toast.error("Failed to save summary: " + error.message);
    }
  };

  const sendSummaryToPatient = async () => {
    try {
      if (!patient.email) {
        toast.error("Patient email not found");
        return;
      }

      await base44.integrations.Core.SendEmail({
        to: patient.email,
        subject: "Your Telehealth Visit Summary",
        body: `
Dear ${patient.first_name} ${patient.last_name},

Thank you for your telehealth visit today. Below is a summary of our consultation:

${summary || callNotes}

${sharedFiles.length > 0 ? `\nFiles shared during visit:\n${sharedFiles.map(f => `- ${f.name}`).join('\n')}` : ''}

If you have any questions or concerns, please don't hesitate to contact us.

Best regards,
Your Healthcare Team
        `
      });

      toast.success("Summary sent to patient");
    } catch (error) {
      toast.error("Failed to send summary: " + error.message);
    }
  };

  const downloadSummary = () => {
    const content = `TELEHEALTH VISIT SUMMARY

Patient: ${patient.first_name} ${patient.last_name}
Date: ${new Date().toLocaleDateString()}
Duration: ${formatDuration(callDuration)}
Recorded: ${wasRecorded ? "Yes" : "No"}

${summary || callNotes}

Files Shared:
${sharedFiles.length > 0 ? sharedFiles.map(f => `- ${f.name}`).join('\n') : 'None'}
`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telehealth-summary-${patient.last_name}-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    toast.success("Summary downloaded");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            Telehealth Visit Completed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900">
              The video call has ended successfully. Review and save the visit summary below.
            </AlertDescription>
          </Alert>

          {/* Visit Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-3 rounded-lg">
              <div className="text-xs text-blue-600 mb-1">Duration</div>
              <div className="font-semibold">{formatDuration(callDuration)}</div>
            </div>
            <div className="bg-purple-50 p-3 rounded-lg">
              <div className="text-xs text-purple-600 mb-1">Files Shared</div>
              <div className="font-semibold">{sharedFiles.length}</div>
            </div>
            <div className="bg-orange-50 p-3 rounded-lg">
              <div className="text-xs text-orange-600 mb-1">Notes Taken</div>
              <div className="font-semibold">{callNotes ? "Yes" : "No"}</div>
            </div>
            <div className="bg-green-50 p-3 rounded-lg">
              <div className="text-xs text-green-600 mb-1">Recorded</div>
              <div className="font-semibold">{wasRecorded ? "Yes" : "No"}</div>
            </div>
          </div>

          {/* Call Notes */}
          {callNotes && (
            <div>
              <h3 className="font-semibold mb-2">Call Notes</h3>
              <div className="bg-gray-50 p-3 rounded-lg text-sm whitespace-pre-wrap">
                {callNotes}
              </div>
            </div>
          )}

          {/* Shared Files */}
          {sharedFiles.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Shared Files</h3>
              <div className="space-y-2">
                {sharedFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-gray-50 p-2 rounded text-sm">
                    <Upload className="w-4 h-4 text-gray-500" />
                    <span>{file.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Summary */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold">AI-Generated Summary</h3>
              <Button
                size="sm"
                onClick={generateAISummary}
                disabled={generating}
                variant="outline"
              >
                {generating ? "Generating..." : "Generate Summary"}
              </Button>
            </div>
            
            {summary ? (
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
                rows={8}
              />
            ) : (
              <div className="bg-gray-50 p-4 rounded-lg text-center text-gray-500 text-sm">
                Click "Generate Summary" to create an AI-powered visit summary
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={onDocumentVisit}
              className="bg-blue-600 hover:bg-blue-700 gap-2"
            >
              <FileText className="w-4 h-4" />
              Document Full Visit
            </Button>

            {summary && (
              <>
                <Button
                  onClick={saveSummaryToVisit}
                  disabled={saved}
                  variant="outline"
                  className="gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  {saved ? "Saved" : "Save Summary"}
                </Button>

                <Button
                  onClick={sendSummaryToPatient}
                  variant="outline"
                  className="gap-2"
                >
                  <Send className="w-4 h-4" />
                  Email to Patient
                </Button>

                <Button
                  onClick={downloadSummary}
                  variant="outline"
                  className="gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download
                </Button>
              </>
            )}

            <Button
              variant="outline"
              onClick={onReturnToPatients}
            >
              Return to Patients
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}