import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, FileCheck, Copy, Download } from "lucide-react";
import { toast } from "sonner";

export default function PriorAuthGenerator({ 
  diagnosis, 
  noteContent,
  procedure,
  patientContext,
  onAuthGenerated 
}) {
  const [loading, setLoading] = useState(false);
  const [priorAuth, setPriorAuth] = useState(null);
  const [customProcedure, setCustomProcedure] = useState("");

  const generatePriorAuth = async (procedureType) => {
    setLoading(true);
    try {
      const prompt = `Generate a comprehensive prior authorization request for the following:

Patient Diagnosis: ${diagnosis}
Procedure/Service: ${procedureType || customProcedure}
Clinical Documentation: ${noteContent}
${patientContext ? `Patient History: ${JSON.stringify(patientContext)}` : ''}

Create a complete prior authorization letter that includes:
1. Patient demographics and insurance information section
2. Procedure/service details with CPT codes
3. Medical necessity justification with evidence
4. Clinical rationale and supporting documentation
5. Expected outcomes and benefits
6. Alternative treatments considered
7. Supporting ICD-10 diagnosis codes
8. Duration of authorization requested

Format as a professional clinical letter suitable for submission to insurance.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            procedure_name: { type: "string" },
            cpt_codes: { type: "array", items: { type: "string" } },
            icd10_codes: { type: "array", items: { type: "string" } },
            medical_necessity: { type: "string" },
            clinical_rationale: { type: "string" },
            supporting_documentation: { type: "array", items: { type: "string" } },
            expected_outcomes: { type: "string" },
            alternatives_considered: { type: "string" },
            duration_requested: { type: "string" },
            full_letter: { type: "string" }
          }
        }
      });

      setPriorAuth(response);
      if (onAuthGenerated) {
        onAuthGenerated(response);
      }
      toast.success('Prior authorization generated');
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

  const downloadAsDoc = () => {
    const blob = new Blob([priorAuth.full_letter], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prior_auth_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Downloaded prior authorization');
  };

  const commonProcedures = [
    { label: 'Home Health Services', value: 'Home Health Skilled Nursing' },
    { label: 'Physical Therapy', value: 'Physical Therapy Services' },
    { label: 'Occupational Therapy', value: 'Occupational Therapy Services' },
    { label: 'Wound Care', value: 'Advanced Wound Care' },
    { label: 'IV Therapy', value: 'Intravenous Therapy' },
    { label: 'DME - Wheelchair', value: 'Power Wheelchair' },
    { label: 'DME - Hospital Bed', value: 'Hospital Bed' },
    { label: 'Hospice Care', value: 'Hospice Services' }
  ];

  if (!diagnosis) return null;

  return (
    <Card className="border-indigo-200 bg-indigo-50 dark:bg-indigo-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileCheck className="w-4 h-4 text-indigo-600" />
          Prior Authorization Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!priorAuth ? (
          <>
            <div>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                Select a common procedure or enter custom:
              </p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {commonProcedures.map((proc, idx) => (
                  <Button
                    key={idx}
                    size="sm"
                    variant="outline"
                    onClick={() => generatePriorAuth(proc.value)}
                    disabled={loading}
                    className="text-xs h-auto py-2"
                  >
                    {proc.label}
                  </Button>
                ))}
              </div>
              
              <div className="flex gap-2">
                <Textarea
                  placeholder="Or enter custom procedure/service..."
                  value={customProcedure}
                  onChange={(e) => setCustomProcedure(e.target.value)}
                  className="text-sm h-20"
                />
                <Button
                  onClick={() => generatePriorAuth(customProcedure)}
                  disabled={loading || !customProcedure.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Generate'
                  )}
                </Button>
              </div>
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

            {/* Medical Necessity */}
            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-indigo-200">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Medical Necessity:
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {priorAuth.medical_necessity}
              </p>
            </div>

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
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={copyToClipboard}
                className="flex-1"
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={downloadAsDoc}
                className="flex-1"
              >
                <Download className="w-3 h-3 mr-1" />
                Download
              </Button>
              <Button
                size="sm"
                onClick={() => setPriorAuth(null)}
                className="flex-1"
              >
                New Request
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}