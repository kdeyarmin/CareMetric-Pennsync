import React from 'react';
import { Card } from '@/components/ui/card';

export default function StatCard({ icon: Icon, label, value, trend, color = 'blue' }) {
  const colorClasses = {
    blue: 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600',
    green: 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600',
    red: 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600',
    purple: 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600',
    amber: 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600',
  };

  return (
    <Card className={`border-2 ${colorClasses[color]} hover:shadow-md transition-shadow`}>
      <div className="p-3">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-xs text-slate-600 dark:text-slate-400">{label}</h3>
          {trend && (
            <span className={`text-xs font-semibold ${trend > 0 ? 'text-slate-400' : 'text-slate-500'}`}>
              {trend > 0 ? '+' : ''}{trend}%
            </span>
          )}
        </div>
        <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      </div>
    </Card>
  );
}