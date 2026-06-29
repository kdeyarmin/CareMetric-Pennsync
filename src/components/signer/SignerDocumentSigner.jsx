import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Download } from 'lucide-react';
import SignaturePadCanvas from '@/components/signature/SignaturePadCanvas';
import { submitSignerSignature } from '@/functions/submitSignerSignature';
import { toast } from 'sonner';

export default function SignerDocumentSigner({
  documentId,
  packageData,
  token,
  onComplete,
  onCancel,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [documentUrl, setDocumentUrl] = useState(null);
  const [signatureName, setSignatureName] = useState(packageData.signerName);
  const [signatureImage, setSignatureImage] = useState(null);

  const document = packageData.documents.find((d) => d.id === documentId);

  // The PDF URL comes from the token-validated package payload (validateSignerToken),
  // which is scoped to this signer's token — never from a direct, unauthenticated
  // entity read by arbitrary documentId on the public portal.
  const handleFetchDocument = () => {
    if (document?.pdf_url) {
      setDocumentUrl(document.pdf_url);
    } else {
      toast.error('Document is not available to view');
    }
  };

  const handleSignatureCapture = (dataUrl) => {
    setSignatureImage(dataUrl);
  };

  const handleSign = async () => {
    if (!signatureImage) {
      toast.error('Please provide a signature');
      return;
    }

    if (!signatureName.trim()) {
      toast.error('Please enter your name');
      return;
    }

    try {
      setIsLoading(true);

      // Convert data URL to blob
      const response = await fetch(signatureImage);
      const blob = await response.blob();

      // Upload signature
      const uploadResponse = await base44.integrations.Core.UploadFile({
        file: blob,
      });

      // Record the signature through the token-validating backend (the ONLY
      // authorized path). The previous direct entity write let anyone forge a
      // signature on any document; this binds the write to the signer's token and
      // stamps the server-derived signer identity.
      const signResponse = await submitSignerSignature({
        token,
        document_id: documentId,
        signature_image_url: uploadResponse.file_url,
        typed_name: signatureName,
      });
      // functions.invoke returns the full axios response (interceptResponses:false),
      // so the body is under .data; fall back to the object itself defensively.
      const result = signResponse?.data || signResponse;

      if (!result?.success) {
        toast.error(result?.error || 'Failed to save signature');
        return;
      }

      toast.success('Document signed successfully!');
      // Pass all_signed up: on the final signature the backend single-uses (deactivates)
      // the token, so the portal must show a completion screen from this response rather
      // than re-validating the now-inactive token (which would 403 → "Access Denied").
      setTimeout(() => onComplete(result.all_signed === true), 1500);
    } catch (error) {
      toast.error(error.message || 'Failed to save signature');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Back Button */}
      <Button
        variant="ghost"
        onClick={onCancel}
        className="gap-2"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Package
      </Button>

      {/* Document Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{document.name}</CardTitle>
        </CardHeader>
        <CardContent>
          {!documentUrl ? (
            <Button
              onClick={handleFetchDocument}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? 'Loading...' : 'View Document'}
            </Button>
          ) : (
            <div className="space-y-4">
              <iframe
                src={documentUrl}
                className="w-full h-96 border border-slate-300 rounded"
                title={document.name}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(documentUrl, '_blank')}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                Download
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Signature Capture */}
      {documentUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Signature</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Signature Pad */}
            <SignaturePadCanvas
              onSignatureCapture={handleSignatureCapture}
              disabled={isLoading}
            />

            {/* Name Input */}
            <div>
              <Label htmlFor="signature-name" className="text-sm">
                Printed Name
              </Label>
              <Input
                id="signature-name"
                type="text"
                value={signatureName}
                onChange={(e) => setSignatureName(e.target.value)}
                placeholder="Enter your full name"
                className="mt-2"
              />
            </div>

            {/* Agreement Checkbox */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-slate-700">
              By signing, I confirm that I have reviewed this document and agree to its contents. This signature is legally binding.
            </div>

            {/* Sign Button */}
            <Button
              onClick={handleSign}
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {isLoading ? 'Saving...' : 'Sign Document'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}