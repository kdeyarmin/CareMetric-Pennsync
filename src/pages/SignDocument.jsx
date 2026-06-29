import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, FileText, Pen, User } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import SignatureCanvas from "../components/documents/SignatureCanvas";
import { sanitizeHtml } from "@/components/utils/security";

export default function SignDocument() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const signatureId = urlParams.get('signature_id');
  const patientId = urlParams.get('patient_id');

  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [currentSignerIndex, setCurrentSignerIndex] = useState(0);
  const [signatures, setSignatures] = useState({});

  const { data: _currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: signatureRecord } = useQuery({
    queryKey: ['signature-record', signatureId],
    queryFn: () => base44.entities.DocumentSignature.filter({ id: signatureId }),
    select: (data) => data[0],
    enabled: !!signatureId
  });

  const effectivePatientId = patientId || signatureRecord?.patient_id || "";

  const { data: patient } = useQuery({
    queryKey: ['patient', effectivePatientId],
    queryFn: () => base44.entities.Patient.filter({ id: effectivePatientId }),
    select: (data) => data[0],
    enabled: !!effectivePatientId
  });

  const updateSignatureMutation = useMutation({
    // Route completion through the server: it authorizes the caller against the
    // document (admin / owner / assigned nurse), records who collected the
    // signatures, and stamps tamper-evidence. The page used to do a client-side
    // DocumentSignature.update keyed only on the URL id, so any authenticated user
    // with an id could blanket-complete a document they had no relationship to.
    mutationFn: async ({ signatures }) => {
      return await base44.functions.invoke('submitDocumentSignatures', {
        signature_id: signatureId,
        signatures,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signature-record'] });
      queryClient.invalidateQueries({ queryKey: ['all-signatures'] });
    }
  });

  const handleOpenSignature = (signerIndex) => {
    setCurrentSignerIndex(signerIndex);
    setShowSignatureDialog(true);
  };

  const handleSaveSignature = (dataUrl, method) => {
    const signer = signatureRecord?.signers[currentSignerIndex];
    if (!signer) return;

    setSignatures(prev => ({
      ...prev,
      [signer.id]: { dataUrl, method, timestamp: new Date().toISOString() }
    }));

    setShowSignatureDialog(false);
    toast.success("Signature saved!");
  };

  const handleSubmitAll = async () => {
    if (!signatureRecord) return;

    // Client-side completeness check for fast feedback; the server re-validates.
    const allRequiredSigned = signatureRecord.signers
      .filter(s => s.required)
      .every(s => signatures[s.id]?.dataUrl || s.signature);

    if (!allRequiredSigned) {
      toast.error("Please complete all required signatures");
      return;
    }

    // Send only the per-signer signature fields just captured; the server applies
    // them onto the canonical signer rows and stamps integrity.
    const submitted = Object.entries(signatures).map(([signerId, sig]) => ({
      signer_id: signerId,
      signature: sig.dataUrl,
      signature_method: sig.method,
      signed_date: sig.timestamp,
    }));

    try {
      await updateSignatureMutation.mutateAsync({ signatures: submitted });

      toast.success("Document signed successfully!");
      
      setTimeout(() => {
        navigate(createPageUrl("DocumentSignatures"));
      }, 1500);
    } catch {
      toast.error("Failed to save signatures");
    }
  };

  // Guard on `signers` too: the render and submit handlers call
  // signatureRecord.signers.map/.filter/.every, which throw if the entity has no
  // signers array. Treat a record without signers as not-yet-ready.
  if (!signatureRecord || (effectivePatientId && !patient) || !Array.isArray(signatureRecord.signers)) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600">Loading document...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getSignerStatus = (signer) => {
    if (signatures[signer.id]) {
      return { label: "Signed", color: "bg-emerald-600" };
    }
    if (signer.signed_date) {
      return { label: "Previously Signed", color: "bg-emerald-600" };
    }
    return { label: "Pending", color: "bg-amber-600" };
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Pen}
        eyebrow="Documentation"
        title="Sign Document"
        description={`${patient ? `${patient.first_name} ${patient.last_name}` : 'Document'} • ${signatureRecord.document_title}`}
        favoritePage="SignDocument"
      />

      {/* Document Preview */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Document Preview</CardTitle>
        </CardHeader>
        <CardContent>
          {signatureRecord.document_url ? (
            <div className="border rounded-lg overflow-hidden">
              <iframe
                src={signatureRecord.document_url}
                className="w-full h-96"
                title="Document Preview"
              />
            </div>
          ) : signatureRecord.document_content ? (
            <div className="p-4 border rounded-lg bg-slate-50 max-h-96 overflow-auto">
<div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(signatureRecord.document_content) }} />
            </div>
          ) : (
            <Alert>
              <AlertDescription>Document content not available</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Signatures Required */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Required Signatures</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {signatureRecord.signers.map((signer, index) => {
              const status = getSignerStatus(signer);
              
              return (
                <div
                  key={signer.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-slate-600" />
                    <div>
                      <p className="font-medium">{signer.name}</p>
                      <p className="text-sm text-slate-600">
                        {signer.role} {signer.required && <span className="text-red-600">*</span>}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Badge className={status.color}>{status.label}</Badge>
                    
                    {!signer.signed_date && (
                      <Button
                        size="sm"
                        onClick={() => handleOpenSignature(index)}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Pen className="w-4 h-4 mr-2" />
                        Sign
                      </Button>
                    )}
                    
                    {signatures[signer.id] && (
                      <div className="border rounded-lg p-1 bg-white">
                        <img 
                          src={signatures[signer.id].dataUrl} 
                          alt="Signature"
                          className="h-8 w-24 object-contain"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex gap-3 justify-end">
        <Button
          variant="outline"
          onClick={() => navigate(createPageUrl("DocumentSignatures"))}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmitAll}
          disabled={updateSignatureMutation.isPending}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <CheckCircle2 className="w-4 h-4 mr-2" />
          {updateSignatureMutation.isPending ? "Submitting..." : "Submit All Signatures"}
        </Button>
      </div>

      {/* Signature Dialog */}
      {showSignatureDialog && (
        <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {signatureRecord.signers[currentSignerIndex]?.name} - Please Sign
              </DialogTitle>
            </DialogHeader>
            <SignatureCanvas
              onSave={handleSaveSignature}
              onCancel={() => setShowSignatureDialog(false)}
              signerName={signatureRecord.signers[currentSignerIndex]?.name}
              isInitials={false}
            />
          </DialogContent>
        </Dialog>
      )}
    </PageContainer>
  );
}