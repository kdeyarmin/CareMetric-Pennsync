import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatEastern, todayEastern } from '@/components/utils/timezone';
import { motion } from 'framer-motion';
import { isValid } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Zap, Trophy } from 'lucide-react';
import NewFeaturesBanner from './NewFeaturesBanner';
import AnnouncementsWidget from './AnnouncementsWidget';
import TrialStatusBanner from '../subscription/TrialStatusBanner';

export default function DashboardHeader({ fullName, subscription, hideSecondaryBanners = false }) {
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-3 mb-6">
      <Card className="bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 text-white border-none shadow-xl">
        <CardContent className="p-6 md:p-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            {getGreeting()}, {fullName}! 👋
          </h1>
          <p className="text-white/80 text-sm md:text-base">
            {isValid(new Date()) ? formatEastern(new Date(), 'EEEE, MMMM d, yyyy').replace(' ET', '') : new Date().toLocaleDateString()}
          </p>
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