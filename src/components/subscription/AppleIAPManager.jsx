import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Apple, Loader, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function AppleIAPManager() {
  const [trialActivated, setTrialActivated] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  const verifyReceiptMutation = useMutation({
    mutationFn: async (receipt) => {
      const response = await base44.functions.invoke('verifyAppleReceipt', {
        receiptData: receipt,
      });
      return response?.data;
    },
    onSuccess: (data) => {
      setTrialActivated(true);
      setReceiptData(data);
      toast.success('14-day free trial activated!');
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const handleStartAppleTrial = async () => {
    // In a real app, this would get the receipt from StoreKit
    // For demo purposes, showing the flow
    if (typeof window !== 'undefined' && window.ApplePaySession) {
      try {
        // This would be implemented with StoreKit 2 or RevenueCat
        toast.info('Apple in-app purchase not available in browser preview');
      } catch (error) {
        toast.error('Failed to initiate Apple purchase');
      }
    } else {
      toast.info('Apple in-app purchases require a native iOS app');
    }
  };

  if (trialActivated) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            14-Day Free Trial Active
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Status</span>
              <Badge className="bg-green-100 text-green-800">Active</Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Trial Ends</span>
              <span className="font-medium">
                {new Date(receiptData?.trial_ends).toLocaleDateString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Days Remaining</span>
              <span className="font-medium">
                {Math.ceil(
                  (new Date(receiptData?.trial_ends) - new Date()) /
                    (24 * 60 * 60 * 1000)
                )}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Apple className="w-5 h-5" />
          Start Free Trial
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-900">
            Get 14 days free access to all CareMetric AI features with your Apple ID.
          </p>
        </div>

        <Button
          onClick={handleStartAppleTrial}
          disabled={verifyReceiptMutation.isPending}
          className="w-full bg-black hover:bg-gray-900 text-white gap-2"
        >
          {verifyReceiptMutation.isPending && (
            <Loader className="w-4 h-4 animate-spin" />
          )}
          <Apple className="w-4 h-4" />
          {verifyReceiptMutation.isPending ? 'Processing...' : 'Start with Apple'}
        </Button>

        <p className="text-xs text-slate-500 text-center">
          After your 14-day trial, you'll be charged $29.99/month unless you cancel.
        </p>
      </CardContent>
    </Card>
  );
}