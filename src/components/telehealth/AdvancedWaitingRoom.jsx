import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Video, Clock, CheckCircle, Copy, Send, Users, Phone, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function AdvancedWaitingRoom({ 
  patient, 
  provider,
  onStart, 
  onCancel,
  appointment 
}) {
  const [patientUrl, setPatientUrl] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [waitingStatus, setWaitingStatus] = useState("preparing"); // preparing, ready, patient_joined, about_to_start
  const [patientJoined, setPatientJoined] = useState(false);
  const [showPreStartChecklist, setShowPreStartChecklist] = useState(false);
  const [checklistItems, setChecklistItems] = useState({
    privacy: false,
    equipment: false,
    chart_ready: false,
    identity_verified: false
  });

  useEffect(() => {
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/telehealth-patient-waiting?appointmentId=${appointment.id}`;
    setPatientUrl(url);
  }, [appointment]);

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
        subject: `Telehealth Appointment with ${provider.full_name} - Join Link`,
        body: `
Dear ${patient.first_name},

Your telehealth appointment with ${provider.full_name} is scheduled for ${appointment.appointment_date} at ${appointment.start_time}.

Please click the link below to enter the waiting room. Your provider will start the video call when ready:

${patientUrl}

IMPORTANT:
✓ Test your camera and microphone before joining
✓ Join in a private, quiet location
✓ Have your insurance card and medical ID handy
✓ Join 5-10 minutes early

Questions? Contact us at ${provider.practice_phone || 'your healthcare provider'}

Best regards,
${provider.full_name}
        `
      });

      setEmailSent(true);
      toast.success("Appointment link sent to patient");
    } catch (error) {
      toast.error("Failed to send email");
    }
  };

  const allChecklistComplete = Object.values(checklistItems).every(v => v === true);

  const handleStartCall = () => {
    if (!allChecklistComplete) {
      toast.error("Please complete the pre-start checklist");
      return;
    }
    onStart();
  };

  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <Card className="border-2 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50">
        <CardContent className="p-6">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="text-center">
              <Users className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-900">Patient</p>
              <p className="text-xs text-gray-600">{patient.first_name} {patient.last_name}</p>
              {patientJoined && (
                <Badge className="mt-2 bg-green-600">Joined</Badge>
              )}
            </div>
            <div className="text-center flex flex-col items-center justify-center">
              <div className="text-2xl text-gray-400">→</div>
              <p className="text-xs text-gray-600">Ready to start</p>
            </div>
            <div className="text-center">
              <Video className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-900">Provider</p>
              <p className="text-xs text-gray-600">{provider.full_name}</p>
              <Badge className="mt-2 bg-blue-600">Ready</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Patient Invitation Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Phone className="w-4 h-4" />
            Send Appointment Link to Patient
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">
              Waiting Room Link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={patientUrl}
                readOnly
                className="flex-1 px-3 py-2 border rounded-md bg-gray-50 text-sm font-mono"
              />
              <Button onClick={copyToClipboard} variant="outline" size="sm">
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <Button
            onClick={sendEmailToPatient}
            disabled={emailSent || !patient.email}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            <Send className="w-4 h-4 mr-2" />
            {emailSent ? "✓ Email Sent to Patient" : "Email Link to Patient"}
          </Button>

          {!patient.email && (
            <Alert className="border-yellow-200 bg-yellow-50">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-sm text-yellow-800">
                No email on file. Provide the link manually or update patient contact info.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Pre-Start Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            Pre-Start Checklist
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(checklistItems).map(([key, checked]) => {
            const labels = {
              privacy: "In private, quiet location",
              equipment: "Camera & microphone tested",
              chart_ready: "Patient chart ready for reference",
              identity_verified: "Ready to verify patient identity"
            };

            return (
              <label key={key} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    setChecklistItems({ ...checklistItems, [key]: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">{labels[key]}</span>
              </label>
            );
          })}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
            <h4 className="font-medium text-sm text-blue-900 mb-2">Best Practices:</h4>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>Verify patient identity before proceeding</li>
              <li>Explain any clinical findings during the call</li>
              <li>Use secure messaging for any follow-up items</li>
              <li>Document visit details immediately after call</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          onClick={handleStartCall}
          disabled={!allChecklistComplete}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white h-12"
          size="lg"
        >
          <Video className="w-5 h-5 mr-2" />
          Start Video Call
        </Button>
        <Button
          onClick={onCancel}
          variant="outline"
          className="flex-1 h-12"
          size="lg"
        >
          Cancel
        </Button>
      </div>

      <p className="text-xs text-center text-gray-500">
        The patient will be notified when you start the call
      </p>
    </div>
  );
}