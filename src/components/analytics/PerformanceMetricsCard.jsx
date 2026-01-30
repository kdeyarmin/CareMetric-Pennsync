import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

export default function PerformanceMetricsCard({ title, value, change, icon: Icon, color }) {
  const colorClasses = {
    blue: "from-blue-50 to-blue-100 border-blue-200",
    green: "from-green-50 to-green-100 border-green-200",
    orange: "from-orange-50 to-orange-100 border-orange-200",
    purple: "from-purple-50 to-purple-100 border-purple-200",
    indigo: "from-indigo-50 to-indigo-100 border-indigo-200",
  };

  const iconColorClasses = {
    blue: "text-blue-600",
    green: "text-green-600",
    orange: "text-orange-600",
    purple: "text-purple-600",
    indigo: "text-indigo-600",
  };

  return (
    <Card className={`bg-gradient-to-br ${colorClasses[color] || colorClasses.blue} overflow-hidden`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] sm:text-xs md:text-sm font-medium text-gray-600 truncate flex-1">
            {title}
          </p>
          {Icon && (
            <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${iconColorClasses[color] || iconColorClasses.blue} flex-shrink-0`} />
          )}
        </div>
        <div className="flex items-end justify-between gap-2">
          <p className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 truncate">
            {value}
          </p>
          {change !== undefined && change !== null && (
            <div className={`flex items-center gap-1 text-xs sm:text-sm ${
              parseFloat(change) > 0 ? 'text-green-600' : parseFloat(change) < 0 ? 'text-red-600' : 'text-gray-500'
            }`}>
              {parseFloat(change) > 0 ? (
                <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
              ) : parseFloat(change) < 0 ? (
                <TrendingDown className="w-3 h-3 sm:w-4 sm:h-4" />
              ) : null}
              <span className="font-medium whitespace-nowrap">{Math.abs(parseFloat(change)).toFixed(1)}%</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}