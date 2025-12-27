import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Shield, Send, CheckCircle, Loader2 } from "lucide-react";

export default function Test2FA() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const handleSendCode = async () => {
    if (!phoneNumber) {
      setSendResult({ success: false, message: "Please enter a phone number" });
      return;
    }

    setIsSending(true);
    setSendResult(null);
    setVerifyResult(null);

    try {
      const response = await base44.functions.invoke('sendVerificationCode', {
        user_email: currentUser?.email,
        phone_number: phoneNumber
      });

      setSendResult({
        success: response.data.success,
        message: response.data.success 
          ? `Code sent to ${phoneNumber}` 
          : response.data.error || 'Failed to send code'
      });
    } catch (error) {
      console.error('Send error:', error);
      setSendResult({
        success: false,
        message: error.response?.data?.details || error.response?.data?.error || error.message || 'Failed to send verification code'
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code) {
      setVerifyResult({ success: false, message: "Please enter the code" });
      return;
    }

    setIsVerifying(true);
    setVerifyResult(null);

    try {
      const response = await base44.functions.invoke('verifyCode', {
        user_email: currentUser?.email,
        code: code
      });

      setVerifyResult({
        success: response.data.success,
        message: response.data.success 
          ? 'Verification successful!' 
          : response.data.error || 'Invalid code',
        attemptsRemaining: response.data.attempts_remaining
      });
    } catch (error) {
      console.error('Verify error:', error);
      setVerifyResult({
        success: false,
        message: error.message || 'Failed to verify code'
      });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <Card className="border-2 border-blue-200">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-6 h-6" />
            Test Two-Factor Authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800">
              <strong>Testing Mode:</strong> Use this page to test the 2FA SMS functionality before enabling it on your account.
            </p>
            <p className="text-sm text-yellow-800 mt-2">
              Current user: <strong>{currentUser?.email}</strong>
            </p>
          </div>

          {/* Step 1: Send Code */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1234567890"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">Include country code (e.g., +1 for US)</p>
            </div>

            <Button
              onClick={handleSendCode}
              disabled={isSending || !phoneNumber}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Verification Code
                </>
              )}
            </Button>

            {sendResult && (
              <Alert className={sendResult.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
                <AlertDescription className={sendResult.success ? "text-green-800" : "text-red-800"}>
                  {sendResult.message}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="border-t pt-6" />

          {/* Step 2: Verify Code */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="code">Verification Code</Label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter 6-digit code"
                className="mt-1 text-center text-2xl tracking-widest"
              />
            </div>

            <Button
              onClick={handleVerifyCode}
              disabled={isVerifying || !code || code.length !== 6}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Verify Code
                </>
              )}
            </Button>

            {verifyResult && (
              <Alert className={verifyResult.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
                <AlertDescription className={verifyResult.success ? "text-green-800" : "text-red-800"}>
                  {verifyResult.message}
                  {verifyResult.attemptsRemaining !== undefined && (
                    <span className="block mt-1">Attempts remaining: {verifyResult.attemptsRemaining}</span>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Test Results Summary */}
          {sendResult && verifyResult && (
            <div className="border-t pt-6">
              <h3 className="font-semibold text-gray-900 mb-3">Test Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${sendResult.success ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span>SMS Sending: {sendResult.success ? 'Success' : 'Failed'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${verifyResult.success ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span>Code Verification: {verifyResult.success ? 'Success' : 'Failed'}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}