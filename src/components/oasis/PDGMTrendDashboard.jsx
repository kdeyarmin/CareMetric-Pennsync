import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import { TrendingUp, Filter, Download, DollarSign, Activity, Loader2, AlertTriangle, Play } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toCsvRows } from "@/components/admin/csvExport";

const COLORS = ['#3557b0', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0d9488', '#06b6d4', '#84cc16'];

export default function PDGMTrendDashboard() {
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [selectedDiagnosis, setSelectedDiagnosis] = useState('all');
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [predictions, setPredictions] = useState(null);
  const [isPredicting, setIsPredicting] = useState(false);
  const [driverAnalysis, setDriverAnalysis] = useState(null);
  const [isAnalyzingDrivers, setIsAnalyzingDrivers] = useState(false);
  const [forecast, setForecast] = useState(null);
  const [isForecasting, setIsForecasting] = useState(false);
  const [atRiskPatients, setAtRiskPatients] = useState(null);
  const [isAnalyzingRisk, setIsAnalyzingRisk] = useState(false);
  const [pathwaySimulation, setPathwaySimulation] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationConfig, setSimulationConfig] = useState({
    pathway: 'standard',
    targetGroup: 'all',
    interventions: ''
  });

  // Fetch all OASIS uploads with PDGM data
  const { data: oasisUploads = [], isLoading } = useQuery({
    queryKey: ['oasisUploads'],
    queryFn: () => base44.entities.OASISUpload.list('-created_date', 500),
  });

  // Process and filter data
  const { filteredData, stats, chartData } = useMemo(() => {
    let filtered = oasisUploads.filter(upload => 
      upload.pdgm_data && 
      upload.analysis_results &&
      upload.status === 'analyzed'
    );

    // Apply date range filter
    if (dateRange.start) {
      filtered = filtered.filter(u => 
        new Date(u.created_date) >= new Date(dateRange.start)
      );
    }
    if (dateRange.end) {
      filtered = filtered.filter(u => 
        new Date(u.created_date) <= new Date(dateRange.end)
      );
    }

    // Apply clinical group filter
    if (selectedGroup !== 'all') {
      filtered = filtered.filter(u => 
        u.pdgm_data.clinical_group === selectedGroup
      );
    }

    // Apply diagnosis filter
    if (selectedDiagnosis !== 'all') {
      filtered = filtered.filter(u => 
        u.pdgm_data.primary_diagnosis?.toLowerCase().includes(selectedDiagnosis.toLowerCase())
      );
    }

    // Calculate statistics
    const totalAssessments = filtered.length;
    const avgPayment = filtered.reduce((sum, u) => 
      sum + (parseFloat(u.pdgm_data.estimated_payment) || 0), 0
    ) / (totalAssessments || 1);
    
    const avgCaseMix = filtered.reduce((sum, u) => 
      sum + (parseFloat(u.pdgm_data.case_mix_weight) || 0), 0
    ) / (totalAssessments || 1);

    const totalRevenue = filtered.reduce((sum, u) => 
      sum + (parseFloat(u.pdgm_data.estimated_payment) || 0), 0
    );

    // Payment trend over time
    const paymentTrend = {};
    filtered.forEach(u => {
      const month = new Date(u.created_date).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short' 
      });
      if (!paymentTrend[month]) {
        paymentTrend[month] = { month, total: 0, count: 0, avgPayment: 0, avgCaseMix: 0 };
      }
      paymentTrend[month].total += parseFloat(u.pdgm_data.estimated_payment) || 0;
      paymentTrend[month].count += 1;
      paymentTrend[month].avgCaseMix += parseFloat(u.pdgm_data.case_mix_weight) || 0;
    });

    const paymentTrendData = Object.values(paymentTrend)
      .map(d => ({
        ...d,
        avgPayment: Math.round(d.total / d.count),
        avgCaseMix: (d.avgCaseMix / d.count).toFixed(4)
      }))
      .sort((a, b) => new Date(a.month) - new Date(b.month))
      .slice(-12); // Last 12 months

    // Clinical group distribution
    const groupDist = {};
    filtered.forEach(u => {
      const group = u.pdgm_data.clinical_group || 'Unknown';
      groupDist[group] = (groupDist[group] || 0) + 1;
    });
    const groupDistData = Object.entries(groupDist).map(([name, value]) => ({ name, value }));

    // Functional level distribution
    const funcDist = {};
    filtered.forEach(u => {
      const level = u.pdgm_data.functional_level || 'Unknown';
      funcDist[level] = (funcDist[level] || 0) + 1;
    });
    const funcDistData = Object.entries(funcDist).map(([name, value]) => ({ name, value }));

    // Top diagnoses
    const diagDist = {};
    filtered.forEach(u => {
      const diag = u.pdgm_data.primary_diagnosis || 'Unknown';
      diagDist[diag] = (diagDist[diag] || 0) + 1;
    });
    const topDiagnoses = Object.entries(diagDist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    // Case mix trend
    const caseMixTrend = paymentTrendData.map(d => ({
      month: d.month,
      caseMix: parseFloat(d.avgCaseMix)
    }));

    // Compliance rates over time
    const complianceTrend = {};
    filtered.forEach(u => {
      const month = new Date(u.created_date).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short' 
      });
      if (!complianceTrend[month]) {
        complianceTrend[month] = { month, totalScore: 0, count: 0, avgCompliance: 0 };
      }
      const compScore = u.analysis_results?.compliance_score || u.scores?.compliance || 0;
      complianceTrend[month].totalScore += compScore;
      complianceTrend[month].count += 1;
    });

    const complianceTrendData = Object.values(complianceTrend)
      .map(d => ({
        month: d.month,
        avgCompliance: Math.round(d.totalScore / d.count),
        count: d.count
      }))
      .sort((a, b) => new Date(a.month) - new Date(b.month))
      .slice(-12);

    return {
      filteredData: filtered,
      stats: {
        totalAssessments,
        avgPayment: Math.round(avgPayment),
        avgCaseMix: avgCaseMix.toFixed(4),
        totalRevenue: Math.round(totalRevenue)
      },
      chartData: {
        paymentTrend: paymentTrendData,
        groupDist: groupDistData,
        funcDist: funcDistData,
        topDiagnoses,
        caseMixTrend,
        complianceTrend: complianceTrendData
      }
    };
  }, [oasisUploads, dateRange, selectedGroup, selectedDiagnosis]);

  // Get unique clinical groups and diagnoses for filters
  const clinicalGroups = useMemo(() => {
    const groups = new Set();
    oasisUploads.forEach(u => {
      if (u.pdgm_data?.clinical_group) {
        groups.add(u.pdgm_data.clinical_group);
      }
    });
    return Array.from(groups).sort();
  }, [oasisUploads]);

  const diagnoses = useMemo(() => {
    const diags = new Set();
    oasisUploads.forEach(u => {
      if (u.pdgm_data?.primary_diagnosis) {
        diags.add(u.pdgm_data.primary_diagnosis);
      }
    });
    return Array.from(diags).sort();
  }, [oasisUploads]);

  const generatePredictions = async () => {
    if (chartData.paymentTrend.length < 3) return;

    setIsPredicting(true);
    try {
      const last3 = chartData.paymentTrend.slice(-3);
      const avg = Math.round(last3.reduce((s, d) => s + d.avgPayment, 0) / 3);
      
      const result = await invokeLLM({
        model: "claude_opus_4_8",
        prompt: `Last 3 months avg payment: $${avg}. Predict next 3 months.`,
        response_json_schema: {
          type: "object",
          properties: {
            predictions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  month: { type: "string" },
                  predicted_payment: { type: "number" },
                  predicted_count: { type: "number" },
                  confidence: { type: "string" }
                }
              }
            },
            trend_direction: { type: "string" },
            key_insights: { type: "array", items: { type: "string" } }
          }
        }
      });
      setPredictions(result);
    } catch (error) {
      console.error("Prediction error:", error);
      setPredictions({ error: "Failed to generate predictions. Please try again." });
    }
    setIsPredicting(false);
  };

  const analyzeDrivers = async () => {
    if (filteredData.length < 5) return;

    setIsAnalyzingDrivers(true);
    try {
      const topGroup = chartData.groupDist[0]?.name || 'N/A';
      const topFunc = chartData.funcDist[0]?.name || 'N/A';
      
      const result = await invokeLLM({
        model: "claude_opus_4_8",
        prompt: `Top PDGM drivers for $${stats.avgPayment} avg. Top group: ${topGroup}. Top func: ${topFunc}. List 3 key drivers.`,
        response_json_schema: {
          type: "object",
          properties: {
            key_drivers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  driver: { type: "string" },
                  impact: { type: "string" },
                  correlation: { type: "string" },
                  average_effect: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            }
          }
        }
      });
      setDriverAnalysis(result);
    } catch (error) {
      console.error("Driver analysis error:", error);
      setDriverAnalysis({ error: "Failed to analyze drivers. Please try again." });
    }
    setIsAnalyzingDrivers(false);
  };

  // Advanced AI Forecasting
  const generateAdvancedForecast = async () => {
    if (filteredData.length < 10) return;

    setIsForecasting(true);
    try {
      const historicalData = chartData.paymentTrend.slice(-6).map(d => ({
        month: d.month,
        avgPayment: d.avgPayment,
        count: d.count,
        avgCaseMix: d.avgCaseMix
      }));

      const complianceData = chartData.complianceTrend.slice(-6);
      const topGroups = chartData.groupDist.slice(0, 3);

      const result = await invokeLLM({
        model: "claude_opus_4_8",
        prompt: `Analyze PDGM trends and forecast next 6 months.

HISTORICAL DATA (Last 6 months):
${JSON.stringify(historicalData)}

COMPLIANCE TRENDS:
${JSON.stringify(complianceData)}

TOP CLINICAL GROUPS:
${JSON.stringify(topGroups)}

CURRENT STATS:
- Total Assessments: ${stats.totalAssessments}
- Avg Payment: $${stats.avgPayment}
- Avg Case Mix: ${stats.avgCaseMix}

Consider:
1. Historical payment trends and seasonality
2. Compliance score patterns and their revenue impact
3. Clinical group distribution shifts
4. Potential regulatory changes (2025 PDGM updates, value-based care initiatives)
5. Market conditions and healthcare policy trends

Provide:
- 6-month payment forecasts with confidence intervals
- Revenue projections with best/worst case scenarios
- Regulatory impact assessment
- Strategic recommendations`,
        response_json_schema: {
          type: "object",
          properties: {
            monthly_forecasts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  month: { type: "string" },
                  predicted_payment: { type: "number" },
                  lower_bound: { type: "number" },
                  upper_bound: { type: "number" },
                  predicted_volume: { type: "number" },
                  confidence: { type: "number" }
                }
              }
            },
            revenue_projection: {
              type: "object",
              properties: {
                six_month_total: { type: "number" },
                best_case: { type: "number" },
                worst_case: { type: "number" },
                growth_rate: { type: "string" }
              }
            },
            regulatory_impact: {
              type: "object",
              properties: {
                upcoming_changes: { type: "array", items: { type: "string" } },
                estimated_impact: { type: "string" },
                preparation_timeline: { type: "string" }
              }
            },
            risk_factors: { type: "array", items: { type: "string" } },
            opportunities: { type: "array", items: { type: "string" } },
            strategic_recommendations: { type: "array", items: { type: "string" } }
          }
        }
      });

      setForecast(result);
    } catch (error) {
      console.error("Forecasting error:", error);
      setForecast({ error: "Failed to generate forecast. Please try again." });
    }
    setIsForecasting(false);
  };

  // Identify At-Risk Patients
  const identifyAtRiskPatients = async () => {
    if (filteredData.length < 5) return;

    setIsAnalyzingRisk(true);
    try {
      const recentAssessments = filteredData.slice(0, 50).map(u => ({
        patient_name: u.patient_name,
        patient_id: u.patient_id,
        assessment_date: u.assessment_date,
        assessment_type: u.assessment_type,
        clinical_group: u.pdgm_data?.clinical_group,
        functional_level: u.pdgm_data?.functional_level,
        primary_diagnosis: u.pdgm_data?.primary_diagnosis,
        comorbidities: u.pdgm_data?.comorbidities?.slice(0, 5),
        compliance_score: u.scores?.compliance || 0,
        overall_score: u.scores?.overall || 0,
        estimated_payment: u.estimated_payment
      }));

      const result = await invokeLLM({
        model: "claude_opus_4_8",
        prompt: `Analyze patient assessments to identify at-risk cases requiring proactive intervention.

RECENT ASSESSMENTS:
${JSON.stringify(recentAssessments.slice(0, 30))}

Identify patients at risk for:
1. Hospital readmission (based on diagnosis, functional decline, comorbidities)
2. Documentation deficiencies (low compliance scores)
3. Revenue loss (suboptimal PDGM grouping)
4. Functional deterioration (declining ADL scores)
5. Non-compliance with care plan

For each at-risk patient, provide:
- Risk category and severity level
- Specific risk factors
- Recommended interventions
- Urgency timeline`,
        response_json_schema: {
          type: "object",
          properties: {
            at_risk_patients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  patient_name: { type: "string" },
                  patient_id: { type: "string" },
                  risk_category: { type: "string" },
                  risk_level: { type: "string" },
                  risk_score: { type: "number" },
                  risk_factors: { type: "array", items: { type: "string" } },
                  recommended_interventions: { type: "array", items: { type: "string" } },
                  urgency: { type: "string" },
                  potential_impact: { type: "string" }
                }
              }
            },
            summary: {
              type: "object",
              properties: {
                total_at_risk: { type: "number" },
                critical_count: { type: "number" },
                high_count: { type: "number" },
                primary_risk_categories: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      });

      setAtRiskPatients(result);
    } catch (error) {
      console.error("Risk analysis error:", error);
      setAtRiskPatients({ error: "Failed to analyze risk. Please try again." });
    }
    setIsAnalyzingRisk(false);
  };

  // Simulate Care Pathway Impact
  const simulateCarePathway = async () => {
    if (filteredData.length < 10) return;

    setIsSimulating(true);
    try {
      const baselineMetrics = {
        avgPayment: stats.avgPayment,
        avgCaseMix: parseFloat(stats.avgCaseMix),
        avgCompliance: chartData.complianceTrend.slice(-1)[0]?.avgCompliance || 0,
        totalRevenue: stats.totalRevenue
      };

      const result = await invokeLLM({
        model: "claude_opus_4_8",
        prompt: `Simulate the impact of implementing a new care pathway on PDGM outcomes.

CURRENT BASELINE:
${JSON.stringify(baselineMetrics)}

PATHWAY CONFIGURATION:
- Pathway Type: ${simulationConfig.pathway}
- Target Group: ${simulationConfig.targetGroup}
- Interventions: ${simulationConfig.interventions}

PATIENT POPULATION:
- Total Assessments: ${stats.totalAssessments}
- Top Clinical Groups: ${chartData.groupDist.slice(0, 3).map(g => g.name).join(', ')}

Simulate impact over 6 months if this pathway is implemented:
1. Expected change in average payment
2. Expected change in case mix weights
3. Compliance improvement potential
4. Revenue projection vs baseline
5. Patient outcomes improvement
6. Resource requirements
7. ROI analysis

Provide optimistic, realistic, and conservative scenarios.`,
        response_json_schema: {
          type: "object",
          properties: {
            scenarios: {
              type: "object",
              properties: {
                optimistic: {
                  type: "object",
                  properties: {
                    avg_payment_change: { type: "string" },
                    case_mix_change: { type: "string" },
                    compliance_change: { type: "string" },
                    revenue_impact: { type: "string" },
                    probability: { type: "string" }
                  }
                },
                realistic: {
                  type: "object",
                  properties: {
                    avg_payment_change: { type: "string" },
                    case_mix_change: { type: "string" },
                    compliance_change: { type: "string" },
                    revenue_impact: { type: "string" },
                    probability: { type: "string" }
                  }
                },
                conservative: {
                  type: "object",
                  properties: {
                    avg_payment_change: { type: "string" },
                    case_mix_change: { type: "string" },
                    compliance_change: { type: "string" },
                    revenue_impact: { type: "string" },
                    probability: { type: "string" }
                  }
                }
              }
            },
            implementation_plan: {
              type: "object",
              properties: {
                timeline: { type: "string" },
                resource_requirements: { type: "array", items: { type: "string" } },
                key_milestones: { type: "array", items: { type: "string" } },
                success_metrics: { type: "array", items: { type: "string" } }
              }
            },
            roi_analysis: {
              type: "object",
              properties: {
                estimated_investment: { type: "string" },
                break_even_timeline: { type: "string" },
                year_one_roi: { type: "string" }
              }
            },
            risks_and_mitigation: { type: "array", items: { type: "object" } }
          }
        }
      });

      setPathwaySimulation(result);
    } catch (error) {
      console.error("Simulation error:", error);
      setPathwaySimulation({ error: "Failed to simulate pathway. Please try again." });
    }
    setIsSimulating(false);
  };

  const exportData = () => {
    const csv = toCsvRows([
      ['Month', 'Assessments', 'Avg Payment', 'Avg Case Mix', 'Total Revenue', 'Compliance Rate'],
      ...chartData.paymentTrend.map((d, idx) => {
        const compliance = chartData.complianceTrend[idx]?.avgCompliance || 0;
        return [d.month, d.count, d.avgPayment, d.avgCaseMix, d.total, compliance];
      })
    ]);

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PDGM_Trends_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-slate-600">Loading trend data...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* AI Forecasting Tabs */}
      <Tabs defaultValue="trends" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="trends">Trends & Analytics</TabsTrigger>
          <TabsTrigger value="forecast">AI Forecast</TabsTrigger>
          <TabsTrigger value="risk">At-Risk Patients</TabsTrigger>
          <TabsTrigger value="simulation">Pathway Simulation</TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="space-y-6 mt-6">
      {/* Header & Filters */}
      <Card className="border-2 border-blue-300">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              PDGM Trend Analysis
            </CardTitle>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFiltersVisible(!filtersVisible)}
              >
                <Filter className="w-4 h-4 mr-2" />
                Filters
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={generatePredictions}
                disabled={isPredicting || chartData.paymentTrend.length < 3}
              >
                {isPredicting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-2" />}
                Predict
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={analyzeDrivers}
                disabled={isAnalyzingDrivers || filteredData.length < 5}
              >
                {isAnalyzingDrivers ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Activity className="w-4 h-4 mr-2" />}
                Analyze Drivers
              </Button>
              <Button variant="outline" size="sm" onClick={exportData}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>

        {filtersVisible && (
          <CardContent className="border-t">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">End Date</Label>
                <Input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Clinical Group</Label>
                <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="All Groups" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Groups</SelectItem>
                    {clinicalGroups.map(group => (
                      <SelectItem key={group} value={group}>{group}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Diagnosis</Label>
                <Select value={selectedDiagnosis} onValueChange={setSelectedDiagnosis}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="All Diagnoses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Diagnoses</SelectItem>
                    {diagnoses.slice(0, 20).map(diag => (
                      <SelectItem key={diag} value={diag}>{diag}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Key Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-600">Total Assessments</p>
                <p className="text-2xl font-bold text-slate-900">{stats.totalAssessments}</p>
              </div>
              <Activity className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-600">Avg Payment</p>
                <p className="text-2xl font-bold text-green-600">${stats.avgPayment.toLocaleString()}</p>
              </div>
              <DollarSign className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-600">Avg Case Mix</p>
                <p className="text-2xl font-bold text-navy-600">{stats.avgCaseMix}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-navy-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-600">Total Revenue</p>
                <p className="text-2xl font-bold text-indigo-600">${stats.totalRevenue.toLocaleString()}</p>
              </div>
              <DollarSign className="w-8 h-8 text-indigo-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Predictions */}
      {predictions && (
        <Card className="border-2 border-navy-300 bg-gradient-to-r from-navy-50 to-gold-50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-navy-600" />
              AI Payment Predictions - Next 3 Months
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {predictions.error ? (
              <p className="text-sm text-red-600">{predictions.error}</p>
            ) : (
              <>
                <Badge className="bg-navy-600 text-white mb-2">
                  Trend: {predictions.trend_direction}
                </Badge>
                <div className="grid grid-cols-3 gap-3">
                  {predictions.predictions?.map((pred, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-lg border">
                      <p className="text-xs text-slate-500">{pred.month}</p>
                      <p className="text-xl font-bold text-navy-700">${Math.round(pred.predicted_payment).toLocaleString()}</p>
                      <p className="text-xs text-slate-600">~{pred.predicted_count} cases</p>
                      <Badge variant="outline" className="text-xs mt-1">{pred.confidence}</Badge>
                    </div>
                  ))}
                </div>
                {predictions.key_insights?.length > 0 && (
                  <div className="bg-white p-3 rounded border">
                    <p className="text-sm font-semibold text-navy-900 mb-2">Key Insights:</p>
                    <ul className="space-y-1">
                      {predictions.key_insights.map((insight, idx) => (
                        <li key={idx} className="text-sm text-navy-800">• {insight}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payment Trend with Predictions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payment Trend & Forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={[...chartData.paymentTrend, ...(predictions?.predictions?.map(p => ({
              month: p.month,
              avgPayment: p.predicted_payment,
              count: p.predicted_count,
              isPrediction: true
            })) || [])]}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value, name, props) => {
                if (name === "avgPayment") return `$${(value ?? 0).toLocaleString()}${props.payload?.isPrediction ? ' (predicted)' : ''}`;
                return value;
              }} />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="avgPayment" 
                stroke="#10b981" 
                strokeWidth={2}
                name="Avg Payment"
                strokeDasharray={(entry) => entry.isPrediction ? "5 5" : "0"}
              />
              <Line 
                type="monotone" 
                dataKey="count" 
                stroke="#3557b0" 
                strokeWidth={2}
                name="Assessments"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Compliance Rate Over Time */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">PDGM Compliance Rates</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData.complianceTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis domain={[0, 100]} />
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="avgCompliance" 
                stroke="#ef4444" 
                strokeWidth={2}
                name="Avg Compliance Score"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Key Drivers Analysis */}
      {driverAnalysis && (
        <Card className="border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-navy-50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-600" />
              Key Payment Drivers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {driverAnalysis.error ? (
              <p className="text-sm text-red-600">{driverAnalysis.error}</p>
            ) : (
              <div className="space-y-3">
                {driverAnalysis.key_drivers?.map((driver, idx) => (
                  <div key={idx} className="bg-white p-3 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold text-slate-900">{driver.driver}</p>
                      <Badge className={
                        driver.impact === 'high' ? 'bg-red-100 text-red-800' :
                        driver.impact === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-blue-100 text-blue-800'
                      }>
                        {driver.impact} impact
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className="text-sm">
                        <span className="text-slate-600">Correlation:</span>
                        <span className="ml-2 font-medium">{driver.correlation}</span>
                      </div>
                      <div className="text-sm">
                        <span className="text-slate-600">Avg Effect:</span>
                        <span className="ml-2 font-medium">{driver.average_effect}</span>
                      </div>
                    </div>
                    <div className="bg-blue-50 p-2 rounded text-sm">
                      <p className="text-blue-900">{driver.recommendation}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Case Mix Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Case Mix Weight Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData.caseMixTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="caseMix" 
                stroke="#8b5cf6" 
                strokeWidth={2}
                name="Case Mix Weight"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Distribution Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Clinical Group Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Clinical Group Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData.groupDist}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  outerRadius={80}
                  fill="#264491"
                  dataKey="value"
                >
                  {chartData.groupDist.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Functional Level Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Functional Level Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData.funcDist}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#3557b0" name="Patients" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Diagnoses */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top 10 Primary Diagnoses</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData.topDiagnoses} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={200} />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" fill="#10b981" name="Count" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
        </TabsContent>

        {/* Advanced AI Forecast Tab */}
        <TabsContent value="forecast" className="space-y-6 mt-6">
          <Card className="border-2 border-indigo-300">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-indigo-600" />
                  AI-Driven PDGM Forecast
                </CardTitle>
                <Button
                  onClick={generateAdvancedForecast}
                  disabled={isForecasting || filteredData.length < 10}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {isForecasting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Forecasting...</>
                  ) : (
                    <><Play className="w-4 h-4 mr-2" /> Generate Forecast</>
                  )}
                </Button>
              </div>
            </CardHeader>
            {forecast && !forecast.error && (
              <CardContent className="space-y-6">
                {/* Revenue Projections */}
                <div className="grid grid-cols-3 gap-4">
                  <Card className="bg-green-50 border-green-300">
                    <CardContent className="p-4">
                      <p className="text-xs text-green-600 mb-1">Best Case</p>
                      <p className="text-2xl font-bold text-green-700">
                        ${forecast.revenue_projection?.best_case?.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="bg-blue-50 border-blue-300">
                    <CardContent className="p-4">
                      <p className="text-xs text-blue-600 mb-1">Realistic</p>
                      <p className="text-2xl font-bold text-blue-700">
                        ${forecast.revenue_projection?.six_month_total?.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="bg-orange-50 border-orange-300">
                    <CardContent className="p-4">
                      <p className="text-xs text-orange-600 mb-1">Worst Case</p>
                      <p className="text-2xl font-bold text-orange-700">
                        ${forecast.revenue_projection?.worst_case?.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Monthly Forecasts Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">6-Month Payment Forecast with Confidence Intervals</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={350}>
                      <LineChart data={forecast.monthly_forecasts}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="upper_bound" stroke="#10b981" strokeDasharray="3 3" name="Upper Bound" />
                        <Line type="monotone" dataKey="predicted_payment" stroke="#3557b0" strokeWidth={3} name="Predicted Payment" />
                        <Line type="monotone" dataKey="lower_bound" stroke="#ef4444" strokeDasharray="3 3" name="Lower Bound" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Regulatory Impact */}
                <Card className="border-2 border-amber-300 bg-amber-50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                      Regulatory Impact Assessment
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-900 mb-2">Upcoming Changes:</p>
                      <ul className="space-y-1">
                        {forecast.regulatory_impact?.upcoming_changes?.map((change, idx) => (
                          <li key={idx} className="text-sm text-amber-800">• {change}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-white p-3 rounded border">
                      <p className="text-sm"><strong>Estimated Impact:</strong> {forecast.regulatory_impact?.estimated_impact}</p>
                      <p className="text-sm mt-1"><strong>Preparation Timeline:</strong> {forecast.regulatory_impact?.preparation_timeline}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Opportunities & Risks */}
                <div className="grid grid-cols-2 gap-4">
                  <Card className="border-green-300">
                    <CardHeader>
                      <CardTitle className="text-sm text-green-700">Opportunities</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {forecast.opportunities?.map((opp, idx) => (
                          <li key={idx} className="text-sm text-green-900 flex items-start gap-2">
                            <span className="text-green-600">✓</span>
                            {opp}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card className="border-red-300">
                    <CardHeader>
                      <CardTitle className="text-sm text-red-700">Risk Factors</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {forecast.risk_factors?.map((risk, idx) => (
                          <li key={idx} className="text-sm text-red-900 flex items-start gap-2">
                            <span className="text-red-600">⚠</span>
                            {risk}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>

                {/* Strategic Recommendations */}
                <Card className="border-2 border-navy-300 bg-navy-50">
                  <CardHeader>
                    <CardTitle className="text-lg text-navy-900">Strategic Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ol className="space-y-2">
                      {forecast.strategic_recommendations?.map((rec, idx) => (
                        <li key={idx} className="text-sm text-navy-900 flex items-start gap-2">
                          <span className="bg-navy-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs flex-shrink-0">
                            {idx + 1}
                          </span>
                          {rec}
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              </CardContent>
            )}
            {forecast?.error && (
              <CardContent>
                <Alert className="bg-red-50 border-red-200">
                  <AlertDescription className="text-red-800">{forecast.error}</AlertDescription>
                </Alert>
              </CardContent>
            )}
          </Card>
        </TabsContent>

        {/* At-Risk Patients Tab */}
        <TabsContent value="risk" className="space-y-6 mt-6">
          <Card className="border-2 border-red-300">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  At-Risk Patient Identification
                </CardTitle>
                <Button
                  onClick={identifyAtRiskPatients}
                  disabled={isAnalyzingRisk || filteredData.length < 5}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {isAnalyzingRisk ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
                  ) : (
                    <><Play className="w-4 h-4 mr-2" /> Identify At-Risk Patients</>
                  )}
                </Button>
              </div>
            </CardHeader>
            {atRiskPatients && !atRiskPatients.error && (
              <CardContent className="space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <Card className="bg-red-50 border-red-300">
                    <CardContent className="p-4">
                      <p className="text-xs text-red-600 mb-1">Critical Risk</p>
                      <p className="text-3xl font-bold text-red-700">{atRiskPatients.summary?.critical_count || 0}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-orange-50 border-orange-300">
                    <CardContent className="p-4">
                      <p className="text-xs text-orange-600 mb-1">High Risk</p>
                      <p className="text-3xl font-bold text-orange-700">{atRiskPatients.summary?.high_count || 0}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-yellow-50 border-yellow-300">
                    <CardContent className="p-4">
                      <p className="text-xs text-yellow-600 mb-1">Total At-Risk</p>
                      <p className="text-3xl font-bold text-yellow-700">{atRiskPatients.summary?.total_at_risk || 0}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* At-Risk Patients List */}
                <div className="space-y-3">
                  {atRiskPatients.at_risk_patients?.map((patient, idx) => (
                    <Card key={idx} className={`border-2 ${
                      patient.risk_level === 'critical' ? 'border-red-400 bg-red-50' :
                      patient.risk_level === 'high' ? 'border-orange-400 bg-orange-50' :
                      'border-yellow-400 bg-yellow-50'
                    }`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-semibold text-slate-900">{patient.patient_name}</p>
                            <p className="text-xs text-slate-600">ID: {patient.patient_id}</p>
                          </div>
                          <div className="text-right">
                            <Badge className={`${
                              patient.risk_level === 'critical' ? 'bg-red-600' :
                              patient.risk_level === 'high' ? 'bg-orange-600' :
                              'bg-yellow-600'
                            } text-white`}>
                              {patient.risk_level} - {patient.risk_score}%
                            </Badge>
                            <p className="text-xs text-slate-600 mt-1">{patient.urgency}</p>
                          </div>
                        </div>

                        <div className="mb-3">
                          <p className="text-sm font-semibold text-slate-700 mb-1">Risk Category: {patient.risk_category}</p>
                          <p className="text-xs text-slate-600">{patient.potential_impact}</p>
                        </div>

                        <div className="bg-white p-2 rounded border mb-2">
                          <p className="text-xs font-semibold text-slate-700 mb-1">Risk Factors:</p>
                          <ul className="space-y-0.5">
                            {patient.risk_factors?.map((factor, fIdx) => (
                              <li key={fIdx} className="text-xs text-slate-800">• {factor}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="bg-blue-50 p-2 rounded border">
                          <p className="text-xs font-semibold text-blue-700 mb-1">Recommended Interventions:</p>
                          <ul className="space-y-0.5">
                            {patient.recommended_interventions?.map((int, iIdx) => (
                              <li key={iIdx} className="text-xs text-blue-900">→ {int}</li>
                            ))}
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            )}
            {atRiskPatients?.error && (
              <CardContent>
                <Alert className="bg-red-50 border-red-200">
                  <AlertDescription className="text-red-800">{atRiskPatients.error}</AlertDescription>
                </Alert>
              </CardContent>
            )}
          </Card>
        </TabsContent>

        {/* Pathway Simulation Tab */}
        <TabsContent value="simulation" className="space-y-6 mt-6">
          <Card className="border-2 border-navy-300">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-navy-600" />
                Care Pathway Impact Simulation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Simulation Configuration */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs">Pathway Type</Label>
                  <Select
                    value={simulationConfig.pathway}
                    onValueChange={(v) => setSimulationConfig(prev => ({ ...prev, pathway: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard Care</SelectItem>
                      <SelectItem value="intensive">Intensive Support</SelectItem>
                      <SelectItem value="preventive">Preventive Care</SelectItem>
                      <SelectItem value="transitional">Transitional Care</SelectItem>
                      <SelectItem value="chronic_disease">Chronic Disease Management</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Target Group</Label>
                  <Select
                    value={simulationConfig.targetGroup}
                    onValueChange={(v) => setSimulationConfig(prev => ({ ...prev, targetGroup: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Patients</SelectItem>
                      <SelectItem value="high_risk">High Risk Only</SelectItem>
                      <SelectItem value="specific_dx">Specific Diagnosis</SelectItem>
                      <SelectItem value="low_compliance">Low Compliance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Button
                    onClick={simulateCarePathway}
                    disabled={isSimulating || filteredData.length < 10}
                    className="w-full mt-5 bg-navy-600 hover:bg-navy-700"
                  >
                    {isSimulating ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Simulating...</>
                    ) : (
                      <><Play className="w-4 h-4 mr-2" /> Run Simulation</>
                    )}
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs">Specific Interventions (Optional)</Label>
                <Textarea
                  value={simulationConfig.interventions}
                  onChange={(e) => setSimulationConfig(prev => ({ ...prev, interventions: e.target.value }))}
                  placeholder="e.g., Weekly PT visits, medication management protocol, fall prevention program..."
                  className="h-20"
                />
              </div>

              {/* Simulation Results */}
              {pathwaySimulation && !pathwaySimulation.error && (
                <div className="space-y-4 mt-6">
                  {/* Scenario Comparison */}
                  <div className="grid grid-cols-3 gap-4">
                    {['optimistic', 'realistic', 'conservative'].map((scenario) => (
                      <Card key={scenario} className={`border-2 ${
                        scenario === 'optimistic' ? 'border-green-300 bg-green-50' :
                        scenario === 'realistic' ? 'border-blue-300 bg-blue-50' :
                        'border-orange-300 bg-orange-50'
                      }`}>
                        <CardHeader>
                          <CardTitle className="text-sm capitalize">{scenario} Scenario</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div className="text-sm">
                            <p className="text-xs text-slate-600">Payment Change</p>
                            <p className="font-bold">{pathwaySimulation.scenarios?.[scenario]?.avg_payment_change}</p>
                          </div>
                          <div className="text-sm">
                            <p className="text-xs text-slate-600">Case Mix Change</p>
                            <p className="font-bold">{pathwaySimulation.scenarios?.[scenario]?.case_mix_change}</p>
                          </div>
                          <div className="text-sm">
                            <p className="text-xs text-slate-600">Revenue Impact</p>
                            <p className="font-bold">{pathwaySimulation.scenarios?.[scenario]?.revenue_impact}</p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {pathwaySimulation.scenarios?.[scenario]?.probability} probability
                          </Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Implementation Plan */}
                  <Card className="border-2 border-indigo-300">
                    <CardHeader>
                      <CardTitle className="text-lg">Implementation Plan</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <p className="text-sm font-semibold mb-1">Timeline: {pathwaySimulation.implementation_plan?.timeline}</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold mb-1">Resource Requirements:</p>
                        <ul className="text-sm space-y-1">
                          {pathwaySimulation.implementation_plan?.resource_requirements?.map((req, idx) => (
                            <li key={idx}>• {req}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-sm font-semibold mb-1">Key Milestones:</p>
                        <ul className="text-sm space-y-1">
                          {pathwaySimulation.implementation_plan?.key_milestones?.map((milestone, idx) => (
                            <li key={idx}>✓ {milestone}</li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>

                  {/* ROI Analysis */}
                  <Card className="border-2 border-green-300 bg-green-50">
                    <CardHeader>
                      <CardTitle className="text-lg text-green-900">ROI Analysis</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-green-600">Investment</p>
                        <p className="text-lg font-bold text-green-700">{pathwaySimulation.roi_analysis?.estimated_investment}</p>
                      </div>
                      <div>
                        <p className="text-xs text-green-600">Break-Even</p>
                        <p className="text-lg font-bold text-green-700">{pathwaySimulation.roi_analysis?.break_even_timeline}</p>
                      </div>
                      <div>
                        <p className="text-xs text-green-600">Year 1 ROI</p>
                        <p className="text-lg font-bold text-green-700">{pathwaySimulation.roi_analysis?.year_one_roi}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
              {pathwaySimulation?.error && (
                <Alert className="bg-red-50 border-red-200">
                  <AlertDescription className="text-red-800">{pathwaySimulation.error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}