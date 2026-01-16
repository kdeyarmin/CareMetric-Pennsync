import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function BillingFormPopulator({ prefillData, allCodes, patientContext }) {
  const [copied, setCopied] = useState(false);

  const copyFormData = () => {
    const formContent = generateFormContent();
    navigator.clipboard.writeText(formContent);
    setCopied(true);
    toast.success("Form data copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFormData = () => {
    const formContent = generateFormContent();
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(formContent));
    element.setAttribute("download", `billing_form_${Date.now()}.txt`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success("Form data downloaded");
  };

  const generateFormContent = () => {
    const lines = [
      "=== MEDICAL BILLING FORM AUTO-POPULATOR ===",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      "--- PATIENT INFORMATION ---",
      patientContext?.patient_name ? `Patient Name: ${patientContext.patient_name}` : "",
      patientContext?.date_of_birth ? `DOB: ${patientContext.date_of_birth}` : "",
      patientContext?.payor ? `Primary Payer: ${patientContext.payor}` : "",
      "",
      "--- DIAGNOSTIC CODES (ICD-10) ---",
      `Primary Diagnosis: ${prefillData?.primary_icd10 || ""}`,
      ...(prefillData?.secondary_icd10s?.length > 0
        ? [`Secondary Diagnoses:`, ...prefillData.secondary_icd10s.map((code, i) => `  ${i + 1}. ${code}`)]
        : []),
      "",
      "--- PROCEDURE CODES (CPT) ---",
      `Primary CPT Code: ${prefillData?.primary_cpt || ""}`,
      ...(prefillData?.cpt_modifiers?.length > 0
        ? [`CPT Modifiers:`, ...prefillData.cpt_modifiers.map((mod) => `  - ${mod}`)]
        : []),
      "",
      "--- SUPPLY/DEVICE CODES (HCPCS) ---",
      ...(prefillData?.hcpcs?.length > 0
        ? [`HCPCS Codes:`, ...prefillData.hcpcs.map((code, i) => `  ${i + 1}. ${code}`)]
        : ["No HCPCS codes required"]),
      ...(prefillData?.hcpcs_modifiers?.length > 0
        ? [`HCPCS Modifiers:`, ...prefillData.hcpcs_modifiers.map((mod) => `  - ${mod}`)]
        : []),
      "",
      "=== END OF AUTO-POPULATED DATA ===",
      ""
    ];

    return lines.filter((line) => line !== undefined).join("\n");
  };

  if (!prefillData) return null;

  return (
    <Card className="border-emerald-200 bg-emerald-50 mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-700" />
            <CardTitle className="text-emerald-900">Billing Form Auto-Populator</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={copyFormData}
              className="border-emerald-300 hover:bg-emerald-100"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-1 text-green-600" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-1" />
                  Copy Data
                </>
              )}
            </Button>
            <Button
              size="sm"
              onClick={downloadFormData}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Download className="w-4 h-4 mr-1" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Patient Info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-emerald-900 block mb-1">
              Patient Name
            </label>
            <Input
              readOnly
              value={patientContext?.patient_name || ""}
              className="text-xs"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-emerald-900 block mb-1">
              Primary Payer
            </label>
            <Input
              readOnly
              value={patientContext?.payor || ""}
              className="text-xs"
            />
          </div>
        </div>

        {/* Primary Diagnosis */}
        <div>
          <label className="text-xs font-semibold text-emerald-900 block mb-1">
            Primary ICD-10 Code
          </label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={prefillData.primary_icd10 || ""}
              className="font-mono font-bold text-emerald-700 text-sm"
            />
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(prefillData.primary_icd10);
                toast.success("Code copied");
              }}
              className="h-9"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Secondary Diagnoses */}
        {prefillData.secondary_icd10s?.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-emerald-900 block mb-1">
              Secondary ICD-10 Codes
            </label>
            <div className="space-y-1">
              {prefillData.secondary_icd10s.map((code, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input readOnly value={code} className="font-mono text-sm" />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(code);
                      toast.success("Code copied");
                    }}
                    className="h-9"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Primary CPT */}
        <div>
          <label className="text-xs font-semibold text-emerald-900 block mb-1">
            Primary CPT Code
          </label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={prefillData.primary_cpt || ""}
              className="font-mono font-bold text-green-700 text-sm"
            />
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(prefillData.primary_cpt);
                toast.success("Code copied");
              }}
              className="h-9"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* CPT Modifiers */}
        {prefillData.cpt_modifiers?.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-emerald-900 block mb-1">
              CPT Modifiers
            </label>
            <div className="flex flex-wrap gap-1">
              {prefillData.cpt_modifiers.map((mod, idx) => (
                <Badge key={idx} className="bg-green-100 text-green-800 cursor-pointer"
                  onClick={() => {
                    navigator.clipboard.writeText(mod);
                    toast.success("Modifier copied");
                  }}
                  title="Click to copy"
                >
                  {mod}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* HCPCS Codes */}
        {prefillData.hcpcs?.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-emerald-900 block mb-1">
              HCPCS Codes (Supplies/Devices)
            </label>
            <div className="space-y-1">
              {prefillData.hcpcs.map((code, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input readOnly value={code} className="font-mono text-sm" />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(code);
                      toast.success("Code copied");
                    }}
                    className="h-9"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* HCPCS Modifiers */}
        {prefillData.hcpcs_modifiers?.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-emerald-900 block mb-1">
              HCPCS Modifiers
            </label>
            <div className="flex flex-wrap gap-1">
              {prefillData.hcpcs_modifiers.map((mod, idx) => (
                <Badge key={idx} className="bg-purple-100 text-purple-800 cursor-pointer"
                  onClick={() => {
                    navigator.clipboard.writeText(mod);
                    toast.success("Modifier copied");
                  }}
                  title="Click to copy"
                >
                  {mod}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Summary Notes */}
        <div className="bg-white p-3 rounded border border-emerald-200">
          <p className="text-xs text-gray-600">
            <strong>💡 Tip:</strong> Click any code or use the "Copy Data" button to quickly populate your billing form. All required information is pre-filled above.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}