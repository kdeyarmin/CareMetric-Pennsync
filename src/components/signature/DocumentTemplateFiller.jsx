import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import ESignatureCapture from "./ESignatureCapture";
import { FileText, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function DocumentTemplateFiller({
  patientId,
  onDocumentSigned,
  documentType = null,
}) {
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [placeholderValues, setPlaceholderValues] = useState({});
  const [currentStep, setCurrentStep] = useState("select");
  const [signatureData, setSignatureData] = useState(null);
  const [filledContent, setFilledContent] = useState("");

  const { data: templates = [] } = useQuery({
    queryKey: ["documentTemplates"],
    queryFn: () => base44.entities.DocumentSignatureTemplate.list("-created_date", 100),
  });

  const { data: patient } = useQuery({
    queryKey: ["patient", patientId],
    queryFn: () =>
      patientId ? base44.entities.Patient.list().then((p) =>
        p.find((pat) => pat.id === patientId)
      ) : null,
    enabled: !!patientId,
  });

  const filteredTemplates = useMemo(() => {
    return documentType
      ? templates.filter((t) => t.document_type === documentType)
      : templates;
  }, [templates, documentType]);

  const handleTemplateSelect = (template) => {
    setSelectedTemplate(template);
    // Pre-fill with patient data if available
    const initialValues = {};
    if (patient) {
      initialValues.patient_name = `${patient.first_name} ${patient.last_name}`;
      initialValues.patient_email = patient.email;
      initialValues.patient_phone = patient.phone;
      initialValues.patient_dob = patient.date_of_birth;
    }
    initialValues.date = new Date().toLocaleDateString();
    setPlaceholderValues(initialValues);
    setCurrentStep("fill");
  };

  const handlePlaceholderChange = (key, value) => {
    setPlaceholderValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const fillContent = () => {
    if (!selectedTemplate) return "";

    let filled = selectedTemplate.content;
    Object.entries(placeholderValues).forEach(([key, value]) => {
      filled = filled.replace(
        new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"),
        value || ""
      );
    });

    setFilledContent(filled);
    setCurrentStep("preview");
  };

  const handleSignatureComplete = (signature) => {
    setSignatureData(signature);
    setCurrentStep("confirm");
    toast.success("Signature captured successfully");
  };

  const handleDocumentSigned = async () => {
    if (!selectedTemplate || !signatureData) {
      toast.error("Missing required information");
      return;
    }

    try {
      const result = await base44.entities.DigitalSignature.create({
        signer_name: signatureData.signer_name,
        signer_email: signatureData.signer_email,
        document_type: selectedTemplate.document_type,
        document_id: `template_${selectedTemplate.id}`,
        signature_data: signatureData.signature_data,
        ip_address: signatureData.ip_address,
        user_agent: navigator.userAgent,
        consent_text: filledContent,
        signature_method: "drawn",
        verification_status: "verified",
        mfa_verified: signatureData.mfa_verified || false,
        mfa_method: signatureData.mfa_method || "none",
        patient_id: patientId,
        signed_by_role: signatureData.role || "patient",
      });

      toast.success("Document signed and stored successfully");
      if (onDocumentSigned) {
        onDocumentSigned(result);
      }

      // Reset form
      setSelectedTemplate(null);
      setPlaceholderValues({});
      setSignatureData(null);
      setFilledContent("");
      setCurrentStep("select");
    } catch (error) {
      toast.error("Failed to sign document");
      console.error(error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {currentStep === "select" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Select a Document Template
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredTemplates.length === 0 ? (
              <p className="text-gray-500">
                No templates available. Create one first.
              </p>
            ) : (
              <div className="grid gap-3">
                {filteredTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => handleTemplateSelect(template)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold">
                          {template.template_name}
                        </h3>
                        {template.description && (
                          <p className="text-sm text-gray-600 mt-1">
                            {template.description}
                          </p>
                        )}
                      </div>
                      <ArrowRight className="w-5 h-5 text-blue-600" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {currentStep === "fill" && selectedTemplate && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedTemplate.template_name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-blue-50 p-3 rounded text-sm text-blue-900">
              Fill in the required information below. Fields marked with * are
              required.
            </div>

            {selectedTemplate.placeholders?.map((placeholder) => (
              <div key={placeholder.key}>
                <label className="block text-sm font-medium mb-1">
                  {placeholder.label}
                  {placeholder.required && <span className="text-red-500">*</span>}
                </label>
                {placeholder.type === "select" ? (
                  <Select
                    value={placeholderValues[placeholder.key] || ""}
                    onValueChange={(value) =>
                      handlePlaceholderChange(placeholder.key, value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {placeholder.options?.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={placeholder.type}
                    placeholder={placeholder.label}
                    value={placeholderValues[placeholder.key] || ""}
                    onChange={(e) =>
                      handlePlaceholderChange(placeholder.key, e.target.value)
                    }
                  />
                )}
              </div>
            ))}

            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setCurrentStep("select");
                  setSelectedTemplate(null);
                }}
              >
                Back
              </Button>
              <Button onClick={fillContent} className="ml-auto">
                Preview & Sign
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "preview" && filledContent && (
        <Card>
          <CardHeader>
            <CardTitle>Review Document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-gray-50 p-4 rounded border max-h-96 overflow-y-auto">
              <div
                className="prose prose-sm max-w-none whitespace-pre-wrap text-sm"
                dangerouslySetInnerHTML={{ __html: filledContent }}
              />
            </div>

            <ESignatureCapture
              onSignatureCapture={handleSignatureComplete}
              patientId={patientId}
            />

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentStep("fill")}
              >
                Back to Edit
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "confirm" && signatureData && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm Signature</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-green-50 p-3 rounded text-sm text-green-900">
              Your signature has been captured. Click below to finalize and store
              this signed document.
            </div>

            <div className="border rounded p-4">
              <img
                src={signatureData.signature_data}
                alt="Signature"
                className="w-full max-w-xs h-auto border"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCurrentStep("preview");
                  setSignatureData(null);
                }}
              >
                Recapture Signature
              </Button>
              <Button
                onClick={handleDocumentSigned}
                className="ml-auto"
              >
                Finalize & Store
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}