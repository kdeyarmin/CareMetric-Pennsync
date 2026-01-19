import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Phone, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function TwilioTwoFactorAuth({ 
  phoneNumber, 
  onVerificationComplete, 
  purpose = "authentication",
  title = "Verify Your Phone Number",
  description = "We'll send you a verification code to ensure account security"
}) {
  // TEMPORARY: 2FA is suspended - bypass verification
  const TWO_FACTOR_SUSPENDED = true;

  useEffect(() => {
    if (TWO_FACTOR_SUSPENDED && onVerificationComplete) {
      onVerificationComplete(true);
    }
  }, [onVerificationComplete]);

  if (TWO_FACTOR_SUSPENDED) {
    return null;
  }

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const sendCode = async () => {
    if (!phoneNumber) {
      setError("Phone number is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data } = await base44.functions.invoke('sendTwilioVerificationCode', {
        phone_number: phoneNumber,
        purpose
      });

      if (data.success) {
        setCodeSent(true);
        setCountdown(60);
        toast.success("Verification code sent to your phone");
      } else {
        setError(data.error || "Failed to send code");
        toast.error(data.error || "Failed to send code");
      }
    } catch (err) {
      console.error('Send code error:', err);
      setError("Failed to send verification code");
      toast.error("Failed to send verification code");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!code || code.length !== 6) {
      setError("Please enter a valid 6-digit code");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data } = await base44.functions.invoke('verifyTwilioCode', {
        phone_number: phoneNumber,
        code: code.trim()
      });

      if (data.success) {
        toast.success("Phone verified successfully!");
        if (onVerificationComplete) {
          onVerificationComplete(true);
        }
      } else {
        setError(data.error || "Invalid verification code");
        toast.error(data.error || "Invalid verification code");
      }
    } catch (err) {
      console.error('Verify code error:', err);
      setError("Failed to verify code");
      toast.error("Failed to verify code");
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
    setError("");
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && code.length === 6) {
      verifyCode();
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto border-2 border-blue-200">
      <CardHeader className="text-center">
        <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
          <Shield className="w-6 h-6 text-blue-600" />
        </div>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Phone Number Display */}
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
          <Phone className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">{phoneNumber}</span>
        </div>

        {!codeSent ? (
          /* Send Code Button */
          <Button
            onClick={sendCode}
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending Code...
              </>
            ) : (
              <>
                <Phone className="w-4 h-4 mr-2" />
                Send Verification Code
              </>
            )}
          </Button>
        ) : (
          /* Code Input and Verify */
          <div className="space-y-4">
            <div>
              <Label htmlFor="code">Enter 6-Digit Code</Label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={code}
                onChange={handleCodeChange}
                onKeyPress={handleKeyPress}
                maxLength={6}
                className="text-center text-2xl tracking-widest font-mono"
                autoFocus
              />
            </div>

            <Button
              onClick={verifyCode}
              disabled={loading || code.length !== 6}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Verify Code
                </>
              )}
            </Button>

            {/* Resend Code */}
            <div className="text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={sendCode}
                disabled={countdown > 0 || loading}
                className="text-xs"
              >
                {countdown > 0 ? (
                  `Resend code in ${countdown}s`
                ) : (
                  "Resend Code"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Help Text */}
        {codeSent && (
          <Alert>
            <AlertDescription className="text-xs text-gray-600">
              Code expires in 10 minutes. Check your phone for the SMS message.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}