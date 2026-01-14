import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatEastern, todayEastern } from '@/components/utils/timezone';
import { motion } from 'framer-motion';
import { isValid } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Zap, Trophy, Stethoscope, Heart, Accessibility, MessageSquare, Activity } from 'lucide-react';
import NewFeaturesBanner from './NewFeaturesBanner';
import AnnouncementsWidget from './AnnouncementsWidget';
import TrialStatusBanner from '../subscription/TrialStatusBanner';

export default function DashboardHeader({ fullName, subscription, providerType, hideSecondaryBanners = false }) {
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  const getProviderIcon = () => {
    const icons = {
      'NP': Stethoscope,
      'MD': Stethoscope,
      'DO': Stethoscope,
      'PT': Accessibility,
      'OT': Accessibility,
      'ST': MessageSquare,
      'MSW': Heart,
      'Chiropractor': Activity,
      'RN': Heart,
      'LPN': Heart
    };
    return icons[providerType] || Heart;
  };

  const ProviderIcon = getProviderIcon();

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-3 mb-6">
      <Card className="bg-gradient-to-r from-slate-700 via-slate-800 to-slate-900 dark:from-slate-600 dark:via-slate-700 dark:to-slate-800 text-white border-none shadow-lg">
        <CardContent className="p-6 md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-2xl sm:text-2xl md:text-4xl font-bold mb-2">
                {getGreeting()}, {fullName}!
              </h1>
              <p className="text-white/80 text-xs sm:text-sm md:text-base">
                {isValid(new Date()) ? formatEastern(new Date(), 'EEEE, MMMM d, yyyy').replace(' ET', '') : new Date().toLocaleDateString()}
              </p>
            </div>
            {providerType && (
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <ProviderIcon className="w-5 h-5 text-white" />
                </div>
                <Badge className="bg-white text-blue-600 font-semibold">
                  {providerType}
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!hideSecondaryBanners && (
        <>
          {subscription && subscription.status === 'trialing' && (
            <TrialStatusBanner subscription={subscription} />
          )}
          <NewFeaturesBanner />
          <AnnouncementsWidget />
        </>
      )}
    </motion.div>
  );
}