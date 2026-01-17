import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import confetti from 'canvas-confetti';

export const publicPage = true;

export default function PaymentSuccess() {
  const queryClient = useQueryClient();

  // Invalidate subscription cache to refresh status
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['userSubscription'] });
    
    // Celebration confetti
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });

    // Log success event
    base44.analytics.track({
      eventName: 'subscription_completed',
      properties: { success: true }
    });
  }, [queryClient]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-6">
      <div className="bg-white rounded-2xl shadow-xl p-12 max-w-lg text-center">
        <div className="relative mb-6">
          <CheckCircle2 className="w-24 h-24 text-green-500 mx-auto" />
          <Sparkles className="w-8 h-8 text-yellow-500 absolute top-0 right-1/4 animate-pulse" />
        </div>
        
        <h1 className="text-4xl font-bold text-gray-800 mb-4">Welcome to Premium!</h1>
        
        <p className="text-gray-600 mb-8">
          Thank you for subscribing to CareMetric AI. Your account has been upgraded, and you now have access to all premium features.
        </p>

        <div className="bg-blue-50 rounded-lg p-4 mb-8">
          <p className="text-sm text-blue-800">
            Your subscription is now active. Start exploring advanced AI features, unlimited documentation, and priority support.
          </p>
        </div>

        <Link to={createPageUrl('Dashboard')}>
          <Button size="lg" className="w-full">Go to Dashboard</Button>
        </Link>
      </div>
    </div>
  );
}