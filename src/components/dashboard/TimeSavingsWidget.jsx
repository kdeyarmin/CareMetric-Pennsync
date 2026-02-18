import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, TrendingUp, Zap, Calendar } from "lucide-react";
import { format, subDays, startOfWeek, startOfMonth } from "date-fns";

export default function TimeSavingsWidget() {
  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: timeSavings = [] } = useQuery({
    queryKey: ["timeSavings", user?.email],
    queryFn: () => base44.entities.TimeSavings.list("-created_date", 1000),
    enabled: !!user,
  });

  const calculateStats = () => {
    const now = new Date();
    const today = format(now, "yyyy-MM-dd");
    const weekStart = format(startOfWeek(now), "yyyy-MM-dd");
    const monthStart = format(startOfMonth(now), "yyyy-MM-dd");

    const todaySavings = timeSavings.filter(
      (t) => format(new Date(t.created_date), "yyyy-MM-dd") === today
    );
    const weekSavings = timeSavings.filter(
      (t) => format(new Date(t.created_date), "yyyy-MM-dd") >= weekStart
    );
    const monthSavings = timeSavings.filter(
      (t) => format(new Date(t.created_date), "yyyy-MM-dd") >= monthStart
    );

    const totalToday = todaySavings.reduce((sum, t) => sum + t.time_saved_minutes, 0);
    const totalWeek = weekSavings.reduce((sum, t) => sum + t.time_saved_minutes, 0);
    const totalMonth = monthSavings.reduce((sum, t) => sum + t.time_saved_minutes, 0);
    const totalAllTime = timeSavings.reduce((sum, t) => sum + t.time_saved_minutes, 0);

    const avgPerDay = weekSavings.length > 0 ? totalWeek / 7 : 0;

    return {
      today: totalToday,
      week: totalWeek,
      month: totalMonth,
      allTime: totalAllTime,
      avgPerDay,
      count: timeSavings.length,
    };
  };

  const formatTime = (minutes) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const stats = calculateStats();

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-600" />
          Time Saved with AI
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid grid-cols-2 gap-4">
          {/* Today */}
          <div className="flex flex-col items-center p-4 bg-gradient-to-br from-blue-100/60 to-slate-100/80 dark:from-blue-950/30 dark:to-slate-800/30 rounded-lg border border-blue-200/40">
            <Zap className="h-5 w-5 text-blue-600 mb-2" />
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
              {formatTime(stats.today)}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400">Today</div>
          </div>

          {/* This Week */}
          <div className="flex flex-col items-center p-4 bg-gradient-to-br from-blue-100/60 to-slate-100/80 dark:from-blue-950/30 dark:to-slate-800/30 rounded-lg border border-blue-200/40">
            <Calendar className="h-5 w-5 text-blue-600 mb-2" />
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
              {formatTime(stats.week)}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400">This Week</div>
          </div>

          {/* This Month */}
          <div className="flex flex-col items-center p-4 bg-gradient-to-br from-blue-100/60 to-slate-100/80 dark:from-blue-950/30 dark:to-slate-800/30 rounded-lg border border-blue-200/40">
            <TrendingUp className="h-5 w-5 text-blue-600 mb-2" />
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
              {formatTime(stats.month)}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400">This Month</div>
          </div>

          {/* All Time */}
          <div className="flex flex-col items-center p-4 bg-gradient-to-br from-blue-100/60 to-slate-100/80 dark:from-blue-950/30 dark:to-slate-800/30 rounded-lg border border-blue-200/40">
            <Clock className="h-5 w-5 text-blue-600 mb-2" />
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
              {formatTime(stats.allTime)}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400">All Time</div>
          </div>
        </div>

        {/* Average per day */}
        <div className="mt-4 p-3 bg-gradient-to-r from-blue-100/50 to-slate-100/60 dark:from-blue-950/20 dark:to-slate-800/20 rounded-lg border border-blue-200/40 dark:border-blue-800">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Daily Average (7 days)
            </span>
            <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {formatTime(stats.avgPerDay)}
            </span>
          </div>
          {stats.avgPerDay >= 120 && (
            <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              You're saving over 2 hours per day! 🎉
            </div>
          )}
        </div>

        {/* Summary */}
        <div className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
          {stats.count} AI-powered tasks completed
        </div>
      </CardContent>
    </Card>
  );
}