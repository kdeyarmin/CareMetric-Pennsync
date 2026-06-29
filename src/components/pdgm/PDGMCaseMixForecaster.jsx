import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp,
  Loader2,
  DollarSign,
  Calendar,
  Users,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  RefreshCw,
  Target,
  AlertTriangle
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export default function PDGMCaseMixForecaster({ compact = false }) {
  const ai = useAICall();
  const [forecast, setForecast] = useState(null);
  const [timeframe, setTimeframe] = useState("30");
  const [_selectedPatient, _setSelectedPatient] = useState("all");

  const { data: patients = [] } = useQuery({
    // Namespaced active-only set — see note in PatientAlerts: the bare ['patients']
    // key collided with all-patients (Patient.list) queries in the shared cache.
    queryKey: ['patients', 'active'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }),
    initialData: []
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.filter({}, '-visit_date', 200),
    initialData: []
  });

  const generateForecast = async () => {

    try {
      const patientSummaries = patients.slice(0, 20).map(p => ({
        id: p.id,
        name: `${p.first_name} ${p.last_name}`,
        primary_diagnosis: p.primary_diagnosis,
        secondary_diagnoses: p.secondary_diagnoses,
        status: p.status
      }));

      const visitHistory = visits.slice(0, 50).map(v => ({
        patient_id: v.patient_id,
        visit_type: v.visit_type,
        visit_date: v.visit_date,
        status: v.status
      }));

      const prompt = `You are a PDGM revenue forecasting expert. Based on historical patient data and visit patterns, generate a ${timeframe}-day forecast for case-mix scores and revenue.

ACTIVE PATIENTS (${patients.length} total):
${JSON.stringify(patientSummaries, null, 2)}

RECENT VISIT HISTORY:
${JSON.stringify(visitHistory, null, 2)}

FORECASTING INSTRUCTIONS:
1. Analyze patient diagnoses to predict clinical groupings
2. Estimate functional levels based on diagnosis patterns
3. Calculate expected comorbidity adjustments
4. Factor in episode timing (early vs late)
5. Account for admission source patterns
6. Project revenue as a ROUGH ESTIMATE using standard CMS PDGM base rates. Do not present figures as exact payment — CMS base rates change annually and must be verified against the agency's current CMS rate table.

Return JSON:
{
  "forecast_summary": {
    "forecast_period_days": ${timeframe},
    "total_projected_episodes": number,
    "total_projected_revenue": number,
    "average_case_mix_weight": number,
    "confidence_level": "high|medium|low"
  },
  "revenue_by_month": [
    {"month": "Month Year", "projected_revenue": number, "episode_count": number, "avg_case_mix": number}
  ],
  "clinical_group_distribution": [
    {"group": "MMTA-X", "percentage": number, "episode_count": number, "avg_payment": number}
  ],
  "patient_level_forecasts": [
    {
      "patient_id": "id",
      "patient_name": "name",
      "predicted_clinical_group": "group",
      "predicted_functional_level": "low|medium|high",
      "predicted_comorbidity_tier": "none|low|high",
      "predicted_case_mix_weight": number,
      "predicted_episode_payment": number,
      "episodes_in_forecast": number,
      "total_predicted_revenue": number,
      "risk_factors": ["list of factors affecting prediction"],
      "optimization_opportunities": ["ways to improve revenue"]
    }
  ],
  "trend_analysis": {
    "case_mix_trend": "increasing|stable|decreasing",
    "revenue_trend": "increasing|stable|decreasing",
    "trend_drivers": ["factors driving trends"],
    "comparison_to_prior_period": {
      "revenue_change_percent": number,
      "case_mix_change_percent": number
    }
  },
  "risk_alerts": [
    {
      "type": "undercoding|episode_timing|functional_decline|other",
      "patient_id": "id if applicable",
      "description": "alert description",
      "revenue_at_risk": number,
      "recommended_action": "action to take"
    }
  ],
  "optimization_recommendations": [
    {
      "category": "coding|documentation|clinical|timing",
      "recommendation": "specific recommendation",
      "potential_revenue_impact": number,
      "implementation_effort": "low|medium|high"
    }
  ]
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            forecast_summary: { type: "object" },
            revenue_by_month: { type: "array", items: { type: "object" } },
            clinical_group_distribution: { type: "array", items: { type: "object" } },
            patient_level_forecasts: { type: "array", items: { type: "object" } },
            trend_analysis: { type: "object" },
            risk_alerts: { type: "array", items: { type: "object" } },
            optimization_recommendations: { type: "array", items: { type: "object" } }
          }
        }
      });

      setForecast(result);
    } catch (error) {
      console.error("Forecasting error:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount || 0);
  };

  const getTrendIcon = (trend) => {
    if (trend === 'increasing') return <ArrowUpRight className="w-4 h-4 text-green-600" />;
    if (trend === 'decreasing') return <ArrowDownRight className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-slate-500" />;
  };

  const COLORS = ['#264491', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#0d9488'];

  if (compact) {
    return (
      <Card className="border-2 border-navy-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-navy-600" />
              PDGM Revenue Forecast
            </div>
            <Button size="sm" variant="ghost" onClick={generateForecast} disabled={ai.loading}>
              {ai.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {forecast ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-600">Projected Revenue ({timeframe}d)</span>
                <span className="text-lg font-bold text-navy-700">
                  {formatCurrency(forecast.forecast_summary?.total_projected_revenue)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Episodes: {forecast.forecast_summary?.total_projected_episodes}</span>
                <span className="text-slate-600">Avg CMW: {forecast.forecast_summary?.average_case_mix_weight?.toFixed(4)}</span>
              </div>
              {forecast.trend_analysis && (
                <div className="flex items-center gap-1 text-xs">
                  {getTrendIcon(forecast.trend_analysis.revenue_trend)}
                  <span className={forecast.trend_analysis.comparison_to_prior_period?.revenue_change_percent > 0 ? 'text-green-600' : 'text-red-600'}>
                    {forecast.trend_analysis.comparison_to_prior_period?.revenue_change_percent > 0 ? '+' : ''}
                    {forecast.trend_analysis.comparison_to_prior_period?.revenue_change_percent}% vs prior
                  </span>
                </div>
              )}
            </div>
          ) : (
            <Button onClick={generateForecast} disabled={ai.loading} className="w-full" size="sm">
              {ai.loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BarChart3 className="w-4 h-4 mr-2" />}
              Generate Forecast
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-navy-50 to-indigo-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-navy-600" />
            PDGM Case-Mix & Revenue Forecaster
          </div>
          <div className="flex items-center gap-2">
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="w-28 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 Days</SelectItem>
                <SelectItem value="60">60 Days</SelectItem>
                <SelectItem value="90">90 Days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={generateForecast}
              disabled={ai.loading}
              size="sm"
              className="bg-navy-600 hover:bg-navy-700"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Forecasting...</>
              ) : (
                <><TrendingUp className="w-4 h-4 mr-2" /> Generate Forecast</>
              )}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {!forecast && !ai.loading && (
          <Alert className="bg-navy-50 border-navy-200">
            <BarChart3 className="w-4 h-4 text-navy-600" />
            <AlertDescription className="text-navy-800 text-sm">
              Generate predictive forecasts for PDGM case-mix scores and revenue based on patient data and historical patterns.
            </AlertDescription>
          </Alert>
        )}

        {forecast && (
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="patients">Patients</TabsTrigger>
              <TabsTrigger value="trends">Trends</TabsTrigger>
              <TabsTrigger value="risks">Risks</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="space-y-4 mt-4">
              {/* Key Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-navy-50 p-3 rounded-lg border border-navy-200 text-center">
                  <DollarSign className="w-5 h-5 text-navy-600 mx-auto mb-1" />
                  <p className="text-xs text-navy-600">Projected Revenue</p>
                  <p className="text-xl font-bold text-navy-800">
                    {formatCurrency(forecast.forecast_summary?.total_projected_revenue)}
                  </p>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center">
                  <Calendar className="w-5 h-5 text-blue-600 mx-auto mb-1" />
                  <p className="text-xs text-blue-600">Episodes</p>
                  <p className="text-xl font-bold text-blue-800">
                    {forecast.forecast_summary?.total_projected_episodes}
                  </p>
                </div>
                <div className="bg-green-50 p-3 rounded-lg border border-green-200 text-center">
                  <Target className="w-5 h-5 text-green-600 mx-auto mb-1" />
                  <p className="text-xs text-green-600">Avg Case-Mix</p>
                  <p className="text-xl font-bold text-green-800">
                    {forecast.forecast_summary?.average_case_mix_weight?.toFixed(4)}
                  </p>
                </div>
                <div className="bg-orange-50 p-3 rounded-lg border border-orange-200 text-center">
                  <Users className="w-5 h-5 text-orange-600 mx-auto mb-1" />
                  <p className="text-xs text-orange-600">Confidence</p>
                  <p className="text-xl font-bold text-orange-800 capitalize">
                    {forecast.forecast_summary?.confidence_level}
                  </p>
                </div>
              </div>

              {/* Revenue Chart */}
              {forecast.revenue_by_month?.length > 0 && (
                <div className="bg-white p-4 rounded-lg border">
                  <h4 className="font-semibold text-slate-900 mb-3 text-sm">Revenue Projection</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={forecast.revenue_by_month}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v) => formatCurrency(v)} />
                      <Bar dataKey="projected_revenue" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Clinical Group Distribution */}
              {forecast.clinical_group_distribution?.length > 0 && (
                <div className="bg-white p-4 rounded-lg border">
                  <h4 className="font-semibold text-slate-900 mb-3 text-sm">Clinical Group Distribution</h4>
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="40%" height={150}>
                      <PieChart>
                        <Pie
                          data={forecast.clinical_group_distribution}
                          dataKey="percentage"
                          nameKey="group"
                          cx="50%"
                          cy="50%"
                          outerRadius={60}
                        >
                          {forecast.clinical_group_distribution.map((_, idx) => (
                            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-1">
                      {forecast.clinical_group_distribution.slice(0, 5).map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                            <span>{item.group}</span>
                          </div>
                          <span className="font-medium">{item.percentage}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="patients" className="mt-4">
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {forecast.patient_level_forecasts?.map((pf, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{pf.patient_name}</span>
                      <Badge className="bg-navy-100 text-navy-800">
                        {formatCurrency(pf.total_predicted_revenue)}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <p className="text-slate-500">Clinical</p>
                        <p className="font-medium">{pf.predicted_clinical_group}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Functional</p>
                        <p className="font-medium capitalize">{pf.predicted_functional_level}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Comorbidity</p>
                        <p className="font-medium capitalize">{pf.predicted_comorbidity_tier}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">CMW</p>
                        <p className="font-medium">{pf.predicted_case_mix_weight?.toFixed(4)}</p>
                      </div>
                    </div>
                    {pf.optimization_opportunities?.length > 0 && (
                      <div className="mt-2 pt-2 border-t">
                        <p className="text-xs text-green-700">
                          💡 {pf.optimization_opportunities[0]}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="trends" className="mt-4 space-y-4">
              {forecast.trend_analysis && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border bg-white">
                      <div className="flex items-center gap-2 mb-2">
                        {getTrendIcon(forecast.trend_analysis.revenue_trend)}
                        <span className="font-medium">Revenue Trend</span>
                      </div>
                      <p className="text-2xl font-bold capitalize">{forecast.trend_analysis.revenue_trend}</p>
                      <p className={`text-sm ${forecast.trend_analysis.comparison_to_prior_period?.revenue_change_percent > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {forecast.trend_analysis.comparison_to_prior_period?.revenue_change_percent > 0 ? '+' : ''}
                        {forecast.trend_analysis.comparison_to_prior_period?.revenue_change_percent}% vs prior period
                      </p>
                    </div>
                    <div className="p-4 rounded-lg border bg-white">
                      <div className="flex items-center gap-2 mb-2">
                        {getTrendIcon(forecast.trend_analysis.case_mix_trend)}
                        <span className="font-medium">Case-Mix Trend</span>
                      </div>
                      <p className="text-2xl font-bold capitalize">{forecast.trend_analysis.case_mix_trend}</p>
                      <p className={`text-sm ${forecast.trend_analysis.comparison_to_prior_period?.case_mix_change_percent > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {forecast.trend_analysis.comparison_to_prior_period?.case_mix_change_percent > 0 ? '+' : ''}
                        {forecast.trend_analysis.comparison_to_prior_period?.case_mix_change_percent}% vs prior period
                      </p>
                    </div>
                  </div>

                  {forecast.trend_analysis.trend_drivers?.length > 0 && (
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                      <h4 className="font-semibold text-blue-900 mb-2 text-sm">Trend Drivers</h4>
                      <ul className="space-y-1">
                        {forecast.trend_analysis.trend_drivers.map((driver, idx) => (
                          <li key={idx} className="text-sm text-blue-800 flex items-start gap-2">
                            <span className="text-blue-500">•</span>
                            {driver}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {/* Optimization Recommendations */}
              {forecast.optimization_recommendations?.length > 0 && (
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <h4 className="font-semibold text-green-900 mb-3 text-sm">Optimization Opportunities</h4>
                  <div className="space-y-2">
                    {forecast.optimization_recommendations.map((rec, idx) => (
                      <div key={idx} className="flex items-start justify-between p-2 bg-white rounded border">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs capitalize">{rec.category}</Badge>
                            <Badge className={rec.implementation_effort === 'low' ? 'bg-green-500' : rec.implementation_effort === 'medium' ? 'bg-yellow-500' : 'bg-red-500'}>
                              {rec.implementation_effort} effort
                            </Badge>
                          </div>
                          <p className="text-sm text-slate-700 mt-1">{rec.recommendation}</p>
                        </div>
                        <span className="text-green-700 font-bold text-sm">
                          +{formatCurrency(rec.potential_revenue_impact)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="risks" className="mt-4">
              {forecast.risk_alerts?.length > 0 ? (
                <div className="space-y-2">
                  {forecast.risk_alerts.map((alert, idx) => (
                    <Alert key={idx} className="bg-red-50 border-red-200">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <AlertDescription>
                        <div className="flex items-start justify-between">
                          <div>
                            <Badge className="bg-red-100 text-red-800 mb-1">{alert.type?.replace(/_/g, ' ')}</Badge>
                            <p className="text-sm text-red-800">{alert.description}</p>
                            <p className="text-xs text-red-600 mt-1">
                              <strong>Action:</strong> {alert.recommended_action}
                            </p>
                          </div>
                          <span className="text-red-700 font-bold">
                            {formatCurrency(alert.revenue_at_risk)} at risk
                          </span>
                        </div>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              ) : (
                <Alert className="bg-green-50 border-green-200">
                  <AlertDescription className="text-green-800">
                    No significant revenue risks identified in the forecast period.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}