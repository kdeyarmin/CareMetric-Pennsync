import React from 'react';
import StatCard from '@/components/ui/StatCard';
import { Users, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

export default function QuickStatsSummary({ stats = {} }) {
  const { activePatients = 0, completedVisits = 0, pendingAlerts = 0, upcomingVisits = 0 } = stats;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
      <StatCard
        icon={Users}
        label="Active Patients"
        value={activePatients}
        color="blue"
        trend={5}
      />
      <StatCard
        icon={CheckCircle2}
        label="Visits (30d)"
        value={completedVisits}
        color="green"
        trend={12}
      />
      <StatCard
        icon={AlertCircle}
        label="Pending Alerts"
        value={pendingAlerts}
        color="red"
      />
      <StatCard
        icon={Clock}
        label="Upcoming Visits"
        value={upcomingVisits}
        color="purple"
      />
    </div>
  );
}