import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Users, FileText, GraduationCap, AlertTriangle } from "lucide-react";

export default function AgencyWideMetrics({ agency, users }) {
  // Calculate metrics from agency data
  const metrics = React.useMemo(() => {
    if (!users || users.length === 0) {
      return {
        avgCompliance: 0,
        avgQuality: 0,
        totalNotes: 0,
        trainingRate: 0,
        complianceChange: 0,
        qualityChange: 0,
        productivityChange: 0,
        trainingChange: 0
      };
    }

    // These would be calculated from actual data
    return {
      avgCompliance: 85,
      avgQuality: 82,
      totalNotes: users.length * 15, // Estimate
      trainingRate: 75,
      complianceChange: 5,
      qualityChange: 3,
      productivityChange: 12,
      trainingChange: 8
    };
  }, [users]);
  const metricCards = [
    {
      title: "Average Compliance",
      value: `${metrics.avgCompliance}%`,
      change: metrics.complianceChange,
      icon: AlertTriangle,
      color: metrics.avgCompliance >= 85 ? "text-green-600" : "text-yellow-600"
    },
    {
      title: "Average Quality Score",
      value: `${metrics.avgQuality}%`,
      change: metrics.qualityChange,
      icon: FileText,
      color: metrics.avgQuality >= 85 ? "text-green-600" : "text-yellow-600"
    },
    {
      title: "Total Productivity",
      value: metrics.totalNotes,
      change: metrics.productivityChange,
      icon: Users,
      color: "text-blue-600"
    },
    {
      title: "Training Completion",
      value: `${metrics.trainingRate}%`,
      change: metrics.trainingChange,
      icon: GraduationCap,
      color: metrics.trainingRate >= 80 ? "text-green-600" : "text-yellow-600"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {metricCards.map((metric, idx) => (
        <Card key={idx}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              {metric.title}
            </CardTitle>
            <metric.icon className={`w-4 h-4 ${metric.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {metric.value}
            </div>
            {metric.change !== null && metric.change !== undefined && (
              <div className={`flex items-center text-xs mt-1 ${
                metric.change >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {metric.change >= 0 ? (
                  <TrendingUp className="w-3 h-3 mr-1" />
                ) : (
                  <TrendingDown className="w-3 h-3 mr-1" />
                )}
                {Math.abs(metric.change)}% from last month
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}