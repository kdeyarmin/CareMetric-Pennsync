import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, TrendingDown, Users, FileText } from "lucide-react";

export default function RealTimeDashboardWidget({ stats }) {
  const [liveStats, setLiveStats] = useState(stats);
  const [trends, setTrends] = useState({});

  useEffect(() => {
    const previousStats = { ...liveStats };
    setLiveStats(stats);

    // Calculate trends
    const newTrends = {
      users: stats.activeUsers - (previousStats.activeUsers || 0),
      visits: stats.completedVisits - (previousStats.completedVisits || 0),
      enhancements: stats.totalEnhancements - (previousStats.totalEnhancements || 0),
      compliance: parseFloat(stats.avgComplianceScore) - parseFloat(previousStats.avgComplianceScore || 0)
    };
    setTrends(newTrends);
  }, [stats]);

  const TrendIndicator = ({ value }) => {
    if (value === 0) return null;
    return value > 0 ? (
      <span className="text-green-600 text-xs flex items-center gap-1">
        <TrendingUp className="w-3 h-3" />
        +{value}
      </span>
    ) : (
      <span className="text-red-600 text-xs flex items-center gap-1">
        <TrendingDown className="w-3 h-3" />
        {value}
      </span>
    );
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Users className="w-6 h-6 text-blue-600" />
            <TrendIndicator value={trends.users} />
          </div>
          <p className="text-2xl font-bold text-slate-900">{liveStats.activeUsers}</p>
          <p className="text-xs text-slate-600">Active Users</p>
        </CardContent>
      </Card>

      <Card className="border-green-200 bg-gradient-to-br from-green-50 to-green-100">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Activity className="w-6 h-6 text-green-600" />
            <TrendIndicator value={trends.visits} />
          </div>
          <p className="text-2xl font-bold text-slate-900">{liveStats.completedVisits}</p>
          <p className="text-xs text-slate-600">Visits Completed</p>
        </CardContent>
      </Card>

      <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <FileText className="w-6 h-6 text-purple-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{liveStats.totalEnhancements}</p>
          <p className="text-xs text-slate-600">Total Enhancements</p>
        </CardContent>
      </Card>

      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-6 h-6 text-amber-600" />
            <TrendIndicator value={parseFloat(trends.compliance?.toFixed(1) || 0)} />
          </div>
          <p className="text-2xl font-bold text-slate-900">{liveStats.avgComplianceScore}%</p>
          <p className="text-xs text-slate-600">Avg Compliance</p>
        </CardContent>
      </Card>
    </div>
  );
}