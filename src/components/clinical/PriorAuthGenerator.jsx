import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Loader2, FileCheck, Copy, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";

export default function PriorAuthGenerator({ 
  diagnosis, 
  noteContent,
  procedure,
  patientContext,
  onAuthGenerated 
}) {
  const [loading, setLoading] = useState(false);
  const [priorAuth, setPriorAuth] = useState(null);
  
  // Form fields
  const [patientName, setPatientName] = useState("");
  const [insuranceCompany, setInsuranceCompany] = useState("");
  const [customInsurance, setCustomInsurance] = useState("");
  const [showCustomInsurance, setShowCustomInsurance] = useState(false);
  const [diagnoses, setDiagnoses] = useState("");
  const [clinicalFindings, setClinicalFindings] = useState("");
  const [medications, setMedications] = useState("");
  const [requestedTreatment, setRequestedTreatment] = useState("");

  // Common US insurance companies
  const commonInsurers = [
    "United Healthcare",
    "Blue Cross Blue Shield",
    "Aetna",
    "Cigna",
    "Humana",
    "Medicare",
    "Medicaid",
    "Kaiser Permanente",
    "Anthem",
    "Centene",
    "Molina Healthcare",
    "WellCare",
    "Tricare",
    "Bright Health",
    "Oscar Health",
    "Other/Add New"
  ];

  // Get provider settings for letterhead info
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: providerSettings } = useQuery({
    queryKey: ["providerSettings", currentUser?.email],
    queryFn: async () => {
      const settings = await base44.entities.ProviderSettings.filter({
        provider_email: currentUser.email
      });
      return settings[0];
    },
    enabled: !!currentUser?.email
  });

  // Pre-fill from props if available
  useEffect(() => {
    if (diagnosis) setDiagnoses(diagnosis);
    if (noteContent) setClinicalFindings(noteContent);
    if (procedure) setRequestedTreatment(procedure);
    if (patientContext?.name) setPatientName(patientContext.name);
  }, [diagnosis, noteContent, procedure, patientContext]);

  const generatePriorAuth = async () => {
    const finalInsurance = showCustomInsurance ? customInsurance : insuranceCompany;
    
    // Validate required fields
    if (!patientName || !finalInsurance || !diagnoses || !requestedTreatment) {
      toast.error('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      // Build provider information section
      const providerInfo = providerSettings ? `
PROVIDER INFORMATION:
Provider Name: ${currentUser?.full_name || 'Not specified'}
${providerSettings.practice_name ? `Practice: ${providerSettings.practice_name}` : ''}
${providerSettings.npi ? `NPI: ${providerSettings.npi}` : ''}
${providerSettings.tax_id ? `Tax ID: ${providerSettings.tax_id}` : ''}
${providerSettings.phone ? `Phone: ${providerSettings.phone}` : ''}
${providerSettings.fax ? `Fax: ${providerSettings.fax}` : ''}
${providerSettings.address ? `Address: ${providerSettings.address}` : ''}
` : `
PROVIDER INFORMATION:
Provider Name: ${currentUser?.full_name || 'Not specified'}
`;

      const prompt = `You are a medical professional writing a prior authorization letter. Research and generate the most clinically sound, evidence-based argument for approval.

${providerInfo}

PATIENT INFORMATION:
Patient Name: ${patientName}
Insurance Company: ${finalInsurance}

DIAGNOSES:
${diagnoses}

CLINICAL FINDINGS & RELEVANT INFORMATION:
${clinicalFindings || 'See attached clinical documentation'}

${medications ? `CURRENT MEDICATIONS:\n${medications}\n` : ''}

REQUESTED TREATMENT/MEDICATION/TEST:
${requestedTreatment}

INSTRUCTIONS:
1. **CRITICAL: Research ${finalInsurance}'s specific prior authorization requirements, criteria, and policies for this treatment/condition**
2. Research the medical literature and clinical guidelines for this specific treatment/condition combination
3. Build a compelling, evidence-based case that specifically addresses ${finalInsurance}'s approval criteria
4. Include relevant clinical studies, guidelines, and FDA approvals when applicable
5. Address common ${finalInsurance} denials and pre-emptively counter them with their own criteria
6. Cite specific medical criteria that ${finalInsurance} requires for approval
7. Include CPT and ICD-10 codes
8. Explain why alternatives are inadequate or contraindicated per ${finalInsurance}'s guidelines
9. Present expected outcomes with supporting evidence that meets ${finalInsurance}'s standards
10. Format as a professional business letter ready for submission to ${finalInsurance}

Generate a complete prior authorization letter tailored to ${finalInsurance}'s requirements that maximizes the likelihood of approval.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true, // Enable web search for insurance-specific requirements
        response_json_schema: {
          type: "object",
          properties: {
            procedure_name: { type: "string" },
            cpt_codes: { type: "array", items: { type: "string" } },
            icd10_codes: { type: "array", items: { type: "string" } },
            insurance_specific_requirements: { type: "string" },
            medical_necessity: { type: "string" },
            clinical_rationale: { type: "string" },
            evidence_based_support: { type: "string" },
            supporting_documentation: { type: "array", items: { type: "string" } },
            expected_outcomes: { type: "string" },
            alternatives_considered: { type: "string" },
            why_alternatives_inadequate: { type: "string" },
            duration_requested: { type: "string" },
            full_letter: { type: "string" }
          }
        }
      });

      setPriorAuth(response);
      if (onAuthGenerated) {
        onAuthGenerated(response);
      }
      toast.success(`Prior authorization generated with ${finalInsurance}-specific research`);
    } catch (error) {
      console.error('Error generating prior auth:', error);
      toast.error('Failed to generate prior authorization');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(priorAuth.full_letter);
    toast.success('Prior authorization copied to clipboard');
  };

  const downloadAsPDF = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const margin = 20;
      const maxWidth = pageWidth - (margin * 2);
      
      let y = margin;

      // Add provider letterhead if available
      if (providerSettings?.practice_name) {
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text(providerSettings.practice_name, margin, y);
        y += 7;
        
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        if (providerSettings.address) {
          const addressLines = doc.splitTextToSize(providerSettings.address, maxWidth);
          addressLines.forEach(line => {
            doc.text(line, margin, y);
            y += 5;
          });
        }
        if (providerSettings.phone) {
          doc.text(`Phone: ${providerSettings.phone}`, margin, y);
          y += 5;
        }
        if (providerSettings.fax) {
          doc.text(`Fax: ${providerSettings.fax}`, margin, y);
          y += 5;
        }
        y += 5;
      }

      // Date
      doc.setFontSize(10);
      doc.text(new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }), margin, y);
      y += 10;

      // Letter content
      doc.setFontSize(10);
      const letterLines = doc.splitTextToSize(priorAuth.full_letter, maxWidth);
      
      letterLines.forEach(line => {
        if (y > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += 5;
      });

      doc.save(`prior_auth_${patientName.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
      toast.success('PDF downloaded successfully');
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF');
    }
  };

  const resetForm = () => {
    setPriorAuth(null);
    setPatientName("");
    setInsuranceCompany("");
    setCustomInsurance("");
    setShowCustomInsurance(false);
    setDiagnoses("");
    setClinicalFindings("");
    setMedications("");
    setRequestedTreatment("");
  };

  const handleInsuranceChange = (value) => {
    if (value === "Other/Add New") {
      setShowCustomInsurance(true);
      setInsuranceCompany("");
    } else {
      setShowCustomInsurance(false);
      setInsuranceCompany(value);
      setCustomInsurance("");
    }
  };

  return (
    <Card className="border-indigo-200 bg-indigo-50 dark:bg-indigo-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileCheck className="w-4 h-4 text-indigo-600" />
          Prior Authorization Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!priorAuth ? (
          <>
            {/* Patient Information */}
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Patient Name *</Label>
                <Input
                  placeholder="Enter patient full name"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="text-sm"
                />
              </div>

              <div>
                <Label className="text-xs">Insurance Company *</Label>
                {!showCustomInsurance ? (
                  <Select value={insuranceCompany} onValueChange={handleInsuranceChange}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Select insurance company" />
                    </SelectTrigger>
                    <SelectContent>
                      {commonInsurers.map((insurer) => (
                        <SelectItem key={insurer} value={insurer}>
                          {insurer}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-2">
                    <Input
                      placeholder="Enter insurance company name"
                      value={customInsurance}
                      onChange={(e) => setCustomInsurance(e.target.value)}
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowCustomInsurance(false);
                        setCustomInsurance("");
                      }}
                      className="text-xs"
                    >
                      Back to list
                    </Button>
                  </div>
                )}
              </div>

              <div>
                <Label className="text-xs">Diagnoses *</Label>
                <Textarea
                  placeholder="Enter all relevant diagnoses (e.g., Type 2 Diabetes Mellitus, Hypertension, CHF)"
                  value={diagnoses}
                  onChange={(e) => setDiagnoses(e.target.value)}
                  className="text-sm h-20"
                />
              </div>

              <div>
                <Label className="text-xs">Clinical Findings & Important Information</Label>
                <Textarea
                  placeholder="Enter relevant clinical findings, test results, patient history, symptoms, functional limitations, etc."
                  value={clinicalFindings}
                  onChange={(e) => setClinicalFindings(e.target.value)}
                  className="text-sm h-24"
                />
              </div>

              <div>
                <Label className="text-xs">Current Medications (if relevant)</Label>
                <Textarea
                  placeholder="List current medications, dosages, and relevant history"
                  value={medications}
                  onChange={(e) => setMedications(e.target.value)}
                  className="text-sm h-20"
                />
              </div>

              <div>
                <Label className="text-xs">Requested Treatment/Medication/Test *</Label>
                <Textarea
                  placeholder="Specify exactly what you're requesting prior authorization for"
                  value={requestedTreatment}
                  onChange={(e) => setRequestedTreatment(e.target.value)}
                  className="text-sm h-20"
                />
              </div>

              <Button
                onClick={generatePriorAuth}
                disabled={loading || !patientName || (!insuranceCompany && !customInsurance) || !diagnoses || !requestedTreatment}
                className="bg-indigo-600 hover:bg-indigo-700 w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Researching Insurance Requirements...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    Generate Evidence-Based Authorization
                  </>
                )}
              </Button>
              <p className="text-xs text-slate-600 dark:text-slate-400 text-center">
                AI will research {showCustomInsurance ? customInsurance : insuranceCompany || "insurance"}'s requirements and build the strongest case
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            {/* Summary */}
            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-indigo-200">
              <h5 className="font-semibold text-sm mb-2">{priorAuth.procedure_name}</h5>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400">CPT Codes:</p>
                  <div className="flex gap-1 flex-wrap">
                    {priorAuth.cpt_codes?.map((code, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {code}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400">ICD-10:</p>
                  <div className="flex gap-1 flex-wrap">
                    {priorAuth.icd10_codes?.map((code, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {code}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <Badge className="bg-indigo-600">
                Duration: {priorAuth.duration_requested}
              </Badge>
            </div>

            {/* Insurance-Specific Requirements */}
            {priorAuth.insurance_specific_requirements && (
              <div className="bg-purple-50 dark:bg-purple-900 p-3 rounded-lg border border-purple-200">
                <p className="text-xs font-medium text-purple-900 dark:text-purple-300 mb-1">
                  Insurance-Specific Requirements Addressed:
                </p>
                <p className="text-xs text-purple-800 dark:text-purple-200">
                  {priorAuth.insurance_specific_requirements}
                </p>
              </div>
            )}

            {/* Evidence-Based Support */}
            {priorAuth.evidence_based_support && (
              <div className="bg-blue-50 dark:bg-blue-900 p-3 rounded-lg border border-blue-200">
                <p className="text-xs font-medium text-blue-900 dark:text-blue-300 mb-1">
                  Evidence-Based Support:
                </p>
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  {priorAuth.evidence_based_support}
                </p>
              </div>
            )}

            {/* Medical Necessity */}
            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-indigo-200">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Medical Necessity:
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {priorAuth.medical_necessity}
              </p>
            </div>

            {/* Why Alternatives Are Inadequate */}
            {priorAuth.why_alternatives_inadequate && (
              <div className="bg-yellow-50 dark:bg-yellow-900 p-3 rounded-lg border border-yellow-200">
                <p className="text-xs font-medium text-yellow-900 dark:text-yellow-300 mb-1">
                  Why Alternatives Are Inadequate:
                </p>
                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                  {priorAuth.why_alternatives_inadequate}
                </p>
              </div>
            )}

            {/* Expected Outcomes */}
            <div className="bg-green-50 dark:bg-green-900 p-3 rounded-lg">
              <p className="text-xs font-medium text-green-900 dark:text-green-300 mb-1">
                Expected Outcomes:
              </p>
              <p className="text-xs text-green-800 dark:text-green-200">
                {priorAuth.expected_outcomes}
              </p>
            </div>

            {/* Full Letter */}
            <div>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                Complete Authorization Letter:
              </p>
              <Textarea
                value={priorAuth.full_letter}
                readOnly
                className="text-xs h-64 font-mono"
              />
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={copyToClipboard}
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy Text
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={downloadAsPDF}
                className="bg-red-50 hover:bg-red-100"
              >
                <Download className="w-3 h-3 mr-1" />
                Download PDF
              </Button>
            </div>
            <Button
              size="sm"
              onClick={resetForm}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              Create New Request
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}