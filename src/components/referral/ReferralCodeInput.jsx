import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Gift, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function ReferralCodeInput({ user, onSuccess }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleApply = async () => {
    if (!code.trim()) {
      setMessage({ type: 'error', text: 'Please enter a referral code' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await base44.functions.invoke('processReferralCode', {
        referral_code: code.trim()
      });

      if (response.data.success) {
        setMessage({ 
          type: 'success', 
          text: `Referral code applied! Referred by ${response.data.referrer_name}` 
        });
        setCode("");
        if (onSuccess) onSuccess();
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message || 'Failed to apply referral code';
      setMessage({ type: 'error', text: errorMsg });
    } finally {
      setLoading(false);
    }
  };

  // Don't show if user already has a referrer
  if (user?.referred_by) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Gift className="w-5 h-5 text-purple-600" />
          Have a Referral Code?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600">
          Enter a friend's referral code to help them earn credits!
        </p>
        
        <div className="flex gap-2">
          <Input
            placeholder="Enter code..."
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            className="font-mono"
            disabled={loading}
          />
          <Button
            onClick={handleApply}
            disabled={loading || !code.trim()}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Applying...
              </>
            ) : (
              'Apply'
            )}
          </Button>
        </div>

        {message && (
          <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
            {message.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}