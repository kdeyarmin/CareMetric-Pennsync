import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Video, Clock, CheckCircle, Copy, Send } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function TelehealthWaitingRoom({ patient, onStart, onPatientReady }) {
  const [patientUrl, setPatientUrl] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    // Generate patient waiting room URL
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/telehealth-waiting?patientId=${patient.id}`;
    setPatientUrl(url);
  }, [patient]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(patientUrl);
    toast.success("Link copied to clipboard");
  };

  const sendEmailToPatient = async () => {
    try {
      if (!patient.email) {
        toast.error("Patient email not found");
        return;
      }

      await base44.integrations.Core.SendEmail({
        to: patient.email,
        subject: "Your Telehealth Appointment Link",
        body: `
Dear ${patient.first_name} ${patient.last_name},

Your telehealth appointment is ready to begin. Please click the link below to join the virtual waiting room:

${patientUrl}

Once you're ready, your provider will start the video call.

Please ensure:
- You have a stable internet connection
- Your camera and microphone are working
- You're in a quiet, private location

If you have any issues, please contact us immediately.

Best regards,
Your Healthcare Team
        `
      });

      setEmailSent(true);
      toast.success("Link sent to patient's email");
    } catch (error) {
      toast.error("Failed to send email: " + error.message);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Virtual Waiting Room
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-blue-200 bg-blue-50">
            <CheckCircle className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              Patient: {patient.first_name} {patient.last_name}
              <br />
              Consent verified and ready to proceed
            </AlertDescription>
          </Alert>

          <div>
            <h3 className="font-semibold mb-2">Share Link with Patient</h3>
            <p className="text-sm text-gray-600 mb-3">
              Send this link to the patient so they can join the waiting room:
            </p>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={patientUrl}
                readOnly
                className="flex-1 px-3 py-2 border rounded-md bg-gray-50 text-sm"
              />
              <Button onClick={copyToClipboard} variant="outline" size="sm">
                <Copy className="w-4 h-4" />
              </Button>
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                onClick={sendEmailToPatient}
                disabled={emailSent || !patient.email}
                variant="outline"
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                {emailSent ? "Email Sent" : "Email Link to Patient"}
              </Button>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h3 className="font-semibold text-yellow-900 mb-2">Before Starting:</h3>
            <ul className="text-sm text-yellow-800 space-y-1 list-disc list-inside">
              <li>Ensure you're in a private, quiet location</li>
              <li>Test your camera and microphone</li>
              <li>Have patient's chart ready for reference</li>
              <li>Wait for patient to join before starting</li>
              <li>Verify patient identity at start of call</li>
            </ul>
          </div>

          <Button
            onClick={onStart}
            className="w-full bg-green-600 hover:bg-green-700 gap-2"
            size="lg"
          >
            <Video className="w-5 h-5" />
            Start Video Call
          </Button>

          <p className="text-xs text-center text-gray-500">
            The patient will automatically enter when you start the call
          </p>
        </CardContent>
      </Card>
    </div>
  );
}