import React from 'react';
import { Card } from '@/components/ui/card';

export default function StatCard({ icon: Icon, label, value, trend, color = 'blue' }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    amber: 'bg-amber-50 text-amber-600 border-amber-200',
  };

  return (
    <Card className={`border-2 ${colorClasses[color]} hover:shadow-md transition-shadow`}>
      <div className="p-4 sm:p-6">
        <div className="flex items-start justify-between mb-3">
          <div className={`p-2 rounded-lg bg-${color}-100`}>
            {Icon && <Icon className="w-5 h-5" />}
          </div>
          {trend && (
            <span className={`text-xs font-semibold ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trend > 0 ? '+' : ''}{trend}%
            </span>
          )}
        </div>
        <h3 className="text-sm text-gray-600 mb-1">{label}</h3>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </Card>
  );
}