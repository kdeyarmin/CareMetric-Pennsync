import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchablePatientSelect from "@/components/ui/SearchablePatientSelect";
import ESignatureWorkflow from "@/components/documents/ESignatureWorkflow";
import { FileText, Sparkles, Download, Send, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const DOCUMENT_TYPES = [
  {
    value: "admission_consent",
    label: "Admission Consent Form",
    description: "Standard consent form for home health admission",
    prompt: "Generate a professional admission consent form for home health care services"
  },
  {
    value: "hipaa_authorization",
    label: "HIPAA Authorization",
    description: "HIPAA privacy authorization form",
    prompt: "Generate a HIPAA authorization form for release of protected health information"
  },
  {
    value: "treatment_consent",
    label: "Treatment Consent",
    description: "Consent for medical treatment and procedures",
    prompt: "Generate a treatment consent form authorizing specific medical procedures and care"
  },
  {
    value: "discharge_summary",
    label: "Discharge Summary",
    description: "Patient discharge summary and instructions",
    prompt: "Generate a comprehensive discharge summary with patient instructions and follow-up care"
  },
  {
    value: "care_plan_summary",
    label: "Care Plan Summary",
    description: "Summary of patient's care plan for family/caregivers",
    prompt: "Generate a patient-friendly care plan summary document"
  },
  {
    value: "medication_list",
    label: "Medication List",
    description: "Current medications and administration schedule",
    prompt: "Generate a detailed medication list with dosages, frequencies, and instructions"
  },
  {
    value: "education_handout",
    label: "Patient Education Handout",
    description: "Custom education materials for patient conditions",
    prompt: "Generate an educational handout about the patient's condition and self-care"
  },
  {
    value: "progress_report",
    label: "Progress Report",
    description: "Patient progress report for physician or insurance",
    prompt: "Generate a professional progress report detailing patient's clinical status and improvements"
  },
  {
    value: "authorization_request",
    label: "Prior Authorization Request",
    description: "Insurance prior authorization request",
    prompt: "Generate a prior authorization request for insurance with clinical justification"
  },
  {
    value: "family_communication",
    label: "Family Communication Letter",
    description: "Letter updating family on patient status",
    prompt: "Generate a compassionate letter to family members updating them on patient status"
  }
];

export default function AIDocumentGenerator() {
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [generatedDocument, setGeneratedDocument] = useState(null);
  const ai = useAICall();
  const [signatureWorkflowOpen, setSignatureWorkflowOpen] = useState(false);

  // Fetch patient data
  const { data: patient } = useQuery({
    queryKey: ['patient', selectedPatientId],
    queryFn: () => base44.entities.Patient.filter({ id: selectedPatientId }),
    enabled: !!selectedPatientId,
    select: (data) => data[0]
  });

  // Fetch patient's recent visits
  const { data: recentVisits = [] } = useQuery({
    queryKey: ['patient-visits', selectedPatientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: selectedPatientId }, '-visit_date', 5),
    enabled: !!selectedPatientId,
  });

  // Fetch patient's care plans
  const { data: carePlans = [] } = useQuery({
    queryKey: ['patient-careplans', selectedPatientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId,
  });

  const selectedDocType = DOCUMENT_TYPES.find(d => d.value === documentType);

  const handleGenerate = async () => {
    if (!selectedPatientId || !documentType) {
      toast.error("Please select a patient and document type");
      return;
    }
    // patient comes from an async query independent of selectedPatientId; the button
    // doesn't wait for it, so guard against a not-yet-loaded / missing record before
    // dereferencing patient.* below.
    if (!patient) {
      toast.error("Patient details are still loading — please try again in a moment");
      return;
    }

    try {
      // Build comprehensive patient context
      const patientContext = `
Patient Information:
- Name: ${patient.first_name} ${patient.last_name}
- Date of Birth: ${patient.date_of_birth}
- Medical Record Number: ${patient.medical_record_number || 'N/A'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patient.allergies || 'None'}
- Current Medications: ${patient.current_medications?.map(m => `${m.name} ${m.dosage} ${m.frequency}`).join(', ') || 'None listed'}
- Primary Contact: ${patient.emergency_contact_name || 'N/A'} (${patient.emergency_contact_relationship || 'N/A'}) - ${patient.emergency_contact_phone || 'N/A'}
- Physician: ${patient.physician_name || 'N/A'} - ${patient.physician_phone || 'N/A'}

Recent Clinical Activity:
${recentVisits.length > 0 ? recentVisits.map(v => `- ${v.visit_date}: ${v.visit_type} - ${v.nurse_notes?.substring(0, 200) || 'No notes'}`).join('\n') : '- No recent visits recorded'}

Active Care Plans:
${carePlans.length > 0 ? carePlans.map(cp => `- ${cp.problem}: ${cp.goal} (Status: ${cp.status})`).join('\n') : '- No active care plans'}

Additional Context from User:
${additionalContext || 'None provided'}
`;

      const prompt = `${selectedDocType.prompt}

${patientContext}

IMPORTANT INSTRUCTIONS:
1. Generate a professional, complete document ready for use
2. Use proper medical terminology and formatting
3. AUTO-FILL ALL AVAILABLE PATIENT INFORMATION:
   - Replace [PATIENT NAME] with: ${patient.first_name} ${patient.last_name}
   - Replace [DATE OF BIRTH] with: ${patient.date_of_birth}
   - Replace [MRN] with: ${patient.medical_record_number || 'N/A'}
   - Replace [TODAY'S DATE] or [DATE] with: ${new Date().toLocaleDateString()}
   - Replace [PRIMARY DIAGNOSIS] with: ${patient.primary_diagnosis || 'N/A'}
   - Replace [ALLERGIES] with: ${patient.allergies || 'None'}
   - Replace [PHYSICIAN] with: ${patient.physician_name || 'N/A'}
   - Replace [EMERGENCY CONTACT] with: ${patient.emergency_contact_name || 'N/A'} (${patient.emergency_contact_phone || 'N/A'})
4. Make the document clear, concise, and compliant with healthcare standards
5. Format the document with proper sections and headers
6. Include signature lines and date fields where appropriate
7. Use placeholders [TO BE COMPLETED] only for information not available in the context
8. Make it ready for printing or digital signing

Generate the complete document now with all available fields pre-filled:`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: prompt,
        add_context_from_internet: false
      });

      setGeneratedDocument(result);
      toast.success("Document generated successfully!");
    } catch (error) {
      console.error('Document generation error:', error);
      toast.error("Failed to generate document. Please try again.");
    }
  };

  const handleDownload = () => {
    if (!generatedDocument) return;

    const blob = new Blob([generatedDocument], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedDocType?.label.replace(/\s+/g, '_')}_${patient?.first_name}_${patient?.last_name}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    toast.success("Document downloaded!");
  };

  const handleCreateForSigning = async () => {
    if (!generatedDocument || !selectedPatientId) return;
    setSignatureWorkflowOpen(true);
  };

  const handleReset = () => {
    setGeneratedDocument(null);
    setAdditionalContext("");
    setDocumentType("");
  };

  return (
    <>
      <div className="space-y-6">
      <Card className="border-navy-200 bg-gradient-to-br from-navy-50 to-indigo-50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-navy-600 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle>AI Document Generator</CardTitle>
              <CardDescription>
                Auto-generate professional patient documents with AI assistance
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {!generatedDocument ? (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Input Form */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Document Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Select Patient *</Label>
                <SearchablePatientSelect
                  value={selectedPatientId}
                  onChange={setSelectedPatientId}
                />
              </div>

              <div>
                <Label>Document Type *</Label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose document type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex flex-col">
                          <span className="font-medium">{type.label}</span>
                          <span className="text-xs text-slate-500">{type.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Additional Context (Optional)</Label>
                <Textarea
                  placeholder="Add any specific details you want included in the document..."
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
                <p className="text-xs text-slate-500 mt-1">
                  e.g., "Include recent blood pressure readings" or "Focus on wound care instructions"
                </p>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={!selectedPatientId || !documentType || ai.loading}
                className="w-full bg-navy-600 hover:bg-navy-700"
                size="lg"
              >
                {ai.loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generating with AI...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Generate Document
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Patient Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Patient Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {patient ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-slate-600">Patient Name</p>
                    <p className="font-semibold">{patient.first_name} {patient.last_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Date of Birth</p>
                    <p className="font-semibold">{patient.date_of_birth}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Primary Diagnosis</p>
                    <p className="font-semibold">{patient.primary_diagnosis || 'Not specified'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Recent Visits</p>
                    <p className="font-semibold">{recentVisits.length} visits in records</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Active Care Plans</p>
                    <p className="font-semibold">{carePlans.length} active plans</p>
                  </div>
                  
                  {selectedDocType && (
                    <div className="mt-4 p-3 bg-navy-50 border border-navy-200 rounded-lg">
                      <p className="text-sm font-semibold text-navy-900 mb-1">
                        Will Generate:
                      </p>
                      <p className="text-sm text-navy-700">{selectedDocType.description}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500">
                  <FileText className="w-12 h-12 mx-auto mb-3 text-slate-400" />
                  <p>Select a patient to see details</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        /* Generated Document View */
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Generated Document
                </CardTitle>
                <CardDescription>
                  {selectedDocType?.label} for {patient?.first_name} {patient?.last_name}
                </CardDescription>
              </div>
              <div className="flex gap-1.5">
                <Button onClick={handleReset} size="sm" className="text-xs px-2 py-0.5 h-auto border border-slate-300 hover:bg-slate-50">
                  Generate New
                </Button>
                <Button onClick={handleDownload} size="sm" className="text-xs px-2 py-0.5 h-auto border border-slate-300 hover:bg-slate-50">
                  <Download className="w-2.5 h-2.5 mr-1" />
                  Download
                </Button>
                <Button onClick={handleCreateForSigning} size="sm" className="text-xs px-2 py-0.5 h-auto bg-blue-600 hover:bg-blue-700 text-white">
                  <Send className="w-2.5 h-2.5 mr-1" />
                  Send for Signature
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-white border border-slate-300 rounded-lg p-6 min-h-[600px] max-h-[800px] overflow-y-auto">
              <pre className="whitespace-pre-wrap font-serif text-sm leading-relaxed">
                {generatedDocument}
              </pre>
            </div>
            
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900">
                <strong>Review carefully:</strong> This document was AI-generated. Please review all information for accuracy 
                before downloading or sending for signature. You can edit the text above if needed.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    
      {signatureWorkflowOpen && (
        <ESignatureWorkflow
          document={generatedDocument}
          documentType={selectedDocType?.label}
          patient={patient}
          onClose={() => setSignatureWorkflowOpen(false)}
        />
      )}
    </>
  );
}