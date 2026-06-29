import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Users,
  Activity,
  Target,
  Loader2,
  ArrowUpRight,
  BarChart3,
  LineChart as LineChartIcon,
  RefreshCw,
  Calculator,
  Layers
} from "lucide-react";
import PatientCohortAnalysis from "./PatientCohortAnalysis";
import StaffingSimulationModule from "./StaffingSimulationModule";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ComposedChart
} from "recharts";

const COLORS = ['#3557b0', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function PDGMPredictiveAnalytics({ compact = false }) {
  const ai = useAICall();
  const [predictions, setPredictions] = useState(null);
  const [timeRange, setTimeRange] = useState("6months");
  const [error, setError] = useState(null);

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['visits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 100),
  });

  const generatePredictions = useCallback(async () => {
    setError(null);

    try {
      const activePatients = patients.filter(p => p.status === 'active');
      const patientSummary = activePatients.slice(0, 20).map(p => ({
        diagnosis: p.primary_diagnosis,
        secondary: p.secondary_diagnoses?.length || 0,
        status: p.status
      }));

      const visitSummary = visits.slice(0, 30).map(v => ({
        type: v.visit_type,
        date: v.visit_date,
        status: v.status
      }));

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a PDGM financial analyst. Based on this home health agency data, generate predictive analytics with detailed cohort analysis.

PATIENT DATA (${activePatients.length} active):
${JSON.stringify(patientSummary)}

RECENT VISITS:
${JSON.stringify(visitSummary)}

Generate realistic PDGM predictions for next ${timeRange === '3months' ? '3' : timeRange === '6months' ? '6' : '12'} months including patient cohort segmentation:

Return JSON:
{
  "revenue_forecast": {
    "current_monthly_avg": 45000,
    "projected_monthly": [
      {"month": "Jan", "projected": 47000, "optimized": 52000, "baseline": 44000},
      {"month": "Feb", "projected": 48500, "optimized": 54000, "baseline": 45000}
    ],
    "total_projected": 285000,
    "total_optimized": 320000,
    "improvement_potential": 35000,
    "improvement_percentage": 12.3
  },
  "case_mix_trends": {
    "current_avg_weight": 1.0234,
    "trend_direction": "increasing",
    "monthly_weights": [
      {"month": "Jan", "weight": 1.02, "functional": 0.95, "clinical": 1.08}
    ],
    "factors_improving": ["functional_documentation", "comorbidity_capture"],
    "factors_declining": []
  },
  "clinical_group_distribution": [
    {"group": "Cardiac", "percentage": 25, "avg_payment": 2100, "trend": "stable"},
    {"group": "Wounds", "percentage": 18, "avg_payment": 2400, "trend": "increasing"},
    {"group": "Neuro/Rehab", "percentage": 15, "avg_payment": 2300, "trend": "stable"},
    {"group": "Respiratory", "percentage": 12, "avg_payment": 2150, "trend": "decreasing"},
    {"group": "Other", "percentage": 30, "avg_payment": 1950, "trend": "stable"}
  ],
  "patient_cohort_analysis": {
    "cohorts": [
      {
        "name": "High-Acuity Cardiac",
        "patient_count": 12,
        "avg_revenue": 2650,
        "avg_case_mix": 1.18,
        "total_revenue": 31800,
        "predicted_revenue": 33000,
        "actual_revenue": 31800,
        "variance_pct": -3.6,
        "optimization_potential": 4200,
        "risk_breakdown": [
          {"level": "High", "count": 3, "pct": 25},
          {"level": "Medium", "count": 5, "pct": 42},
          {"level": "Low", "count": 4, "pct": 33}
        ],
        "characteristics": ["CHF primary diagnosis", "Multiple comorbidities", "High functional impairment"]
      },
      {
        "name": "Wound Care Complex",
        "patient_count": 8,
        "avg_revenue": 2850,
        "avg_case_mix": 1.22,
        "total_revenue": 22800,
        "predicted_revenue": 24000,
        "actual_revenue": 22800,
        "variance_pct": -5.0,
        "optimization_potential": 3600,
        "risk_breakdown": [
          {"level": "High", "count": 2, "pct": 25},
          {"level": "Medium", "count": 4, "pct": 50},
          {"level": "Low", "count": 2, "pct": 25}
        ],
        "characteristics": ["Stage 3-4 pressure ulcers", "Diabetic foot wounds", "Requires skilled nursing"]
      },
      {
        "name": "Post-Surgical Rehab",
        "patient_count": 15,
        "avg_revenue": 2100,
        "avg_case_mix": 1.05,
        "total_revenue": 31500,
        "predicted_revenue": 30000,
        "actual_revenue": 31500,
        "variance_pct": 5.0,
        "optimization_potential": 2800,
        "risk_breakdown": [
          {"level": "High", "count": 1, "pct": 7},
          {"level": "Medium", "count": 6, "pct": 40},
          {"level": "Low", "count": 8, "pct": 53}
        ],
        "characteristics": ["Joint replacement", "Short-term therapy focus", "Good discharge potential"]
      },
      {
        "name": "Medically Complex Elderly",
        "patient_count": 10,
        "avg_revenue": 2400,
        "avg_case_mix": 1.12,
        "total_revenue": 24000,
        "predicted_revenue": 22000,
        "actual_revenue": 24000,
        "variance_pct": 9.1,
        "optimization_potential": 1800,
        "risk_breakdown": [
          {"level": "High", "count": 4, "pct": 40},
          {"level": "Medium", "count": 4, "pct": 40},
          {"level": "Low", "count": 2, "pct": 20}
        ],
        "characteristics": ["Age 85+", "5+ comorbidities", "Polypharmacy", "Caregiver support needed"]
      }
    ],
    "variance_drivers": [
      {
        "driver": "Functional Documentation Gaps",
        "description": "M1800-M1860 scores not reflecting actual impairment levels",
        "revenue_impact": -8500,
        "impact_pct": -4.2,
        "affected_patients": 18,
        "priority": "high",
        "actionable": true,
        "recommendation": "Implement OASIS scrubber pre-submission review for all SOC assessments"
      },
      {
        "driver": "Comorbidity Under-capture",
        "description": "Secondary diagnoses not fully documented from medication lists",
        "revenue_impact": -5200,
        "impact_pct": -2.6,
        "affected_patients": 12,
        "priority": "high",
        "actionable": true,
        "recommendation": "Medication-to-diagnosis reconciliation at every admission"
      },
      {
        "driver": "Therapy Utilization Optimization",
        "description": "PT/OT visits aligned well with functional needs",
        "revenue_impact": 6800,
        "impact_pct": 3.4,
        "affected_patients": 22,
        "priority": "medium",
        "actionable": false,
        "recommendation": "Continue current therapy assessment protocols"
      },
      {
        "driver": "Wound Care Documentation Excellence",
        "description": "Detailed wound measurements and staging improving case-mix",
        "revenue_impact": 4500,
        "impact_pct": 2.2,
        "affected_patients": 8,
        "priority": "low",
        "actionable": false,
        "recommendation": "Share wound documentation best practices across teams"
      }
    ],
    "predicted_vs_actual": [
      {"name": "Cardiac", "predicted_revenue": 33000, "actual_revenue": 31800},
      {"name": "Wounds", "predicted_revenue": 24000, "actual_revenue": 22800},
      {"name": "Post-Surgical", "predicted_revenue": 30000, "actual_revenue": 31500},
      {"name": "Complex Elderly", "predicted_revenue": 22000, "actual_revenue": 24000}
    ]
  },
  "high_risk_profiles": [
    {
      "risk_type": "Documentation Gap",
      "patient_count": 8,
      "revenue_at_risk": 12000,
      "description": "Patients with incomplete functional assessments",
      "intervention": "Focus on M1800-M1860 documentation during next visits",
      "priority": "high"
    },
    {
      "risk_type": "Underscored Comorbidities",
      "patient_count": 5,
      "revenue_at_risk": 8500,
      "description": "Secondary diagnoses not fully captured",
      "intervention": "Review medication lists for undocumented conditions",
      "priority": "medium"
    }
  ],
  "documentation_impact_simulation": [
    {
      "scenario": "Improve Functional Scoring Accuracy",
      "current_state": "Average functional level: Low",
      "improved_state": "Average functional level: Medium",
      "revenue_impact": 15000,
      "implementation": "Train staff on OASIS-E functional item scales"
    },
    {
      "scenario": "Capture All Comorbidities",
      "current_state": "Avg 2.3 secondary dx per patient",
      "improved_state": "Avg 4.1 secondary dx per patient",
      "revenue_impact": 9500,
      "implementation": "Implement medication-to-diagnosis reconciliation"
    }
  ],
  "quarterly_projections": [
    {"quarter": "Q1", "episodes": 45, "revenue": 95000, "case_mix": 1.04},
    {"quarter": "Q2", "episodes": 48, "revenue": 102000, "case_mix": 1.06},
    {"quarter": "Q3", "episodes": 52, "revenue": 115000, "case_mix": 1.09},
    {"quarter": "Q4", "episodes": 55, "revenue": 125000, "case_mix": 1.11}
  ],
  "key_insights": [
    "Functional documentation improvements could increase revenue by 12%",
    "Wound care patients show highest reimbursement potential",
    "8 patients at risk for underscored assessments",
    "Post-surgical cohort outperforming predictions by 5%"
  ],
  "recommended_actions": [
    {"action": "Implement OASIS scrubber for all SOC visits", "impact": "high", "timeline": "immediate"},
    {"action": "Train on GG item scoring accuracy", "impact": "high", "timeline": "30 days"},
    {"action": "Review comorbidity capture process", "impact": "medium", "timeline": "60 days"}
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            revenue_forecast: { type: "object" },
            case_mix_trends: { type: "object" },
            clinical_group_distribution: { type: "array", items: { type: "object" } },
            patient_cohort_analysis: { type: "object" },
            high_risk_profiles: { type: "array", items: { type: "object" } },
            documentation_impact_simulation: { type: "array", items: { type: "object" } },
            quarterly_projections: { type: "array", items: { type: "object" } },
            key_insights: { type: "array", items: { type: "string" } },
            recommended_actions: { type: "array", items: { type: "object" } }
          }
        }
      });

      setPredictions(result);
    } catch (err) {
      console.error("Prediction error:", err);
      setError("Failed to generate predictions. Please try again.");
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patients, visits, timeRange]);

  useEffect(() => {
    if (patients.length > 0 && !predictions && !ai.loading) {
      generatePredictions();
    }
  }, [patients, predictions, ai.loading, generatePredictions]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  if (compact) {
    return (
      <Card className="border-indigo-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            PDGM Revenue Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ai.loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
            </div>
          ) : predictions ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">Projected Revenue</p>
                  <p className="text-xl font-bold text-slate-900">
                    {formatCurrency(predictions.revenue_forecast?.total_projected || 0)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Optimization Potential</p>
                  <p className="text-lg font-bold text-green-600 flex items-center gap-1">
                    <TrendingUp className="w-4 h-4" />
                    +{formatCurrency(predictions.revenue_forecast?.improvement_potential || 0)}
                  </p>
                </div>
              </div>
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={predictions.revenue_forecast?.projected_monthly?.slice(0, 4) || []}>
                    <Area type="monotone" dataKey="projected" stroke="#264491" fill="#b6c9ee" />
                    <Area type="monotone" dataKey="optimized" stroke="#22c55e" fill="#bbf7d0" fillOpacity={0.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={generatePredictions}>
                <RefreshCw className="w-3 h-3 mr-1" /> Refresh Forecast
              </Button>
            </div>
          ) : (
            <Button onClick={generatePredictions} size="sm" className="w-full">
              Generate Forecast
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            PDGM Predictive Analytics
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3months">3 Months</SelectItem>
                <SelectItem value="6months">6 Months</SelectItem>
                <SelectItem value="12months">12 Months</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              size="sm" 
              onClick={generatePredictions} 
              disabled={ai.loading}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {ai.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {ai.loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-4" />
            <p className="text-sm text-slate-600">Analyzing patient data and generating predictions...</p>
          </div>
        ) : error ? (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        ) : predictions ? (
          <Tabs defaultValue="revenue" className="space-y-4">
            <TabsList className="grid grid-cols-7 w-full">
              <TabsTrigger value="revenue" className="text-xs">Revenue</TabsTrigger>
              <TabsTrigger value="cohorts" className="text-xs gap-1">
                <Layers className="w-3 h-3" />Cohorts
              </TabsTrigger>
              <TabsTrigger value="casemix" className="text-xs">Case-Mix</TabsTrigger>
              <TabsTrigger value="risks" className="text-xs">High Risk</TabsTrigger>
              <TabsTrigger value="simulation" className="text-xs">Doc Sim</TabsTrigger>
              <TabsTrigger value="financial_sim" className="text-xs gap-1">
                <Calculator className="w-3 h-3" />Forecast
              </TabsTrigger>
              <TabsTrigger value="actions" className="text-xs">Actions</TabsTrigger>
            </TabsList>

            {/* Revenue Forecast Tab */}
            <TabsContent value="revenue" className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                  <p className="text-xs text-blue-600">Current Monthly Avg</p>
                  <p className="text-xl font-bold text-blue-900">
                    {formatCurrency(predictions.revenue_forecast?.current_monthly_avg || 0)}
                  </p>
                </div>
                <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                  <p className="text-xs text-indigo-600">Total Projected</p>
                  <p className="text-xl font-bold text-indigo-900">
                    {formatCurrency(predictions.revenue_forecast?.total_projected || 0)}
                  </p>
                </div>
                <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                  <p className="text-xs text-green-600">Optimized Potential</p>
                  <p className="text-xl font-bold text-green-900">
                    {formatCurrency(predictions.revenue_forecast?.total_optimized || 0)}
                  </p>
                </div>
                <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
                  <p className="text-xs text-emerald-600">Improvement</p>
                  <p className="text-xl font-bold text-emerald-900 flex items-center gap-1">
                    <TrendingUp className="w-4 h-4" />
                    +{predictions.revenue_forecast?.improvement_percentage || 0}%
                  </p>
                </div>
              </div>

              {/* Revenue Chart */}
              <div className="bg-white p-4 rounded-lg border">
                <h4 className="text-sm font-semibold mb-3">Revenue Projection vs Optimization Potential</h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={predictions.revenue_forecast?.projected_monthly || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                      <Legend />
                      <Area type="monotone" dataKey="baseline" fill="#e5e7eb" stroke="#9ca3af" name="Baseline" />
                      <Line type="monotone" dataKey="projected" stroke="#264491" strokeWidth={2} name="Projected" dot={{ fill: '#264491' }} />
                      <Line type="monotone" dataKey="optimized" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 5" name="Optimized" dot={{ fill: '#22c55e' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Quarterly Projections */}
              <div className="bg-white p-4 rounded-lg border">
                <h4 className="text-sm font-semibold mb-3">Quarterly Projections</h4>
                <div className="grid grid-cols-4 gap-3">
                  {predictions.quarterly_projections?.map((q, idx) => (
                    <div key={idx} className="bg-slate-50 p-3 rounded-lg border text-center">
                      <p className="text-xs text-slate-500 mb-1">{q.quarter}</p>
                      <p className="text-lg font-bold text-slate-900">{formatCurrency(q.revenue)}</p>
                      <div className="flex items-center justify-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{q.episodes} episodes</Badge>
                        <Badge className="bg-indigo-100 text-indigo-700 text-xs">CMW: {q.case_mix}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* Patient Cohort Analysis Tab */}
            <TabsContent value="cohorts" className="space-y-4">
              <PatientCohortAnalysis 
                cohortData={predictions.patient_cohort_analysis}
                formatCurrency={formatCurrency}
              />
            </TabsContent>

            {/* Case-Mix Trends Tab */}
            <TabsContent value="casemix" className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                  <p className="text-xs text-indigo-600">Current Avg Weight</p>
                  <p className="text-2xl font-bold text-indigo-900">
                    {predictions.case_mix_trends?.current_avg_weight?.toFixed(4) || '1.0000'}
                  </p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <p className="text-xs text-green-600">Trend Direction</p>
                  <p className="text-lg font-bold text-green-900 flex items-center gap-1 capitalize">
                    {predictions.case_mix_trends?.trend_direction === 'increasing' ? (
                      <><TrendingUp className="w-5 h-5" /> Increasing</>
                    ) : predictions.case_mix_trends?.trend_direction === 'decreasing' ? (
                      <><TrendingDown className="w-5 h-5 text-red-600" /> Decreasing</>
                    ) : (
                      <><Activity className="w-5 h-5" /> Stable</>
                    )}
                  </p>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <p className="text-xs text-blue-600">Improving Factors</p>
                  <p className="text-sm font-medium text-blue-900">
                    {predictions.case_mix_trends?.factors_improving?.length || 0} areas
                  </p>
                </div>
              </div>

              {/* Case-Mix Weight Chart */}
              <div className="bg-white p-4 rounded-lg border">
                <h4 className="text-sm font-semibold mb-3">Case-Mix Weight Components Over Time</h4>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={predictions.case_mix_trends?.monthly_weights || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0.8, 1.2]} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="weight" stroke="#264491" strokeWidth={2} name="Total Weight" />
                      <Line type="monotone" dataKey="functional" stroke="#22c55e" strokeWidth={2} name="Functional" />
                      <Line type="monotone" dataKey="clinical" stroke="#f59e0b" strokeWidth={2} name="Clinical" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Clinical Group Distribution */}
              <div className="bg-white p-4 rounded-lg border">
                <h4 className="text-sm font-semibold mb-3">Clinical Group Distribution</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={predictions.clinical_group_distribution || []}
                          dataKey="percentage"
                          nameKey="group"
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          label={({ group, percentage }) => `${group}: ${percentage}%`}
                          labelLine={false}
                        >
                          {(predictions.clinical_group_distribution || []).map((entry, idx) => (
                            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {predictions.clinical_group_distribution?.map((group, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="text-sm font-medium">{group.group}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-600">{formatCurrency(group.avg_payment)}</span>
                          <Badge className={`text-xs ${
                            group.trend === 'increasing' ? 'bg-green-100 text-green-700' :
                            group.trend === 'decreasing' ? 'bg-red-100 text-red-700' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {group.trend}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* High Risk Profiles Tab */}
            <TabsContent value="risks" className="space-y-4">
              <Alert className="bg-amber-50 border-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  {predictions.high_risk_profiles?.length || 0} high-risk patient profiles identified requiring proactive intervention
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                {predictions.high_risk_profiles?.map((risk, idx) => (
                  <Card key={idx} className={`border-l-4 ${
                    risk.priority === 'high' ? 'border-l-red-500 bg-red-50' :
                    risk.priority === 'medium' ? 'border-l-orange-500 bg-orange-50' :
                    'border-l-yellow-500 bg-yellow-50'
                  }`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                            {risk.risk_type}
                            <Badge className={`${
                              risk.priority === 'high' ? 'bg-red-600' :
                              risk.priority === 'medium' ? 'bg-orange-500' : 'bg-yellow-500'
                            }`}>
                              {risk.priority}
                            </Badge>
                          </h4>
                          <p className="text-sm text-slate-600 mt-1">{risk.description}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">Revenue at Risk</p>
                          <p className="text-xl font-bold text-red-600">{formatCurrency(risk.revenue_at_risk)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="flex items-center gap-1 text-sm">
                          <Users className="w-4 h-4 text-slate-500" />
                          <span>{risk.patient_count} patients affected</span>
                        </div>
                      </div>
                      <Alert className="bg-white border-slate-200">
                        <Target className="w-4 h-4 text-blue-600" />
                        <AlertDescription className="text-slate-800 text-sm">
                          <strong>Intervention:</strong> {risk.intervention}
                        </AlertDescription>
                      </Alert>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* Simulation Tab */}
            <TabsContent value="simulation" className="space-y-4">
              <Alert className="bg-blue-50 border-blue-200">
                <AlertDescription className="text-blue-800">
                  Simulated revenue impact of documentation improvements based on your patient population
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                {predictions.documentation_impact_simulation?.map((sim, idx) => (
                  <Card key={idx} className="border-green-200">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <h4 className="font-semibold text-slate-900">{sim.scenario}</h4>
                        <div className="text-right">
                          <p className="text-xs text-green-600">Potential Impact</p>
                          <p className="text-xl font-bold text-green-700">+{formatCurrency(sim.revenue_impact)}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="bg-red-50 p-2 rounded border border-red-200">
                          <p className="text-xs text-red-600">Current State</p>
                          <p className="text-sm text-red-800">{sim.current_state}</p>
                        </div>
                        <div className="bg-green-50 p-2 rounded border border-green-200">
                          <p className="text-xs text-green-600">Improved State</p>
                          <p className="text-sm text-green-800">{sim.improved_state}</p>
                        </div>
                      </div>
                      <div className="bg-blue-50 p-2 rounded border border-blue-200">
                        <p className="text-xs text-blue-600">Implementation</p>
                        <p className="text-sm text-blue-800">{sim.implementation}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Total Simulation Impact */}
              <div className="bg-gradient-to-r from-green-100 to-emerald-100 p-4 rounded-lg border-2 border-green-300">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-green-700">Total Optimization Potential</p>
                    <p className="text-3xl font-bold text-green-800">
                      +{formatCurrency(predictions.documentation_impact_simulation?.reduce((sum, s) => sum + (s.revenue_impact || 0), 0) || 0)}
                    </p>
                  </div>
                  <TrendingUp className="w-12 h-12 text-green-600" />
                </div>
              </div>
            </TabsContent>

            {/* Financial Simulation Tab */}
            <TabsContent value="financial_sim" className="space-y-4">
              <StaffingSimulationModule 
                currentData={{
                  activePatients: patients.filter(p => p.status === 'active').length,
                  monthlyRevenue: predictions.revenue_forecast?.current_monthly_avg || 0,
                  caseMixWeight: predictions.case_mix_trends?.current_avg_weight || 1.0
                }}
                formatCurrency={formatCurrency}
              />
            </TabsContent>

            {/* Actions Tab */}
            <TabsContent value="actions" className="space-y-4">
              {/* Key Insights */}
              <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                <h4 className="font-semibold text-indigo-900 mb-2 flex items-center gap-2">
                  <LineChartIcon className="w-4 h-4" />
                  Key Insights
                </h4>
                <ul className="space-y-2">
                  {predictions.key_insights?.map((insight, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-indigo-800">
                      <ArrowUpRight className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Recommended Actions */}
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900">Recommended Actions</h4>
                {predictions.recommended_actions?.map((action, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-white rounded-lg border hover:border-indigo-300 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        action.impact === 'high' ? 'bg-green-100 text-green-700' :
                        action.impact === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {idx + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{action.action}</p>
                        <p className="text-xs text-slate-500">Timeline: {action.timeline}</p>
                      </div>
                    </div>
                    <Badge className={`${
                      action.impact === 'high' ? 'bg-green-600' :
                      action.impact === 'medium' ? 'bg-yellow-500' : 'bg-slate-500'
                    }`}>
                      {action.impact} impact
                    </Badge>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="text-center py-8">
            <BarChart3 className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 mb-4">Generate predictive analytics based on your patient data</p>
            <Button onClick={generatePredictions} className="bg-indigo-600 hover:bg-indigo-700">
              <BarChart3 className="w-4 h-4 mr-2" />
              Generate Predictions
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}