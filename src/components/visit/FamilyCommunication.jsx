import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Mail,
  MessageSquare,
  Users,
  Sparkles,
  Send,
  CheckCircle2,
  Plus,
  X,
  Edit,
  Eye,
  RefreshCw,
  Activity, // Added for 'Health Measurements'
  Pill, // Added for 'Medication Info'
  AlertTriangle, // Added for 'Areas of Concern'
  Calendar // Added for 'Next Steps'
} from "lucide-react";
import { format } from "date-fns";

export default function FamilyCommunication({ patient, visit, vitalSigns, narrativeText }) {
  const [showDialog, setShowDialog] = useState(false);
  const [recipients, setRecipients] = useState([]);
  const [newRecipient, setNewRecipient] = useState({ name: "", email: "", phone: "", relation: "" });
  const [summary, setSummary] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendMethod, setSendMethod] = useState("email");
  const [previewMode, setPreviewMode] = useState(false);
  const [includeOptions, setIncludeOptions] = useState({
    vitals: true,
    activities: true,
    medications: true,
    mood: true,
    concerns: false,
    nextSteps: true,
    contactInfo: true
  });

  // Add recipient
  const addRecipient = () => {
    if (newRecipient.name && (newRecipient.email || newRecipient.phone)) {
      setRecipients([...recipients, { ...newRecipient, id: Date.now() }]);
      setNewRecipient({ name: "", email: "", phone: "", relation: "" });
    }
  };

  // Remove recipient
  const removeRecipient = (id) => {
    setRecipients(recipients.filter(r => r.id !== id));
  };

  // Auto-populate from patient record
  const loadFamilyContacts = () => {
    const contacts = [];
    
    // Add patient's email if available
    if (patient.email) {
      contacts.push({
        id: Date.now(),
        name: `${patient.first_name} ${patient.last_name}`,
        email: patient.email,
        phone: patient.phone || "",
        relation: "Patient"
      });
    }
    
    // Add primary caregiver if stored in patient record
    if (patient.caregiver_email) {
      contacts.push({
        id: Date.now() + 1,
        name: patient.caregiver_name || "Primary Caregiver",
        email: patient.caregiver_email,
        phone: patient.caregiver_phone || "",
        relation: "Primary Caregiver"
      });
    }
    
    setRecipients(contacts);
  };

  // Generate family-friendly summary
  const generateSummary = async () => {
    setIsGenerating(true);
    
    try {
      let prompt = `You are a compassionate home health nurse communicating with family members. Generate a warm, clear, family-friendly summary of today's visit.

PATIENT: ${patient.first_name} ${patient.last_name}
VISIT DATE: ${visit.visit_date}
VISIT TYPE: ${visit.visit_type.replace(/_/g, ' ')}

`;

      // Add vital signs if available
      if (includeOptions.vitals && Object.keys(vitalSigns).length > 0) {
        prompt += `VITAL SIGNS TODAY:\n`;
        if (vitalSigns.blood_pressure_systolic) {
          prompt += `- Blood Pressure: ${vitalSigns.blood_pressure_systolic}/${vitalSigns.blood_pressure_diastolic}\n`;
        }
        if (vitalSigns.heart_rate) prompt += `- Heart Rate: ${vitalSigns.heart_rate}\n`;
        if (vitalSigns.temperature) prompt += `- Temperature: ${vitalSigns.temperature}°F\n`;
        if (vitalSigns.oxygen_saturation) prompt += `- Oxygen Level: ${vitalSigns.oxygen_saturation}%\n`;
        if (vitalSigns.pain_level !== undefined) prompt += `- Pain Level: ${vitalSigns.pain_level}/10\n`;
        prompt += '\n';
      }

      // Add clinical notes excerpt
      if (narrativeText && narrativeText.length > 100) {
        prompt += `CLINICAL OBSERVATIONS (excerpt):\n${narrativeText.substring(0, 500)}\n\n`;
      }

      prompt += `INSTRUCTIONS:
Generate a family-friendly update that includes:

1. **Greeting**: Warm, personal greeting
2. **How ${patient.first_name} is Doing Today**: Overall status in simple terms${includeOptions.vitals ? '\n3. **Health Measurements**: Vital signs in plain language (e.g., "blood pressure was good")' : ''}${includeOptions.activities ? '\n4. **Activities During Visit**: What we did together' : ''}${includeOptions.medications ? '\n5. **Medications**: Any changes or important reminders' : ''}${includeOptions.mood ? '\n6. **Mood and Spirits**: How patient seemed emotionally' : ''}${includeOptions.concerns ? '\n7. **Areas of Concern**: Any issues to watch (gentle, not alarming)' : ''}${includeOptions.nextSteps ? '\n8. **Next Steps**: What to expect, next visit, any actions needed' : ''}${includeOptions.contactInfo ? '\n9. **Contact Information**: Remind them how to reach us' : ''}

TONE:
- Warm, caring, and positive
- Use simple, non-medical language
- Be honest but reassuring
- Avoid medical jargon (explain terms like "ambulation" = "walking around")
- Emphasize strengths and progress
- If concerns exist, frame constructively

LENGTH: 250-350 words (brief but complete)

FORMAT: Use short paragraphs with clear section breaks for easy reading.

Generate the family update now:`;

      const generatedSummary = await base44.integrations.Core.InvokeLLM({
        prompt
      });

      setSummary(generatedSummary);
      setPreviewMode(true);

    } catch (error) {
      console.error("Error generating summary:", error);
      alert("Error generating summary. Please try again.");
    }
    
    setIsGenerating(false);
  };

  // Send to family members
  const sendToFamily = async () => {
    if (recipients.length === 0) {
      alert("Please add at least one recipient");
      return;
    }

    if (!summary) {
      alert("Please generate a summary first");
      return;
    }

    setIsSending(true);

    try {
      const subject = `Update on ${patient.first_name} ${patient.last_name} - ${format(new Date(visit.visit_date), 'MMMM d, yyyy')}`;
      
      const { generateEmailTemplate } = await import('../utils/branding');
      const currentNurse = await base44.auth.me();

      // Send email to each recipient
      for (const recipient of recipients) {
        if (sendMethod === "email" && recipient.email) {
          const emailContent = `
            <p style="font-size: 16px; color: #1f2937;">Dear ${recipient.name},</p>
            
            <div style="margin: 20px 0; line-height: 1.8; white-space: pre-wrap; font-size: 15px; color: #374151;">
${summary}
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #1f2937;"><strong>Warm regards,</strong></p>
              <p style="margin: 5px 0 0 0; color: #6b7280;">${currentNurse.full_name}</p>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">Home Health Nurse</p>
            </div>
            
            <div style="margin-top: 20px; padding: 15px; background: #f0f9ff; border-radius: 8px; border-left: 4px solid #2563eb;">
              <p style="margin: 0; font-size: 14px; color: #1e40af;"><strong>Questions or Concerns?</strong></p>
              <p style="margin: 5px 0 0 0; font-size: 14px; color: #3b82f6;">We're here to help. Contact us anytime.</p>
            </div>
          `;

          const htmlEmail = generateEmailTemplate(emailContent, {
            subject: subject
          });

          await base44.integrations.Core.SendEmail({
            to: recipient.email,
            subject: subject,
            body: htmlEmail,
            from_name: 'CareMetric AI'
          });
        }
        
        // TODO: SMS functionality would go here if phone number and SMS integration available
        // For now, we'll just do email
      }

      // Log the communication
      await base44.entities.Visit.update(visit.id, {
        family_update_sent: true,
        family_update_date: new Date().toISOString(),
        family_update_text: summary
      });

      alert(`Family update sent successfully to ${recipients.length} recipient(s)!`);
      setShowDialog(false);
      
      // Reset form
      setSummary("");
      setPreviewMode(false);

    } catch (error) {
      console.error("Error sending updates:", error);
      alert("Error sending updates. Please try again.");
    }
    
    setIsSending(false);
  };

  return (
    <>
      <Card className="bg-gradient-to-r from-cyan-50 to-blue-50 border-cyan-200">
        <CardHeader className="pb-3">
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="w-5 h-5 text-cyan-600" />
              Family Communication
              <Badge variant="outline" className="bg-white">Saves 5-10 min</Badge>
            </CardTitle>
            <Button
              onClick={() => {
                setShowDialog(true);
                loadFamilyContacts();
              }}
              size="sm"
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              <Mail className="w-4 h-4 mr-2" />
              Send Family Update
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Alert className="bg-white border-cyan-200">
            <Users className="w-4 h-4 text-cyan-600" />
            <AlertDescription className="text-gray-700">
              Automatically generate and send a warm, family-friendly visit summary to caregivers and loved ones.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Send Family Update
            </DialogTitle>
            <DialogDescription>
              Generate a caring, easy-to-understand summary for family members
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Recipients Section */}
            <div>
              <Label className="text-base font-semibold mb-3 block">Recipients</Label>
              
              {recipients.length > 0 && (
                <div className="space-y-2 mb-3">
                  {recipients.map((recipient) => (
                    <div key={recipient.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{recipient.name}</p>
                        <p className="text-sm text-gray-600">
                          {recipient.relation && `${recipient.relation} • `}
                          {recipient.email || recipient.phone}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRecipient(recipient.id)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <Input
                  placeholder="Name"
                  value={newRecipient.name}
                  onChange={(e) => setNewRecipient({ ...newRecipient, name: e.target.value })}
                />
                <Input
                  placeholder="Relation (e.g., Daughter)"
                  value={newRecipient.relation}
                  onChange={(e) => setNewRecipient({ ...newRecipient, relation: e.target.value })}
                />
                <Input
                  type="email"
                  placeholder="Email"
                  value={newRecipient.email}
                  onChange={(e) => setNewRecipient({ ...newRecipient, email: e.target.value })}
                />
                <Input
                  type="tel"
                  placeholder="Phone (optional)"
                  value={newRecipient.phone}
                  onChange={(e) => setNewRecipient({ ...newRecipient, phone: e.target.value })}
                />
                <Button
                  onClick={addRecipient}
                  variant="outline"
                  className="col-span-2"
                  disabled={!newRecipient.name || !newRecipient.email}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Recipient
                </Button>
              </div>
            </div>

            {/* Include Options */}
            <div>
              <Label className="text-base font-semibold mb-3 block">What to Include</Label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'vitals', label: 'Health Measurements', icon: Activity },
                  { key: 'activities', label: 'Visit Activities', icon: CheckCircle2 },
                  { key: 'medications', label: 'Medication Info', icon: Pill },
                  { key: 'mood', label: 'Mood & Spirits', icon: Users },
                  { key: 'concerns', label: 'Areas of Concern', icon: AlertTriangle },
                  { key: 'nextSteps', label: 'Next Steps', icon: Calendar },
                ].map(({ key, label, icon: Icon }) => (
                  <div key={key} className="flex items-center space-x-2 p-2 bg-gray-50 rounded border">
                    <Checkbox
                      id={key}
                      checked={includeOptions[key]}
                      onCheckedChange={(checked) => setIncludeOptions({ ...includeOptions, [key]: checked })}
                    />
                    <Label htmlFor={key} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Icon className="w-4 h-4 text-gray-600" />
                      {label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Generate/Preview Section */}
            {!previewMode ? (
              <Button
                onClick={generateSummary}
                disabled={isGenerating}
                className="w-full bg-blue-600 hover:bg-blue-700"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                    Generating Family-Friendly Summary...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Generate Family Update
                  </>
                )}
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <Label className="text-base font-semibold">Preview & Edit</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={generateSummary}
                      disabled={isGenerating}
                    >
                      <RefreshCw className="w-4 h-4 mr-1" />
                      Regenerate
                    </Button>
                  </div>
                </div>
                
                <Textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={12}
                  className="font-sans text-sm"
                />
                
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-green-900">
                    Summary ready to send! You can edit it above before sending.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </div>

          <DialogFooter className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setShowDialog(false);
                setSummary("");
                setPreviewMode(false);
              }}
            >
              Cancel
            </Button>
            
            {previewMode && (
              <Button
                onClick={sendToFamily}
                disabled={isSending || recipients.length === 0}
                className="bg-cyan-600 hover:bg-cyan-700"
              >
                {isSending ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send to {recipients.length} Recipient{recipients.length !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}