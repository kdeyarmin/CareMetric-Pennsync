import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Clock, CheckCircle2, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function TrialBanner({ subscription }) {
  const navigate = useNavigate();

  // Don't show if user has active subscription
  if (subscription && ['active', 'trialing'].includes(subscription.status)) {
    return null;
  }

  return (
    <Card className="border-2 border-blue-500 bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 shadow-lg">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center shadow-lg">
              <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-lg sm:text-xl font-bold text-gray-900">
                Start Your Free 14-Day Trial
              </h3>
              <Badge className="bg-green-600 text-white">
                No Credit Card Required
              </Badge>
            </div>
            
            <div className="space-y-2 mb-3">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                <span>Full access to all premium features</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                <span>AI-powered documentation & compliance</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Clock className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <span>Cancel anytime, no charges until trial ends</span>
              </div>
            </div>
          </div>

          <Button
            onClick={() => navigate(createPageUrl('SubscriptionPlans'))}
            className="w-full sm:w-auto h-11 sm:h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold shadow-lg"
          >
            Start Free Trial
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}