import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Clock, 
  Sparkles, 
  AlertCircle,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import { motion } from 'framer-motion';

export default function TrialStatusBanner() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: subscription } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: async () => {
      const response = await base44.functions.invoke('getMySubscription', {});
      return response?.data?.subscription || response?.subscription;
    },
    enabled: !!currentUser?.email
  });

  // Don't show banner for admins or active subscribers
  if (!subscription || 
      currentUser?.role === 'admin' || 
      subscription.status === 'active' || 
      subscription.status === 'lifetime_free') {
    return null;
  }

  // Calculate days remaining in trial
  let daysRemaining = 0;
  let isExpired = false;
  let isExpiringSoon = false;

  if (subscription.status === 'trialing' && subscription.trial_end) {
    const trialEnd = new Date(subscription.trial_end);
    const now = new Date();
    const msRemaining = trialEnd - now;
    daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
    
    if (daysRemaining <= 0) {
      isExpired = true;
    } else if (daysRemaining <= 3) {
      isExpiringSoon = true;
    }
  } else if (subscription.status === 'expired' || 
             subscription.status === 'canceled' || 
             subscription.status === 'past_due') {
    isExpired = true;
  }

  // Expired trial - critical banner
  if (isExpired) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <Card className="border-0 bg-gradient-to-r from-red-500 to-orange-500 shadow-2xl">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <AlertCircle className="w-8 h-8 text-white flex-shrink-0 mt-1" />
                <div className="text-white">
                  <h3 className="text-xl font-bold mb-1">Your Free Trial Has Ended</h3>
                  <p className="text-white/90 text-sm">
                    Subscribe now to continue using CareMetric AI's powerful features
                  </p>
                </div>
              </div>
              <Link to={createPageUrl('SubscriptionPlans')}>
                <Button size="lg" className="bg-white text-red-600 hover:bg-gray-100 shadow-lg font-bold">
                  Subscribe Now
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // Trial expiring soon - warning banner
  if (isExpiringSoon) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <Card className="border-0 bg-gradient-to-r from-orange-400 to-yellow-500 shadow-xl">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <Clock className="w-7 h-7 text-white flex-shrink-0 mt-1" />
                <div className="text-white">
                  <h3 className="text-lg font-bold mb-1">
                    {daysRemaining === 1 ? 'Last Day of Trial!' : `${daysRemaining} Days Left in Trial`}
                  </h3>
                  <p className="text-white/90 text-sm">
                    Subscribe today to keep access to all features
                  </p>
                </div>
              </div>
              <Link to={createPageUrl('SubscriptionPlans')}>
                <Button size="lg" className="bg-white text-orange-600 hover:bg-gray-100 shadow-lg font-semibold">
                  Choose a Plan
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // Active trial - info banner
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6"
    >
      <Card className="border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Sparkles className="w-6 h-6 text-blue-600" />
              <div>
                <p className="font-semibold text-slate-900">
                  Free Trial Active
                  <Badge className="ml-2 bg-blue-100 text-blue-800">
                    {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
                  </Badge>
                </p>
                <p className="text-sm text-slate-600">
                  Trial ends {new Date(subscription.trial_end).toLocaleDateString()}
                </p>
              </div>
            </div>
            <Link to={createPageUrl('SubscriptionPlans')}>
              <Button variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50">
                View Plans
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}