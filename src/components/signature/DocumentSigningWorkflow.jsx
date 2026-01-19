import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ESignatureCapture from "./ESignatureCapture";
import DocumentVersionHistory from "../documents/DocumentVersionHistory";
import DocumentList from "../documents/DocumentList";
import { FileText, Signature, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function DocumentSigningWorkflow({ patientId, onSigningComplete }) {
  const [currentStep, setCurrentStep] = useState("select");
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [signatureData, setSignatureData] = useState(null);

  const handleSelectDocument = (doc) => {
    setSelectedDocument(doc);
    setCurrentStep("review");
  };

  const handleSignatureCapture = (signature) => {
    setSignatureData(signature);
    setCurrentStep("confirm");
    toast.success("Signature captured");
  };

  const handleConfirmSignature = async () => {
    if (!selectedDocument || !signatureData) {
      toast.error("Missing document or signature");
      return;
    }

    try {
      // Create signature record linked to document
      const sig = await base44.entities.DigitalSignature.create({
        signer_name: signatureData.signer_name,
        signer_email: signatureData.signer_email,
        document_type: selectedDocument.category,
        document_id: selectedDocument.id,
        signature_data: signatureData.signature_data,
        ip_address: signatureData.ip_address,
        user_agent: navigator.userAgent,
        consent_text: selectedDocument.document_name,
        signature_method: "drawn",
        verification_status: "verified",
        mfa_verified: signatureData.mfa_verified || false,
        mfa_method: signatureData.mfa_method || "none",
        patient_id: patientId,
        signed_by_role: signatureData.role || "patient",
      });

      // Update document with signature reference
      await base44.entities.DocumentRecord.update(selectedDocument.id, {
        is_signed: true,
        signature_ids: [...(selectedDocument.signature_ids || []), sig.id],
        signature_status: "signed",
      });

      toast.success("Document signed successfully");
      if (onSigningComplete) {
        onSigningComplete(sig);
      }

      // Reset workflow
      setSelectedDocument(null);
      setSignatureData(null);
      setCurrentStep("select");
    } catch (error) {
      toast.error("Failed to save signature");
      console.error(error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Tabs value={currentStep} onValueChange={setCurrentStep}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="select">
            <FileText className="w-4 h-4 mr-2" />
            Select Document
          </TabsTrigger>
          <TabsTrigger value="review" disabled={!selectedDocument}>
            <ArrowRight className="w-4 h-4 mr-2" />
            Review
          </TabsTrigger>
          <TabsTrigger value="confirm" disabled={!signatureData}>
            <Signature className="w-4 h-4 mr-2" />
            Sign
          </TabsTrigger>
        </TabsList>

        <TabsContent value="select">
          <DocumentList
            patientId={patientId}
            onSelectForSignature={handleSelectDocument}
            showSignatureOption={true}
          />
        </TabsContent>

        <TabsContent value="review">
          {selectedDocument && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>{selectedDocument.document_name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Category:</span>{" "}
                      {selectedDocument.category}
                    </div>
                    <div>
                      <span className="font-medium">Version:</span> v
                      {selectedDocument.version_number}
                    </div>
                    <div>
                      <span className="font-medium">File Type:</span>{" "}
                      {selectedDocument.file_type}
                    </div>
                    <div>
                      <span className="font-medium">Status:</span>{" "}
                      {selectedDocument.signature_status}
                    </div>
                  </div>

                  {selectedDocument.description && (
                    <div>
                      <p className="font-medium text-sm mb-1">Description:</p>
                      <p className="text-sm text-gray-600">
                        {selectedDocument.description}
                      </p>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={() => window.open(selectedDocument.file_url, "_blank")}
                  >
                    View Full Document
                  </Button>

                  <Button
                    className="w-full"
                    onClick={() => setCurrentStep("confirm")}
                  >
                    Proceed to Sign
                  </Button>
                </CardContent>
              </Card>

              <DocumentVersionHistory document={selectedDocument} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="confirm">
          {selectedDocument && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Document Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm mb-2">
                    <span className="font-medium">Document:</span>{" "}
                    {selectedDocument.document_name}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Version:</span> v
                    {selectedDocument.version_number}
                  </p>
                </CardContent>
              </Card>

              <ESignatureCapture
                onSignatureCapture={handleSignatureCapture}
                patientId={patientId}
              />

              {signatureData && (
                <Card>
                  <CardHeader>
                    <CardTitle>Signature Preview</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <img
                      src={signatureData.signature_data}
                      alt="Signature preview"
                      className="w-full max-w-xs h-auto border rounded"
                    />
                    <Button
                      onClick={handleConfirmSignature}
                      className="w-full"
                    >
                      Confirm & Store Signature
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}