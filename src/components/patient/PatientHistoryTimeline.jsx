import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Clock,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Target
} from "lucide-react";

export default function PatientHistoryTimeline({ history }) {
  if (!history) return null;

  const { visits, _carePlans, _incidents, trends, continuityInsights } = history;

  const getTrendIcon = (trend) => {
    if (trend === 'increasing' || trend === 'improving') return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (trend === 'decreasing' || trend === 'declining') return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Activity className="w-4 h-4 text-blue-600" />;
  };

  return (
    <div className="space-y-4">
      {/* Vital Trends Card */}
      {trends?.vital_trends && Object.keys(trends.vital_trends).length > 0 && (
        <Card className="border-blue-200">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              Vital Signs Trends
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 space-y-2">
            {Object.entries(trends.vital_trends).map(([vital, data]) => (
              <div key={vital} className={`p-2 rounded border ${data.concern ? 'bg-red-50 border-red-300' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getTrendIcon(data.trend)}
                    <span className="text-sm font-medium capitalize">
                      {vital.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {data.change > 0 ? '+' : ''}{data.change}
                    </Badge>
                    <Badge className={`text-xs ${data.concern ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-800'}`}>
                      {data.trend}
                    </Badge>
                  </div>
                </div>
                {data.concern && (
                  <p className="text-xs text-red-700 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Significant deviation from baseline - requires documentation
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Care Plan Progress */}
      {trends?.care_plan_progress && (
        <Card className="border-green-200">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-green-600" />
              Care Plan Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-green-50 p-2 rounded text-center">
                <p className="text-xs text-green-700">Goals Met</p>
                <p className="text-xl font-bold text-green-900">{trends.care_plan_progress.met}</p>
              </div>
              <div className="bg-blue-50 p-2 rounded text-center">
                <p className="text-xs text-blue-700">Active</p>
                <p className="text-xl font-bold text-blue-900">{trends.care_plan_progress.active}</p>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">Success Rate</span>
              <Badge className={`${trends.care_plan_progress.success_rate >= 70 ? 'bg-green-600' : 'bg-yellow-600'} text-white`}>
                {trends.care_plan_progress.success_rate}%
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Incident Patterns */}
      {continuityInsights?.incident_patterns?.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              Recurring Patterns
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 space-y-2">
            {continuityInsights.incident_patterns.map((pattern, idx) => (
              <div key={idx} className="bg-white p-2 rounded border border-orange-200">
                <div className="flex items-center justify-between mb-1">
                  <Badge className={`text-xs ${pattern.concern_level === 'high' ? 'bg-red-600' : 'bg-orange-600'} text-white`}>
                    {pattern.concern_level}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {pattern.frequency}x
                  </Badge>
                </div>
                <p className="text-xs text-slate-900">{pattern.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recent Visit Timeline */}
      <Card className="border-slate-200">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-600" />
            Recent Visit History
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <ScrollArea className="h-48">
            <div className="space-y-3 pr-4">
              {visits?.slice(0, 5).map((visit, _idx) => (
                <div key={visit.id} className="relative pl-6 pb-3 border-l-2 border-blue-200 last:border-transparent">
                  <div className="absolute left-0 top-0 -translate-x-1/2 w-3 h-3 rounded-full bg-blue-600"></div>
                  <div className="bg-slate-50 p-2 rounded">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-900">{visit.visit_date}</span>
                      <Badge variant="outline" className="text-xs">{visit.visit_type}</Badge>
                    </div>
                    {visit.vital_signs && (
                      <p className="text-xs text-slate-600">
                        BP {visit.vital_signs.blood_pressure_systolic}/{visit.vital_signs.blood_pressure_diastolic}, 
                        HR {visit.vital_signs.heart_rate}, 
                        O2 {visit.vital_signs.oxygen_saturation}%
                      </p>
                    )}
                    {visit.nurse_notes && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {visit.nurse_notes.substring(0, 100)}...
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}