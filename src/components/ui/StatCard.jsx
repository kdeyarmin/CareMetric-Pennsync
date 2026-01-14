import React from 'react';
import { Card } from '@/components/ui/card';

export default function StatCard({ icon: Icon, label, value, trend, color = 'blue' }) {
  const colorClasses = {
    blue: 'bg-slate-800 text-slate-200 border-slate-700 dark:bg-slate-700 dark:border-slate-600',
    green: 'bg-slate-800 text-slate-200 border-slate-700 dark:bg-slate-700 dark:border-slate-600',
    red: 'bg-slate-800 text-slate-200 border-slate-700 dark:bg-slate-700 dark:border-slate-600',
    purple: 'bg-slate-800 text-slate-200 border-slate-700 dark:bg-slate-700 dark:border-slate-600',
    amber: 'bg-slate-800 text-slate-200 border-slate-700 dark:bg-slate-700 dark:border-slate-600',
  };

  return (
    <Card className={`border-2 ${colorClasses[color]} hover:shadow-md transition-shadow`}>
      <div className="p-4 sm:p-6">
        <div className="flex items-start justify-between mb-3">
          <div className="p-2 rounded-lg bg-slate-700 dark:bg-slate-600">
            {Icon && <Icon className="w-5 h-5 text-slate-300" />}
          </div>
          {trend && (
            <span className={`text-xs font-semibold ${trend > 0 ? 'text-slate-400' : 'text-slate-500'}`}>
              {trend > 0 ? '+' : ''}{trend}%
            </span>
          )}
        </div>
        <h3 className="text-sm text-slate-400 mb-1">{label}</h3>
        <p className="text-2xl font-bold text-slate-100">{value}</p>
      </div>
    </Card>
  );
}