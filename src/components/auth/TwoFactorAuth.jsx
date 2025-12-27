import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { Shield, Loader2, ArrowRight, RefreshCw } from "lucide-react";

export default function TwoFactorAuth({ userEmail, phoneNumber, onVerified }) {
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutes in seconds

  useEffect(() => {
    // Send initial code
    sendCode();
  }, []);

  useEffect(() => {
    // Countdown timer
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  const sendCode = async () => {
    setIsSending(true);
    setError("");
    setSuccess("");

    try {
      const response = await base44.functions.invoke('sendVerificationCode', {
        user_email: userEmail,
        phone_number: phoneNumber
      });

      if (response.data.success) {
        setSuccess(`Verification code sent to ${phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}`);
        setTimeLeft(600); // Reset timer
        setAttemptsRemaining(5);
      } else {
        setError(response.data.error || 'Failed to send verification code');
      }
    } catch (err) {
      console.error('Send code error:', err);
      setError('Failed to send verification code. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const verifyCode = async () => {
    if (!code || code.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await base44.functions.invoke('verifyCode', {
        user_email: userEmail,
        code: code
      });

      if (response.data.success) {
        setSuccess('Verification successful!');
        setTimeout(() => {
          onVerified();
        }, 1000);
      } else {
        setError(response.data.error || 'Invalid verification code');
        if (response.data.attempts_remaining !== undefined) {
          setAttemptsRemaining(response.data.attempts_remaining);
        }
        setCode("");
      }
    } catch (err) {
      console.error('Verify code error:', err);
      setError('Failed to verify code. Please try again.');
      setCode("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      verifyCode();
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-md shadow-xl border-2 border-blue-200">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
          <div className="flex items-center justify-center gap-3">
            <Shield className="w-8 h-8" />
            <CardTitle className="text-2xl">Two-Factor Authentication</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          {success && (
            <Alert className="border-green-200 bg-green-50">
              <AlertDescription className="text-green-800">{success}</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertDescription className="text-red-800">{error}</AlertDescription>
            </Alert>
          )}

          <div className="text-center space-y-2">
            <p className="text-gray-600">
              Enter the 6-digit code sent to your phone
            </p>
            <p className="text-sm text-gray-500">
              {phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}
            </p>
            {timeLeft > 0 && (
              <p className="text-sm text-gray-500">
                Code expires in: <span className="font-semibold text-blue-600">{formatTime(timeLeft)}</span>
              </p>
            )}
            {attemptsRemaining < 5 && (
              <p className="text-sm text-orange-600">
                Attempts remaining: {attemptsRemaining}
              </p>
            )}
          </div>

          <div className="space-y-4">
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyPress={handleKeyPress}
              placeholder="Enter 6-digit code"
              className="text-center text-2xl tracking-widest h-14"
              disabled={isLoading || timeLeft <= 0}
              autoFocus
            />

            <Button
              onClick={verifyCode}
              disabled={isLoading || code.length !== 6 || timeLeft <= 0}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 h-12"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  Verify
                  <ArrowRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>

            <Button
              onClick={sendCode}
              disabled={isSending || timeLeft > 540}
              variant="outline"
              className="w-full"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Resend Code
                </>
              )}
            </Button>
          </div>

          <div className="text-center text-sm text-gray-500">
            <p>Having trouble? Contact support for assistance.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}