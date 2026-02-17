import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Loader2, AlertTriangle, Heart, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function ReadmissionRiskAnalytics() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('readmissionRiskPredictor', {
        limit: 50
      });
      setData(response);
      toast.success("Readmission risk analysis loaded");
    } catch (error) {
      console.error('Risk analysis error:', error);
      toast.error("Failed to load risk predictions");
    } finally {
      setLoading(false);
    }
  };

  const riskDistribution = [
    { name: 'High Risk', value: data?.high_risk_count || 0, color: '#ef4444' },
    { name: 'Moderate Risk', value: data?.moderate_risk_count || 0, color: '#f59e0b' },
    { name: 'Low Risk', value: data?.low_risk_count || 0, color: '#10b981' }
  ];

  const topRiskData = data?.high_risk_patients?.map((p, idx) => ({
    name: p.patient_name.substring(0, 20),
    score: p.risk_score,
    alerts: p.active_alerts
  })) || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-red-600" />
              <CardTitle>Readmission Risk Prediction</CardTitle>
            </div>
            <Button onClick={loadAnalytics} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Analyze Now
            </Button>
          </div>
        </CardHeader>
      </Card>

      {data && (
        <>
          {/* Risk Distribution */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'High Risk', value: data.high_risk_count, color: 'bg-red-100 text-red-800', icon: '🔴' },
              { label: 'Moderate Risk', value: data.moderate_risk_count, color: 'bg-yellow-100 text-yellow-800', icon: '🟡' },
              { label: 'Low Risk', value: data.low_risk_count, color: 'bg-green-100 text-green-800', icon: '🟢' },
              { label: 'Avg Risk Score', value: `${data.avg_risk_score}/100`, color: 'bg-blue-100 text-blue-800', icon: '📊' }
            ].map((stat, idx) => (
              <Card key={idx} className={`p-3 ${stat.color?.split(' ')[0]}`}>
                <p className="text-xs font-semibold mb-1">{stat.label}</p>
                <p className="text-lg font-bold flex items-center gap-2">
                  <span>{stat.icon}</span>
                  {stat.value}
                </p>
              </Card>
            ))}
          </div>

          {/* Risk Chart */}
          {topRiskData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top High-Risk Patients</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={topRiskData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} />
                    <YAxis dataKey="name" type="category" width={120} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="score" fill="#ef4444" name="Risk Score" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* High-Risk Patients Detailed */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                High-Risk Patients (Priority Intervention)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.high_risk_patients?.slice(0, 8)?.map((patient, idx) => (
                  <div key={idx} className="p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-700">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{patient.patient_name}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {patient.primary_diagnosis}
                        </p>
                      </div>
                      <Badge className="bg-red-600 text-white text-xs">
                        {patient.risk_score}/100
                      </Badge>
                    </div>
                    
                    {/* Risk Factors */}
                    <div className="space-y-1 mb-2">
                      {patient.risk_factors?.slice(0, 3)?.map((factor, fidx) => (
                        <p key={fidx} className="text-xs text-slate-700 dark:text-slate-300">
                          • {factor}
                        </p>
                      ))}
                      {patient.risk_factors?.length > 3 && (
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          +{patient.risk_factors.length - 3} more factors
                        </p>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-red-200 dark:border-red-700">
                      <div>
                        <p className="text-xs text-slate-600 dark:text-slate-400">Recent Visits</p>
                        <p className="font-semibold text-sm">{patient.recent_visits}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-600 dark:text-slate-400">Active Alerts</p>
                        <p className="font-semibold text-sm">{patient.active_alerts}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-600 dark:text-slate-400">Risk Level</p>
                        <p className="font-semibold text-sm text-red-600">{patient.risk_level.toUpperCase()}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* AI Recommendations */}
          {data.recommended_interventions && (
            <Card className="border-purple-300 dark:border-purple-600">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">🤖 Recommended Interventions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {data.recommended_interventions}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Risk Distribution Legend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Risk Distribution Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {riskDistribution.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800 rounded">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }} />
                      <span className="text-sm font-medium">{item.name}</span>
                    </div>
                    <span className="font-bold text-sm">{item.value} patients</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}