import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Gift, Users, DollarSign } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function ReferralCodeDisplay({ user }) {
  const [copied, setCopied] = useState(false);

  const { data: referrals = [] } = useQuery({
    queryKey: ['myReferrals', user?.email],
    queryFn: () => base44.entities.Referral.filter({ referrer_email: user.email }),
    enabled: !!user?.email
  });

  const handleCopy = () => {
    if (user?.referral_code) {
      navigator.clipboard.writeText(user.referral_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const paidReferrals = referrals.filter(r => r.status === 'converted_to_paid' || r.status === 'reward_issued');
  const pendingReferrals = referrals.filter(r => r.status === 'trial_started');
  const totalCredits = user?.total_referral_credits || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="w-5 h-5 text-purple-600" />
          Refer Friends & Earn Credits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-lg border border-purple-200">
          <p className="text-sm text-gray-700 mb-3">
            Share your referral code and earn <span className="font-bold text-purple-600">$5.00 credit</span> for each friend who subscribes!
          </p>
          
          <div className="flex gap-2">
            <Input
              value={user?.referral_code || 'Loading...'}
              readOnly
              className="font-mono text-lg font-bold text-center bg-white"
            />
            <Button
              onClick={handleCopy}
              variant="outline"
              className="flex-shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2 text-green-600" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-green-50 p-3 rounded-lg border border-green-200 text-center">
            <DollarSign className="w-5 h-5 text-green-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-green-700">${totalCredits}</p>
            <p className="text-xs text-gray-600">Total Credits</p>
          </div>
          
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center">
            <Users className="w-5 h-5 text-blue-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-blue-700">{paidReferrals.length}</p>
            <p className="text-xs text-gray-600">Paid Referrals</p>
          </div>
          
          <div className="bg-orange-50 p-3 rounded-lg border border-orange-200 text-center">
            <Users className="w-5 h-5 text-orange-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-orange-700">{pendingReferrals.length}</p>
            <p className="text-xs text-gray-600">In Trial</p>
          </div>
        </div>

        {referrals.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-700">Recent Referrals</p>
            {referrals.slice(0, 5).map((referral, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                <span className="text-gray-700">{referral.referred_user_email}</span>
                <Badge 
                  variant={referral.status === 'reward_issued' ? 'default' : 'secondary'}
                  className={referral.status === 'reward_issued' ? 'bg-green-600' : ''}
                >
                  {referral.status === 'reward_issued' ? '$5 Earned' : 
                   referral.status === 'converted_to_paid' ? 'Paid' : 'Trial'}
                </Badge>
              </div>
            ))}
          </div>
        )}

        <div className="text-xs text-gray-500 pt-2 border-t">
          <p>💡 Credits automatically apply to your next subscription renewal</p>
          <p className="mt-1">✅ $5 credit per friend who subscribes to a paid plan</p>
        </div>
      </CardContent>
    </Card>
  );
}