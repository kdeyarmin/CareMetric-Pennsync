import React, { useRef, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PenTool, Trash2, CheckCircle, AlertCircle, Shield } from "lucide-react";
import { toast } from "sonner";

export default function ESignatureCapture({
  documentType,
  documentId,
  consentText,
  onSignatureComplete,
  metadata = {}
}) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [agreedToConsent, setAgreedToConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
  }, []);

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');

    const x = e.clientX || e.touches?.[0]?.clientX;
    const y = e.clientY || e.touches?.[0]?.clientY;

    ctx.beginPath();
    ctx.moveTo(x - rect.left, y - rect.top);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');

    const x = e.clientX || e.touches?.[0]?.clientX;
    const y = e.clientY || e.touches?.[0]?.clientY;

    ctx.lineTo(x - rect.left, y - rect.top);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const submitSignature = async () => {
    if (!hasDrawn) {
      toast.error('Please sign before submitting');
      return;
    }

    if (!agreedToConsent) {
      toast.error('Please agree to the consent terms');
      return;
    }

    setSubmitting(true);
    try {
      const canvas = canvasRef.current;
      const signatureData = canvas.toDataURL('image/png');

      const response = await base44.functions.invoke('storeESignature', {
        document_type: documentType,
        document_id: documentId,
        signature_data: signatureData,
        consent_text: consentText,
        signature_method: 'drawn',
        metadata: {
          ...metadata,
          signer_name: currentUser?.full_name,
          device_type: /Mobile|Android|iPhone|iPad/.test(navigator.userAgent) ? 'mobile' : 'desktop'
        }
      });

      if (response.data?.success) {
        toast.success('Signature captured successfully');
        if (onSignatureComplete) {
          onSignatureComplete({
            signature_id: response.data.signature_id,
            timestamp: response.data.timestamp
          });
        }
      } else {
        throw new Error(response.data?.error || 'Failed to save signature');
      }
    } catch (error) {
      toast.error('Failed to submit signature');
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-600" />
          Electronic Signature
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Compliance Notice */}
        <Alert>
          <AlertCircle className="w-4 h-4" />
          <AlertDescription className="text-xs">
            By signing below, you agree that your electronic signature is legally binding and 
            equivalent to a handwritten signature under the ESIGN Act and UETA.
          </AlertDescription>
        </Alert>

        {/* Consent Text */}
        {consentText && (
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border">
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {consentText}
            </p>
          </div>
        )}

        {/* Signature Canvas */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Sign Below</label>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSignature}
              disabled={!hasDrawn}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Clear
            </Button>
          </div>
          <div className="relative border-2 border-dashed border-gray-300 rounded-lg bg-white">
            <canvas
              ref={canvasRef}
              className="w-full h-48 cursor-crosshair touch-none"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-gray-400">
                  <PenTool className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-sm">Sign here</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Consent Checkbox */}
        <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
          <Checkbox
            id="consent"
            checked={agreedToConsent}
            onCheckedChange={setAgreedToConsent}
            className="mt-0.5"
          />
          <label htmlFor="consent" className="text-sm cursor-pointer">
            I agree that this electronic signature is legally binding and represents my consent 
            to the terms described above. I understand this signature will be stored securely 
            with a complete audit trail for compliance purposes.
          </label>
        </div>

        {/* Signature Info */}
        {currentUser && (
          <div className="text-xs text-gray-500 space-y-1">
            <p>Signing as: <strong>{currentUser.full_name}</strong> ({currentUser.email})</p>
            <p>Date: <strong>{new Date().toLocaleString()}</strong></p>
            <p className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              HIPAA compliant • Encrypted storage • Complete audit trail
            </p>
          </div>
        )}

        {/* Submit Button */}
        <Button
          onClick={submitSignature}
          disabled={!hasDrawn || !agreedToConsent || submitting}
          className="w-full bg-blue-600 hover:bg-blue-700"
          size="lg"
        >
          {submitting ? (
            <>Processing...</>
          ) : (
            <>
              <CheckCircle className="w-4 h-4 mr-2" />
              Submit Signature
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}