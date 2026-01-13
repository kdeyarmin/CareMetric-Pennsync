import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileText, Send, Copy, Download, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

const LETTER_TYPES = [
  { id: "referral", name: "Referral Letter", icon: "🏥", description: "Refer patient to specialist" },
  { id: "sick_note", name: "Sick Note / Excuse", icon: "📋", description: "Work/school absence verification" },
  { id: "return_to_work", name: "Return to Work", icon: "✅", description: "Medical clearance certification" },
  { id: "caregiver_letter", name: "Caregiver Letter", icon: "👨‍⚕️", description: "Letter for family/caregiver" },
  { id: "disability_form", name: "Disability Documentation", icon: "📄", description: "Support disability claim" },
  { id: "appeal_letter", name: "Insurance Appeal", icon: "💼", description: "Medical necessity appeal" },
  { id: "home_health_order", name: "Home Health Order", icon: "🏠", description: "Physician order for services" },
  { id: "dme_letter", name: "DME Justification", icon: "🦽", description: "Medical equipment necessity" },
  { id: "school_accommodation", name: "School Accommodation", icon: "🎓", description: "Academic accommodation request" },
  { id: "travel_clearance", name: "Travel Clearance", icon: "✈️", description: "Medical travel approval" },
  { id: "fitness_clearance", name: "Fitness Clearance", icon: "💪", description: "Exercise/activity clearance" },
  { id: "prescription_request", name: "Prescription Request", icon: "💊", description: "Medication recommendation" }
];

export default function ClinicalLetterGenerator({ 
  patientData, 
  visitNote, 
  diagnosis,
  providerName,
  providerCredentials
}) {
  const [letterType, setLetterType] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientTitle, setRecipientTitle] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [generatedLetter, setGeneratedLetter] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const selectedType = LETTER_TYPES.find(t => t.id === letterType);

  const generateLetter = async () => {
    if (!letterType) {
      toast.error("Select a letter type");
      return;
    }

    setIsGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a professional ${selectedType.name} for this patient.

PATIENT INFORMATION:
${patientData ? `
- Name: ${patientData.first_name} ${patientData.last_name}
- DOB: ${patientData.date_of_birth || 'Not provided'}
- Diagnosis: ${diagnosis || patientData.primary_diagnosis}
- Medical Record #: ${patientData.medical_record_number || 'N/A'}
` : 'Anonymous patient'}

RECENT VISIT NOTE:
${visitNote || 'No visit note provided'}

LETTER TYPE: ${selectedType.name}
PURPOSE: ${selectedType.description}

${recipientName ? `RECIPIENT: ${recipientName}${recipientTitle ? `, ${recipientTitle}` : ''}` : ''}

${additionalInfo ? `ADDITIONAL INFORMATION:\n${additionalInfo}` : ''}

PROVIDER:
${providerName || 'Healthcare Provider'}${providerCredentials ? `, ${providerCredentials}` : ''}

Generate a professional, medically accurate letter that:
- Uses appropriate professional medical letter format
- Includes relevant clinical information from the visit
- Maintains patient privacy (HIPAA compliant)
- Is clear and actionable for the recipient
- Uses formal business letter structure

CRITICAL: Return ONLY the letter text, formatted and ready to send. Do NOT include meta-commentary.`,
        response_json_schema: {
          type: "object",
          properties: {
            letter_content: { type: "string" },
            subject_line: { type: "string" }
          }
        }
      });

      setGeneratedLetter(result.letter_content);
      toast.success("Letter generated successfully");
    } catch (error) {
      toast.error("Failed to generate letter");
    }
    setIsGenerating(false);
  };

  const copyLetter = () => {
    navigator.clipboard.writeText(generatedLetter);
    toast.success("Letter copied to clipboard");
  };

  const downloadLetter = () => {
    const blob = new Blob([generatedLetter], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedType?.name.replace(/\s/g, '_')}_${patientData?.last_name || 'Letter'}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    toast.success("Letter downloaded");
  };

  return (
    <Card className="border-2 border-green-300 bg-gradient-to-br from-green-50 to-emerald-50">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-5 h-5 text-green-600" />
          Clinical Letter Generator
        </CardTitle>
        <p className="text-xs text-gray-600">Generate professional letters and documentation</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!generatedLetter ? (
          <>
            {/* Letter Type Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Letter Type</label>
              <Select value={letterType} onValueChange={setLetterType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select letter type..." />
                </SelectTrigger>
                <SelectContent>
                  {LETTER_TYPES.map(type => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.icon} {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedType && (
                <p className="text-xs text-gray-600 italic">{selectedType.description}</p>
              )}
            </div>

            {/* Quick Letter Templates Grid */}
            {!letterType && (
              <div className="grid grid-cols-2 gap-2">
                {LETTER_TYPES.slice(0, 6).map(type => (
                  <Button
                    key={type.id}
                    variant="outline"
                    size="sm"
                    onClick={() => setLetterType(type.id)}
                    className="h-auto py-2 px-3 flex flex-col items-start gap-1 hover:bg-green-50"
                  >
                    <span className="text-lg">{type.icon}</span>
                    <span className="text-xs font-medium text-left">{type.name}</span>
                  </Button>
                ))}
              </div>
            )}

            {/* Recipient Info */}
            {letterType && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Recipient Name</label>
                  <Input
                    placeholder="Dr. John Smith"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Title/Specialty</label>
                  <Input
                    placeholder="Cardiologist"
                    value={recipientTitle}
                    onChange={(e) => setRecipientTitle(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            )}

            {/* Additional Info */}
            {letterType && (
              <div>
                <label className="text-sm font-medium mb-1 block">Additional Information (Optional)</label>
                <Textarea
                  placeholder="Add specific details, restrictions, recommendations, or context..."
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value)}
                  className="h-20 text-sm"
                />
              </div>
            )}

            {/* Generate Button */}
            <Button
              onClick={generateLetter}
              disabled={isGenerating || !letterType}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Letter...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate {selectedType?.name || 'Letter'}
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            {/* Generated Letter Display */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Badge className="bg-green-600 text-white">
                  {selectedType?.icon} {selectedType?.name}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setGeneratedLetter("");
                    setLetterType("");
                    setRecipientName("");
                    setRecipientTitle("");
                    setAdditionalInfo("");
                  }}
                >
                  Generate New
                </Button>
              </div>

              <div className="bg-white p-4 rounded-lg border border-green-200 max-h-96 overflow-y-auto">
                <pre className="text-xs whitespace-pre-wrap font-sans text-gray-800">
                  {generatedLetter}
                </pre>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  onClick={copyLetter}
                  variant="outline"
                  className="flex-1"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </Button>
                <Button
                  onClick={downloadLetter}
                  variant="outline"
                  className="flex-1"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}