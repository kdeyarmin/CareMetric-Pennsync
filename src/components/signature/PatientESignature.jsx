import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Phone, Lock, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import ESignatureCapture from "./ESignatureCapture";

export default function PatientESignature({
  documentType,
  documentId,
  consentText,
  patientId,
  requireMFA = true,
  onSignatureComplete
}) {
  const [step, setStep] = useState(requireMFA ? 'mfa' : 'signature');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(user => {
      setCurrentUser(user);
      setPhoneNumber(user.phone_number || '');
    }).catch(() => {});
  }, []);

  const sendVerificationCode = async () => {
    if (!phoneNumber || phoneNumber.length < 10) {
      toast.error('Please enter a valid phone number');
      return;
    }

    setSending(true);
    try {
      await base44.functions.invoke('sendTwilioVerificationCode', {
        phone_number: phoneNumber,
        purpose: 'authentication'
      });
      
      setCodeSent(true);
      toast.success('Verification code sent to your phone');
    } catch (error) {
      toast.error('Failed to send verification code');
      console.error(error);
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      toast.error('Please enter the 6-digit code');
      return;
    }

    setVerifying(true);
    try {
      const response = await base44.functions.invoke('verifyMFAForSignature', {
        verification_code: verificationCode,
        phone_number: phoneNumber
      });

      if (response.data?.success) {
        setMfaVerified(true);
        setStep('signature');
        toast.success('Identity verified successfully');
      } else {
        toast.error(response.data?.error || 'Invalid code');
      }
    } catch (error) {
      toast.error('Verification failed');
      console.error(error);
    } finally {
      setVerifying(false);
    }
  };

  const handleSignatureComplete = (signatureData) => {
    if (onSignatureComplete) {
      onSignatureComplete({
        ...signatureData,
        mfa_verified: mfaVerified,
        signed_by_role: 'patient'
      });
    }
  };

  if (step === 'mfa') {
    return (
      <Card className="border-2 border-purple-200">
        <CardHeader className="bg-gradient-to-r from-purple-50 to-indigo-50">
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-purple-600" />
            Secure Identity Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Alert>
            <Shield className="w-4 h-4" />
            <AlertDescription className="text-xs">
              For your security, we need to verify your identity before you can sign. 
              We'll send a code to your phone number.
            </AlertDescription>
          </Alert>

          {!codeSent ? (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-2 block">Phone Number</label>
                <Input
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>
              <Button
                onClick={sendVerificationCode}
                disabled={sending || !phoneNumber}
                className="w-full"
              >
                {sending ? 'Sending...' : (
                  <>
                    <Phone className="w-4 h-4 mr-2" />
                    Send Verification Code
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Alert className="bg-blue-50">
                <AlertDescription className="text-sm">
                  Code sent to {phoneNumber}. Enter it below to verify your identity.
                </AlertDescription>
              </Alert>
              <div>
                <label className="text-sm font-medium mb-2 block">Verification Code</label>
                <Input
                  type="text"
                  maxLength={6}
                  placeholder="123456"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-2xl tracking-widest"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCodeSent(false)}
                  className="flex-1"
                >
                  Change Number
                </Button>
                <Button
                  onClick={verifyCode}
                  disabled={verifying || verificationCode.length !== 6}
                  className="flex-1"
                >
                  {verifying ? 'Verifying...' : 'Verify Code'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {mfaVerified && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-sm text-green-800">
            Identity verified successfully. You may now sign the document.
          </AlertDescription>
        </Alert>
      )}

      <ESignatureCapture
        documentType={documentType}
        documentId={documentId}
        consentText={consentText}
        onSignatureComplete={handleSignatureComplete}
        metadata={{
          patient_id: patientId,
          mfa_verified: mfaVerified,
          signed_by_role: 'patient'
        }}
      />
    </div>
  );
}