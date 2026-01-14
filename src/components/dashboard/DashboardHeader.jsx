import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatEastern, todayEastern } from '@/components/utils/timezone';
import { motion } from 'framer-motion';
import { isValid } from 'date-fns';

export default function DashboardHeader({ fullName }) {
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <Card className="mb-6 bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 text-white border-none shadow-xl">
        <CardContent className="p-6 md:p-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            {getGreeting()}, {fullName}! 👋
          </h1>
          <p className="text-white/80 text-sm md:text-base">
            {isValid(new Date()) ? formatEastern(new Date(), 'EEEE, MMMM d, yyyy').replace(' ET', '') : new Date().toLocaleDateString()}
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}