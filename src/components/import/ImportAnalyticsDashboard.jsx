import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BarChart3,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Target,
  Zap
} from "lucide-react";

export default function ImportAnalyticsDashboard({ importHistory = [] }) {
  // Calculate analytics
  const analytics = React.useMemo(() => {
    if (!importHistory || importHistory.length === 0) {
      return {
        totalImports: 0,
        totalRecordsProcessed: 0,
        totalSuccessful: 0,
        totalFailed: 0,
        averageSuccessRate: 0,
        commonErrors: [],
        timeSpentResolving: 0,
        mostRecentImport: null
      };
    }

    const totalImports = importHistory.length;
    const totalSuccessful = importHistory.reduce((sum, imp) => sum + (imp.success || 0), 0);
    const totalFailed = importHistory.reduce((sum, imp) => sum + (imp.failed || 0), 0);
    const totalRecordsProcessed = totalSuccessful + totalFailed;
    const averageSuccessRate = totalRecordsProcessed > 0 
      ? Math.round((totalSuccessful / totalRecordsProcessed) * 100)
      : 0;

    // Analyze common errors
    const errorCounts = {};
    importHistory.forEach(imp => {
      if (imp.errors) {
        imp.errors.forEach(err => {
          const key = err.error || 'Unknown error';
          errorCounts[key] = (errorCounts[key] || 0) + 1;
        });
      }
    });

    const commonErrors = Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([error, count]) => ({ error, count }));

    const timeSpentResolving = importHistory.reduce((sum, imp) => 
      sum + (imp.resolutionTime || 0), 0
    );

    const mostRecentImport = importHistory[importHistory.length - 1];

    return {
      totalImports,
      totalRecordsProcessed,
      totalSuccessful,
      totalFailed,
      averageSuccessRate,
      commonErrors,
      timeSpentResolving: Math.round(timeSpentResolving / 60), // Convert to minutes
      mostRecentImport
    };
  }, [importHistory]);

  return (
    <div className="space-y-4">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-xs mb-1">Total Imports</p>
                <p className="text-2xl font-bold">{analytics.totalImports}</p>
              </div>
              <FileSpreadsheet className="w-8 h-8 text-blue-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white border-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-xs mb-1">Success Rate</p>
                <p className="text-2xl font-bold">{analytics.averageSuccessRate}%</p>
              </div>
              <Target className="w-8 h-8 text-green-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-navy-500 to-navy-600 text-white border-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-navy-100 text-xs mb-1">Records Processed</p>
                <p className="text-2xl font-bold">{analytics.totalRecordsProcessed}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-navy-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-xs mb-1">Time Saved</p>
                <p className="text-2xl font-bold">{analytics.timeSpentResolving}m</p>
              </div>
              <Zap className="w-8 h-8 text-orange-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Success vs Failed */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              Import Success Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">Successful Records</span>
                <Badge className="bg-green-100 text-green-800">
                  {analytics.totalSuccessful}
                </Badge>
              </div>
              <Progress 
                value={analytics.totalRecordsProcessed > 0 
                  ? (analytics.totalSuccessful / analytics.totalRecordsProcessed) * 100 
                  : 0
                } 
                className="h-3 bg-green-100"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">Failed Records</span>
                <Badge className="bg-red-100 text-red-800">
                  {analytics.totalFailed}
                </Badge>
              </div>
              <Progress 
                value={analytics.totalRecordsProcessed > 0 
                  ? (analytics.totalFailed / analytics.totalRecordsProcessed) * 100 
                  : 0
                } 
                className="h-3 bg-red-100"
              />
            </div>

            <div className="pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span className="text-sm font-semibold">Overall Success Rate</span>
                </div>
                <span className="text-2xl font-bold text-green-600">
                  {analytics.averageSuccessRate}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Common Error Patterns */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-600" />
              Top Error Patterns
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.commonErrors.length > 0 ? (
              <ScrollArea className="h-48">
                <div className="space-y-3">
                  {analytics.commonErrors.map((error, idx) => (
                    <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-slate-900 flex-1 font-medium line-clamp-2">
                          {error.error}
                        </p>
                        <Badge variant="outline" className="bg-red-100 text-red-800 flex-shrink-0">
                          {error.count}×
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <CheckCircle2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm">No errors recorded yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Import Activity */}
      {analytics.mostRecentImport && (
        <Card className="border-2 border-blue-200 bg-blue-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              Most Recent Import
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-green-600">
                  {analytics.mostRecentImport.success || 0}
                </p>
                <p className="text-xs text-slate-600">Successful</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">
                  {analytics.mostRecentImport.failed || 0}
                </p>
                <p className="text-xs text-slate-600">Failed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-600">
                  {analytics.mostRecentImport.timestamp 
                    ? new Date(analytics.mostRecentImport.timestamp).toLocaleDateString()
                    : 'N/A'
                  }
                </p>
                <p className="text-xs text-slate-600">Date</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}