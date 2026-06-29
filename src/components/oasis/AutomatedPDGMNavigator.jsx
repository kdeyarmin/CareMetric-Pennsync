import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { buildPdgmNavigatorCsv } from "./pdgmNavigatorExport";
import { getConfidenceBadge, getSeverityBadge, getPriorityColor, getLevelColor, formatCurrency } from "./pdgmNavigatorHelpers";
import { resolveAgencyCosts } from "./pdgmFinancialEngine";
import { buildNavigationRequest, buildFinancialPredictionRequest, buildResolutionWorkflowRequest } from "./pdgmNavigatorPrompts";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Navigation,
  DollarSign,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Info,
  Stethoscope,
  Activity,
  Building2,
  Clock,
  FileText,
  TrendingUp,
  Calculator,
  Target,
  Lightbulb,
  ChevronRight,
  Settings,
  FileJson,
  FileDown,
  FileSpreadsheet, BarChart3, ExternalLink, BookOpen } from "lucide-react";
import PDGMAnalyticsDashboard from "./PDGMAnalyticsDashboard";
import PDGMScenarioModeler from "./PDGMScenarioModeler";
import AIGroupAssignmentValidator from "./AIGroupAssignmentValidator";


export default function AutomatedPDGMNavigator({ analysisResults, pdgmData, revenueData, onNavigationComplete }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [navigation, setNavigation] = useState(null);
  const [error, setError] = useState(null);
  const [autoAnalyzed, setAutoAnalyzed] = useState(false);
  const [resolutionWorkflows, setResolutionWorkflows] = useState({});
  const [loadingResolution, setLoadingResolution] = useState(null);
  const [financialPredictions, setFinancialPredictions] = useState({});
  const [loadingPrediction, setLoadingPrediction] = useState(null);
  const [_showCostSettings, _setShowCostSettings] = useState(false);
  const [patientForecasts, setPatientForecasts] = useState(null);
  const [isLoadingForecasts, setIsLoadingForecasts] = useState(false);
  
  // Fetch agency settings for cost analysis
  const { data: agencySettings } = useQuery({
    queryKey: ['agencySettings'],
    queryFn: async () => {
      const result = await base44.entities.AgencySettings.list();
      return result[0] || null;
    }
  });

  const agencyCosts = resolveAgencyCosts(agencySettings);

  const runPDGMNavigation = useCallback(async () => {
    if (!pdgmData) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const result = await invokeLLM(buildNavigationRequest({ pdgmData, analysisResults, revenueData }));

      setNavigation(result);
      
      // Notify parent of navigation completion
      if (onNavigationComplete) {
        onNavigationComplete(result);
      }
    } catch (err) {
      console.error("PDGM Navigation error:", err);
      setError("Failed to analyze PDGM grouping. Please try again.");
    }

    setIsAnalyzing(false);
  }, [pdgmData, analysisResults, revenueData, onNavigationComplete]);

  // Auto-analyze when data is available
  useEffect(() => {
    if (pdgmData && !navigation && !isAnalyzing && !autoAnalyzed) {
      runPDGMNavigation();
      setAutoAnalyzed(true);
    }
  }, [pdgmData, navigation, isAnalyzing, autoAnalyzed, runPDGMNavigation]);

  const exportJSON = () => {
    const exportData = {
      navigation_analysis: navigation,
      financial_predictions: financialPredictions,
      resolution_workflows: resolutionWorkflows,
      pdgm_data: pdgmData,
      analysis_results: analysisResults,
      export_date: new Date().toISOString()
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PDGM_Navigator_Analysis_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    if (!navigation) return;

    // Row layout + escaping extracted to a tested util that also neutralizes
    // CSV formula injection (the findings/recommendations are AI-generated text).
    const csvContent = buildPdgmNavigatorCsv(navigation);

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PDGM_Navigator_Report_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getFinancialPrediction = async (item, index, type = 'discrepancy') => {
    setLoadingPrediction(index);
    
    try {
      const result = await invokeLLM(buildFinancialPredictionRequest({ item, type, revenueData, navigation, agencyCosts }));

      setFinancialPredictions(prev => ({
        ...prev,
        [index]: result
      }));
    } catch (err) {
      console.error("Financial prediction error:", err);
      setFinancialPredictions(prev => ({
        ...prev,
        [index]: { error: "Failed to generate financial prediction. Please try again." }
      }));
    }
    
    setLoadingPrediction(null);
  };

  const getResolutionWorkflow = async (discrepancy, index) => {
    setLoadingResolution(index);
    
    try {
      const result = await invokeLLM(buildResolutionWorkflowRequest({ discrepancy, pdgmData }));

      setResolutionWorkflows(prev => ({
        ...prev,
        [index]: result
      }));
    } catch (err) {
      console.error("Resolution workflow error:", err);
      setResolutionWorkflows(prev => ({
        ...prev,
        [index]: { error: "Failed to generate resolution workflow. Please try again." }
      }));
    }
    
    setLoadingResolution(null);
  };

  const [isExporting, setIsExporting] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Fetch historical patient data for forecasting
  const { data: _patientHistory = [] } = useQuery({
    queryKey: ['patientOasisHistory', pdgmData?.patient_info?.name],
    queryFn: async () => {
      if (!pdgmData?.patient_info?.name) return [];
      return await base44.entities.OASISUpload.filter({}, '-created_date', 10);
    },
    enabled: !!pdgmData
  });

  const { data: allPatients = [] } = useQuery({
    queryKey: ['patientsForForecasting'],
    queryFn: () => base44.entities.Patient.list('-created_date', 100),
  });

  const generatePatientForecasts = useCallback(async () => {
    if (!navigation || !pdgmData) return;

    setIsLoadingForecasts(true);
    try {
      // Get historical trends from similar patients
      const similarPatients = allPatients.filter(p => 
        p.primary_diagnosis?.toLowerCase().includes(pdgmData.primary_diagnosis?.toLowerCase().split(' ')[0]) ||
        p.status === 'active'
      ).slice(0, 20);

      const historicalTrends = {
        avgHospitalizations: similarPatients.reduce((sum, p) => 
          sum + (p.past_hospitalizations?.length || 0), 0) / Math.max(similarPatients.length, 1),
        avgLengthOfStay: 45, // Default average
        avgFunctionalImprovement: 0.15 // 15% improvement average
      };

      const prompt = `You are a predictive analytics expert in home health. Forecast patient outcomes based on current OASIS data and historical trends.

CURRENT PATIENT DATA:
${JSON.stringify({
  primary_diagnosis: pdgmData.primary_diagnosis,
  functional_level: navigation.functional_level?.level,
  functional_points: navigation.functional_level?.total_points,
  comorbidities: pdgmData.comorbidities?.slice(0, 5),
  admission_source: navigation.admission_timing?.admission_source,
  episode_timing: navigation.admission_timing?.episode_timing,
  clinical_group: navigation.clinical_group?.group_name
}, null, 2)}

HISTORICAL TRENDS (Agency Data):
- Average hospitalizations for similar patients: ${historicalTrends.avgHospitalizations.toFixed(2)}
- Average length of stay: ${historicalTrends.avgLengthOfStay} days
- Average functional improvement: ${(historicalTrends.avgFunctionalImprovement * 100).toFixed(0)}%
- Similar patient count: ${similarPatients.length}

OASIS FUNCTIONAL SCORES:
${JSON.stringify(pdgmData.functional_scores, null, 2)}

CLINICAL STATUS:
${JSON.stringify(pdgmData.clinical_items, null, 2)}

PREDICT:
1. READMISSION RISK (30-day, 60-day)
   - Calculate risk score (0-100)
   - Identify top risk factors
   - Provide preventive interventions
   - Estimate cost of readmission

2. LENGTH OF STAY
   - Predict expected LOS in days
   - Compare to agency average
   - Identify factors influencing duration
   - Provide care plan recommendations

3. FUNCTIONAL OUTCOMES
   - Predict improvement trajectory
   - Expected discharge functional status
   - Timeline to goals
   - Interventions to optimize outcomes

4. RESOURCE ALLOCATION
   - Predicted visit frequency needed
   - Therapy service recommendations
   - Nursing intensity level
   - Estimated total care hours

5. QUALITY MEASURES PERFORMANCE
   - Likelihood of improvement in key measures
   - Risk of decline in functional status
   - Patient satisfaction predictors

6. CARE PLANNING INSIGHTS
   - High-priority interventions
   - Timeline for key milestones
   - Resource optimization opportunities`;

      const result = await invokeLLM({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            readmission_risk: {
              type: "object",
              properties: {
                thirty_day_risk_score: { type: "number" },
                sixty_day_risk_score: { type: "number" },
                risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
                top_risk_factors: { type: "array", items: { type: "string" } },
                preventive_interventions: { type: "array", items: { type: "string" } },
                estimated_readmission_cost: { type: "number" },
                monitoring_recommendations: { type: "array", items: { type: "string" } }
              }
            },
            length_of_stay: {
              type: "object",
              properties: {
                predicted_days: { type: "number" },
                confidence_range: { type: "string" },
                compared_to_average: { type: "string" },
                influencing_factors: { type: "array", items: { type: "string" } },
                care_plan_recommendations: { type: "array", items: { type: "string" } },
                efficiency_opportunities: { type: "array", items: { type: "string" } }
              }
            },
            functional_outcomes: {
              type: "object",
              properties: {
                expected_improvement_percentage: { type: "number" },
                discharge_functional_level: { type: "string" },
                timeline_to_goals: { type: "string" },
                key_interventions: { type: "array", items: { type: "string" } },
                barriers_to_improvement: { type: "array", items: { type: "string" } },
                success_probability: { type: "number" }
              }
            },
            resource_allocation: {
              type: "object",
              properties: {
                predicted_weekly_visits: { type: "number" },
                skilled_nursing_visits: { type: "number" },
                pt_sessions_recommended: { type: "number" },
                ot_sessions_recommended: { type: "number" },
                nursing_intensity: { type: "string", enum: ["low", "moderate", "high", "very_high"] },
                total_care_hours_estimate: { type: "number" },
                resource_optimization_tips: { type: "array", items: { type: "string" } }
              }
            },
            quality_measures_forecast: {
              type: "object",
              properties: {
                improvement_in_ambulation_likelihood: { type: "number" },
                improvement_in_bathing_likelihood: { type: "number" },
                improvement_in_transferring_likelihood: { type: "number" },
                decline_risk_areas: { type: "array", items: { type: "string" } },
                patient_satisfaction_predictors: { type: "array", items: { type: "string" } }
              }
            },
            care_planning_insights: {
              type: "object",
              properties: {
                high_priority_interventions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      intervention: { type: "string" },
                      timeframe: { type: "string" },
                      expected_outcome: { type: "string" },
                      resource_needs: { type: "string" }
                    }
                  }
                },
                key_milestones: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      milestone: { type: "string" },
                      target_date: { type: "string" },
                      success_criteria: { type: "string" }
                    }
                  }
                },
                cost_efficiency_tips: { type: "array", items: { type: "string" } }
              }
            },
            overall_prognosis: { type: "string" },
            confidence_level: { type: "string", enum: ["high", "moderate", "low"] }
          }
        }
      });

      setPatientForecasts(result);
    } catch (error) {
      console.error('Forecasting error:', error);
    }
    setIsLoadingForecasts(false);
  }, [navigation, pdgmData, allPatients]);

  // Auto-generate forecasts when navigation completes
  useEffect(() => {
    if (navigation && !patientForecasts && !isLoadingForecasts) {
      generatePatientForecasts();
    }
  }, [navigation, patientForecasts, isLoadingForecasts, generatePatientForecasts]);

  const exportPDF = async () => {
    if (!navigation) return;

    setIsExporting(true);
    try {
      const { generatePDGMNavigatorPDF } = await import('@/functions/generatePDGMNavigatorPDF');
      
      const response = await generatePDGMNavigatorPDF({
        navigationData: navigation,
        pdgmData: pdgmData,
        patientName: pdgmData?.patient_info?.name || 'Unknown Patient'
      });

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PDGM_Navigator_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error("PDF export error:", err);
    }
    setIsExporting(false);
  };

  if (!pdgmData) {
    return (
      <Card className="border-2 border-slate-200">
        <CardContent className="p-6 text-center text-slate-500">
          <Navigation className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Upload and analyze an OASIS document to use the PDGM Navigator</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-navy-50 to-blue-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Navigation className="w-5 h-5 text-navy-600" />
            Automated PDGM Navigator
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2"
              onClick={() => window.location.href = '/agency-settings'}
            >
              <Settings className="w-3 h-3" />
              Agency Settings
              <ExternalLink className="w-3 h-3" />
            </Button>
            {navigation?.summary?.payment_amount && (
              <Badge className="bg-green-600 text-white text-lg px-3 py-1">
                {formatCurrency(navigation.summary.payment_amount)}
              </Badge>
            )}
            {navigation && (
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setShowAnalytics(!showAnalytics)}
                  size="sm"
                  variant={showAnalytics ? "default" : "outline"}
                  className="gap-2"
                >
                  <BarChart3 className="w-3 h-3" />
                  Analytics
                </Button>
                <Button
                  onClick={exportJSON}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  <FileJson className="w-3 h-3" />
                  JSON
                </Button>
                <Button
                  onClick={exportCSV}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  CSV
                </Button>
                <Button
                  onClick={exportPDF}
                  disabled={isExporting}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  {isExporting ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> PDF</>
                  ) : (
                    <><FileDown className="w-3 h-3" /> PDF</>
                  )}
                </Button>
              </div>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {isAnalyzing ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-navy-600 mx-auto mb-3" />
            <p className="text-sm text-slate-600">Analyzing PDGM grouping and calculating payment...</p>
            <p className="text-xs text-slate-400 mt-1">Evaluating clinical group, functional level, comorbidities, and timing</p>
          </div>
        ) : !navigation ? (
          <Button
            onClick={runPDGMNavigation}
            className="w-full bg-navy-600 hover:bg-navy-700"
          >
            <Navigation className="w-4 h-4 mr-2" /> Analyze PDGM Grouping
          </Button>
        ) : (
          <>
            {/* Analytics Dashboard */}
            {showAnalytics && (
              <div className="mb-6">
                <PDGMAnalyticsDashboard />
              </div>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Clinical Group */}
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center gap-1 mb-1">
                  <Stethoscope className="w-3 h-3 text-blue-600" />
                  <span className="text-xs text-blue-600 font-medium">Clinical Group</span>
                </div>
                <p className="text-sm font-bold text-blue-900 truncate" title={navigation.clinical_group?.group_name}>
                  {navigation.clinical_group?.group_name || 'Unknown'}
                </p>
                <Badge className={`text-xs mt-1 ${getConfidenceBadge(navigation.clinical_group?.confidence)}`}>
                  {navigation.clinical_group?.confidence} confidence
                </Badge>
              </div>

              {/* Functional Level */}
              <div className="p-3 bg-navy-50 rounded-lg border border-navy-200">
                <div className="flex items-center gap-1 mb-1">
                  <Activity className="w-3 h-3 text-navy-600" />
                  <span className="text-xs text-navy-600 font-medium">Functional Level</span>
                </div>
                <p className="text-sm font-bold text-navy-900 capitalize">
                  {navigation.functional_level?.level || 'Unknown'}
                </p>
                <p className="text-xs text-navy-600">
                  {navigation.functional_level?.total_points || 0} points
                </p>
              </div>

              {/* Admission/Timing */}
              <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                <div className="flex items-center gap-1 mb-1">
                  <Building2 className="w-3 h-3 text-orange-600" />
                  <span className="text-xs text-orange-600 font-medium">Source/Timing</span>
                </div>
                <p className="text-sm font-bold text-orange-900 capitalize">
                  {navigation.admission_timing?.admission_source || 'Unknown'}
                </p>
                <p className="text-xs text-orange-600 capitalize">
                  {navigation.admission_timing?.episode_timing || 'Unknown'} Episode
                </p>
              </div>

              {/* Comorbidity */}
              <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-1 mb-1">
                  <FileText className="w-3 h-3 text-green-600" />
                  <span className="text-xs text-green-600 font-medium">Comorbidity Adj.</span>
                </div>
                <p className="text-sm font-bold text-green-900 capitalize">
                  {navigation.comorbidity_adjustment?.level || 'None'}
                </p>
                <p className="text-xs text-green-600">
                  {navigation.comorbidity_adjustment?.high_value_count || 0} high-value
                </p>
              </div>
            </div>

            {/* Case-Mix Calculation Breakdown */}
            {navigation.case_mix_calculation && (
              <div className="bg-gradient-to-r from-indigo-50 to-navy-50 p-4 rounded-lg border border-indigo-200">
                <h3 className="font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  Case-Mix Payment Calculation
                </h3>
                
                {/* Visual Payment Flow */}
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4 text-center">
                  <div className="bg-white p-2 rounded border min-w-[80px]">
                    <p className="text-xs text-slate-500">Base</p>
                    <p className="font-bold text-indigo-700">{formatCurrency(navigation.case_mix_calculation.base_payment)}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                  <div className="bg-white p-2 rounded border min-w-[80px]">
                    <p className="text-xs text-slate-500">Clinical</p>
                    <p className="font-bold text-blue-600">×{navigation.case_mix_calculation.clinical_weight?.toFixed(4)}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                  <div className="bg-white p-2 rounded border min-w-[80px]">
                    <p className="text-xs text-slate-500">Functional</p>
                    <p className="font-bold text-navy-600">×{navigation.case_mix_calculation.functional_multiplier?.toFixed(2)}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                  <div className="bg-white p-2 rounded border min-w-[80px]">
                    <p className="text-xs text-slate-500">Comorbidity</p>
                    <p className="font-bold text-green-600">×{navigation.case_mix_calculation.comorbidity_multiplier?.toFixed(3)}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                  <div className="bg-green-100 p-2 rounded border-2 border-green-400 min-w-[100px]">
                    <p className="text-xs text-green-600">Payment</p>
                    <p className="font-bold text-green-700 text-lg">{formatCurrency(navigation.case_mix_calculation.calculated_payment)}</p>
                  </div>
                </div>

                {/* Case-Mix Weight */}
                <div className="bg-white p-3 rounded border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700">Final Case-Mix Weight</span>
                    <span className="text-lg font-bold text-indigo-700">
                      {navigation.case_mix_calculation.final_case_mix_weight?.toFixed(4)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Source/Timing: <span className="font-mono">{navigation.case_mix_calculation.source_timing_key}</span>
                  </p>
                  {agencyCosts.wage_index && agencyCosts.wage_index !== 1.0 && (
                    <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                      <Info className="w-3 h-3" />
                      Wage Index: {agencyCosts.wage_index.toFixed(4)} applied
                    </p>
                  )}
                </div>

                {/* Calculation Steps */}
                {navigation.case_mix_calculation.calculation_steps?.length > 0 && (
                  <div className="mt-3 text-xs text-indigo-700 space-y-1">
                    {navigation.case_mix_calculation.calculation_steps.map((step, i) => (
                      <p key={i} className="flex items-start gap-1">
                        <span className="font-bold">{i + 1}.</span> {step}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Detailed Breakdown Accordion */}
            <Accordion type="multiple" className="space-y-2">
              {/* Clinical Group Details */}
              <AccordionItem value="clinical" className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline bg-blue-50 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <Stethoscope className="w-4 h-4 text-blue-600" />
                    <span className="font-medium text-blue-800">Clinical Group Details</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2">
                  <div className="space-y-3">
                    <div className="bg-blue-50 p-3 rounded border border-blue-200">
                      <p className="text-xs text-slate-500 mb-1">Assigned Group</p>
                      <p className="font-semibold text-blue-900">{navigation.clinical_group?.group_name}</p>
                      <p className="text-xs text-slate-600 mt-1">{navigation.clinical_group?.rationale}</p>
                    </div>
                    
                    <div className="bg-white p-3 rounded border">
                      <p className="text-xs font-medium text-slate-700 mb-1">ICD-10 Mapping Basis</p>
                      <p className="text-sm text-slate-800">{navigation.clinical_group?.icd10_basis}</p>
                    </div>

                    {navigation.clinical_group?.alternative_groups?.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-slate-700 mb-2">Alternative Groups (if documentation changes)</p>
                        {navigation.clinical_group.alternative_groups.map((alt, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs bg-slate-50 p-2 rounded mb-1">
                            <Badge variant="outline">{alt.group}</Badge>
                            <span className="text-slate-600">if {alt.if_condition}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {navigation.clinical_group?.potential_issues?.length > 0 && (
                      <Alert className="bg-yellow-50 border-yellow-200">
                        <AlertTriangle className="w-4 h-4 text-yellow-600" />
                        <AlertDescription className="text-yellow-800 text-xs">
                          <strong>Potential Issues:</strong>
                          <ul className="mt-1 space-y-1">
                            {navigation.clinical_group.potential_issues.map((issue, i) => (
                              <li key={i}>• {issue}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Functional Level Details */}
              <AccordionItem value="functional" className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline bg-navy-50 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-navy-600" />
                    <span className="font-medium text-navy-800">Functional Impairment Breakdown</span>
                    <Badge className={`ml-2 ${getLevelColor(navigation.functional_level?.level)}`}>
                      {navigation.functional_level?.total_points} pts = {navigation.functional_level?.level}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2">
                  <div className="space-y-3">
                    {/* Point Breakdown Table */}
                    <div className="border rounded overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>M-Item</TableHead>
                            <TableHead className="text-center">Score</TableHead>
                            <TableHead className="text-center">Max</TableHead>
                            <TableHead>Contribution</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {navigation.functional_level?.point_breakdown &&
                            Object.entries(navigation.functional_level.point_breakdown).map(([key, data]) => (
                              <TableRow key={key}>
                                <TableCell className="font-mono text-navy-700">{key.toUpperCase().replace('_', ' ')}</TableCell>
                                <TableCell className="text-center font-bold">{data.score}</TableCell>
                                <TableCell className="text-center text-slate-500">{data.max}</TableCell>
                                <TableCell className="text-slate-600">{data.contribution}</TableCell>
                              </TableRow>
                            ))
                          }
                          <TableRow className="bg-navy-50 hover:bg-navy-50">
                            <TableCell className="font-semibold">Total</TableCell>
                            <TableCell className="text-center font-bold text-navy-700">
                              {navigation.functional_level?.total_points}
                            </TableCell>
                            <TableCell className="text-center text-slate-500">30</TableCell>
                            <TableCell></TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>

                    <div className="bg-slate-50 p-3 rounded border text-xs">
                      <p className="font-medium text-slate-700 mb-1">Threshold Used</p>
                      <p className="text-slate-600">{navigation.functional_level?.threshold_used}</p>
                    </div>

                    <div className="bg-navy-50 p-3 rounded border border-navy-200 text-xs">
                      <p className="font-medium text-navy-700 mb-1">Level Driver</p>
                      <p className="text-navy-800">{navigation.functional_level?.level_driver}</p>
                    </div>

                    {navigation.functional_level?.optimization_opportunities?.length > 0 && (
                      <div className="bg-green-50 p-3 rounded border border-green-200">
                        <p className="text-xs font-medium text-green-700 mb-1 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" /> Optimization Opportunities
                        </p>
                        <ul className="text-xs text-green-800 space-y-1">
                          {navigation.functional_level.optimization_opportunities.map((opp, i) => (
                            <li key={i}>• {opp}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Comorbidity Details */}
              <AccordionItem value="comorbidity" className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline bg-green-50 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-green-600" />
                    <span className="font-medium text-green-800">Comorbidity Analysis</span>
                    <Badge className={`ml-2 ${getLevelColor(navigation.comorbidity_adjustment?.level === 'high' ? 'high' : navigation.comorbidity_adjustment?.level === 'low' ? 'medium' : 'low')}`}>
                      {navigation.comorbidity_adjustment?.level} adjustment
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2">
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-slate-50 p-2 rounded border">
                        <p className="text-xs text-slate-500">Total</p>
                        <p className="text-lg font-bold">{navigation.comorbidity_adjustment?.total_comorbidities || 0}</p>
                      </div>
                      <div className="bg-green-50 p-2 rounded border border-green-200">
                        <p className="text-xs text-green-600">High-Value</p>
                        <p className="text-lg font-bold text-green-700">{navigation.comorbidity_adjustment?.high_value_count || 0}</p>
                      </div>
                      <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                        <p className="text-xs text-yellow-600">Medium-Value</p>
                        <p className="text-lg font-bold text-yellow-700">{navigation.comorbidity_adjustment?.medium_value_count || 0}</p>
                      </div>
                    </div>

                    {navigation.comorbidity_adjustment?.high_value_conditions?.length > 0 && (
                      <div className="bg-green-50 p-3 rounded border border-green-200">
                        <p className="text-xs font-medium text-green-700 mb-1">High-Value Conditions (Increase Payment)</p>
                        <div className="flex flex-wrap gap-1">
                          {navigation.comorbidity_adjustment.high_value_conditions.map((c, i) => (
                            <Badge key={i} className="bg-green-200 text-green-800 text-xs">{c}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {navigation.comorbidity_adjustment?.missing_opportunities?.length > 0 && (
                      <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                        <p className="text-xs font-medium text-yellow-700 mb-1 flex items-center gap-1">
                          <Lightbulb className="w-3 h-3" /> Missing Documentation Opportunities
                        </p>
                        <ul className="text-xs text-yellow-800 space-y-1">
                          {navigation.comorbidity_adjustment.missing_opportunities.map((opp, i) => (
                            <li key={i}>• {opp}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded">
                      {navigation.comorbidity_adjustment?.rationale}
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Admission/Timing Details */}
              <AccordionItem value="timing" className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline bg-orange-50 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-600" />
                    <span className="font-medium text-orange-800">Admission Source & Episode Timing</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-orange-50 p-3 rounded border border-orange-200">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-orange-600">Admission Source</span>
                          <Badge className={getConfidenceBadge(navigation.admission_timing?.admission_source_confidence)}>
                            {navigation.admission_timing?.admission_source_confidence}
                          </Badge>
                        </div>
                        <p className="font-semibold text-orange-900 capitalize">
                          {navigation.admission_timing?.admission_source}
                        </p>
                        <p className="text-xs text-slate-600 mt-1">
                          {navigation.admission_timing?.admission_source_evidence}
                        </p>
                      </div>

                      <div className="bg-blue-50 p-3 rounded border border-blue-200">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-blue-600">Episode Timing</span>
                          <Badge className={getConfidenceBadge(navigation.admission_timing?.episode_timing_confidence)}>
                            {navigation.admission_timing?.episode_timing_confidence}
                          </Badge>
                        </div>
                        <p className="font-semibold text-blue-900 capitalize">
                          {navigation.admission_timing?.episode_timing}
                        </p>
                        <p className="text-xs text-slate-600 mt-1">
                          {navigation.admission_timing?.episode_timing_evidence}
                        </p>
                      </div>
                    </div>

                    {navigation.admission_timing?.m0110_value && (
                      <div className="bg-slate-50 p-2 rounded border text-xs">
                        <span className="text-slate-500">M0110 Value: </span>
                        <span className="font-mono font-medium">{navigation.admission_timing.m0110_value}</span>
                      </div>
                    )}

                    <div className="bg-indigo-50 p-3 rounded border border-indigo-200 text-xs">
                      <p className="font-medium text-indigo-700 mb-1">Payment Impact</p>
                      <p className="text-indigo-800">{navigation.admission_timing?.payment_impact}</p>
                    </div>

                    {navigation.admission_timing?.discrepancies?.length > 0 && (
                      <Alert className="bg-red-50 border-red-200">
                        <XCircle className="w-4 h-4 text-red-600" />
                        <AlertDescription className="text-red-800 text-xs">
                          <strong>Discrepancies Found:</strong>
                          <ul className="mt-1 space-y-1">
                            {navigation.admission_timing.discrepancies.map((d, i) => (
                              <li key={i}>• {d}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Discrepancies */}
            {navigation.discrepancies?.length > 0 && (
              <div className="bg-red-50 p-4 rounded-lg border-2 border-red-200">
                <h3 className="font-semibold text-red-900 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Discrepancies Detected ({navigation.discrepancies.length})
                </h3>
                <div className="space-y-3">
                  {navigation.discrepancies.map((disc, idx) => (
                    <div key={idx} className="bg-white rounded border border-red-200 overflow-hidden">
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-1">
                          <Badge className={getSeverityBadge(disc.severity)}>{disc.severity}</Badge>
                          <Badge variant="outline" className="text-xs">{disc.type}</Badge>
                        </div>
                        <p className="text-sm text-slate-800 mb-1">{disc.finding}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-600 mb-2">
                          <span>Expected: <strong>{disc.expected}</strong></span>
                          <ArrowRight className="w-3 h-3" />
                          <span>Actual: <strong className="text-red-600">{disc.actual}</strong></span>
                        </div>
                        {disc.revenue_impact && (
                          <p className="text-xs text-green-700 bg-green-50 p-1 rounded mb-2">💰 {disc.revenue_impact}</p>
                        )}
                        <p className="text-xs text-blue-700 mb-2">
                          <strong>Action:</strong> {disc.recommendation}
                        </p>
                        
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            onClick={() => getFinancialPrediction(disc, idx, 'discrepancy')}
                            disabled={loadingPrediction === idx}
                            size="sm"
                            variant="outline"
                            className="border-green-300 hover:bg-green-50"
                          >
                            {loadingPrediction === idx ? (
                              <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Calculating...</>
                            ) : financialPredictions[idx] ? (
                              <><DollarSign className="w-3 h-3 mr-2" /> View Prediction</>
                            ) : (
                              <><DollarSign className="w-3 h-3 mr-2" /> Financial Impact</>
                            )}
                          </Button>
                          <Button
                            onClick={() => getResolutionWorkflow(disc, idx)}
                            disabled={loadingResolution === idx}
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            {loadingResolution === idx ? (
                              <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Loading...</>
                            ) : resolutionWorkflows[idx] ? (
                              <><CheckCircle2 className="w-3 h-3 mr-2" /> View Steps</>
                            ) : (
                              <><Target className="w-3 h-3 mr-2" /> Resolution</>
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Financial Prediction Details */}
                      {financialPredictions[idx] && !financialPredictions[idx].error && (
                        <div className="border-t border-red-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4 space-y-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">{financialPredictions[idx].visual_summary?.icon || '💰'}</span>
                              <div>
                                <h4 className="font-semibold text-slate-900">Financial Impact Prediction</h4>
                                <p className="text-xs text-slate-600">{financialPredictions[idx].visual_summary?.tagline}</p>
                              </div>
                            </div>
                            <Badge className={getPriorityColor(financialPredictions[idx].prioritization?.priority_rank || 'medium')}>
                              {financialPredictions[idx].prioritization?.priority_rank?.toUpperCase()} PRIORITY
                            </Badge>
                          </div>

                          {/* Per Episode Impact */}
                          <div className="bg-white p-3 rounded-lg border-2 border-green-300">
                            <p className="text-xs font-semibold text-slate-700 mb-2">Per Episode Impact</p>
                            <div className="grid grid-cols-3 gap-2 mb-2">
                              <div className="text-center p-2 bg-red-50 rounded">
                                <p className="text-xs text-red-600">Current</p>
                                <p className="text-lg font-bold text-red-700">
                                  {formatCurrency(financialPredictions[idx].per_episode?.current_payment)}
                                </p>
                              </div>
                              <div className="flex items-center justify-center">
                                <ArrowRight className="w-5 h-5 text-green-600" />
                              </div>
                              <div className="text-center p-2 bg-green-50 rounded">
                                <p className="text-xs text-green-600">If Corrected</p>
                                <p className="text-lg font-bold text-green-700">
                                  {formatCurrency(financialPredictions[idx].per_episode?.corrected_payment)}
                                </p>
                              </div>
                            </div>
                            <div className="text-center bg-gradient-to-r from-green-100 to-emerald-100 p-2 rounded">
                              <p className="text-xs text-green-700">Gain Per Episode</p>
                              <p className="text-2xl font-bold text-green-800">
                                +{formatCurrency(financialPredictions[idx].per_episode?.gain_per_episode)}
                              </p>
                              <p className="text-xs text-green-600">
                                (+{financialPredictions[idx].per_episode?.percentage_increase}% increase)
                              </p>
                            </div>
                            <p className="text-xs text-slate-600 mt-2 italic">
                              {financialPredictions[idx].per_episode?.explanation}
                            </p>
                          </div>

                          {/* Annual Projection */}
                          <div className="bg-white p-3 rounded-lg border-2 border-blue-300">
                            <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" /> 1-Year Projection
                            </p>
                            <div className="space-y-2">
                              <div className="bg-gradient-to-r from-navy-100 to-indigo-100 p-3 rounded border-2 border-navy-300">
                                <p className="text-xs text-navy-700 mb-1">💎 Total Annual Opportunity</p>
                                <p className="text-3xl font-bold text-navy-800">
                                  {formatCurrency(financialPredictions[idx].annual_projection?.total_opportunity)}
                                </p>
                                <p className="text-xs text-navy-600 mt-1">
                                  Based on {financialPredictions[idx].annual_projection?.similar_episodes_per_year} similar episodes per year
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Risk Analysis */}
                          <div className="bg-white p-3 rounded-lg border border-orange-300">
                            <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-orange-600" /> Risk if Unaddressed
                            </p>
                            <div className="space-y-2 text-xs">
                              <div className="flex items-center justify-between p-2 bg-orange-50 rounded">
                                <span className="text-slate-700">Repetition Probability</span>
                                <Badge className="bg-orange-600 text-white">
                                  {financialPredictions[idx].risk_analysis?.repetition_probability}%
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between p-2 bg-red-50 rounded">
                                <span className="text-slate-700">Audit Risk Level</span>
                                <Badge className={getSeverityBadge(financialPredictions[idx].risk_analysis?.audit_risk_level)}>
                                  {financialPredictions[idx].risk_analysis?.audit_risk_level}
                                </Badge>
                              </div>
                              <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                                <p className="font-medium text-yellow-800 mb-1">Compliance Exposure</p>
                                <p className="text-slate-700">{financialPredictions[idx].risk_analysis?.compliance_exposure}</p>
                              </div>
                              <div className="bg-red-50 p-2 rounded border border-red-300">
                                <p className="font-medium text-red-800 mb-1">⚠️ Worst Case Scenario</p>
                                <p className="text-slate-700">{financialPredictions[idx].risk_analysis?.downside_scenario}</p>
                                <p className="text-red-700 font-bold mt-1">
                                  Potential Loss: {formatCurrency(financialPredictions[idx].risk_analysis?.downside_amount)}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Prioritization */}
                          <div className="bg-white p-3 rounded-lg border-2 border-indigo-300">
                            <p className="text-xs font-semibold text-slate-700 mb-2">Prioritization Analysis</p>
                            <div className="grid grid-cols-3 gap-2 mb-2 text-center text-xs">
                              <div className="bg-indigo-50 p-2 rounded">
                                <p className="text-indigo-600 mb-1">Financial Urgency</p>
                                <div className="flex items-center justify-center gap-0.5">
                                  {[...Array(10)].map((_, i) => (
                                    <div
                                      key={i}
                                      className={`w-2 h-4 rounded-sm ${
                                        i < financialPredictions[idx].prioritization?.financial_urgency
                                          ? 'bg-indigo-600'
                                          : 'bg-slate-200'
                                      }`}
                                    />
                                  ))}
                                </div>
                                <p className="font-bold text-indigo-800 mt-1">
                                  {financialPredictions[idx].prioritization?.financial_urgency}/10
                                </p>
                              </div>
                              <div className="bg-green-50 p-2 rounded">
                                <p className="text-green-600 mb-1">Ease of Fix</p>
                                <div className="flex items-center justify-center gap-0.5">
                                  {[...Array(10)].map((_, i) => (
                                    <div
                                      key={i}
                                      className={`w-2 h-4 rounded-sm ${
                                        i < financialPredictions[idx].prioritization?.ease_of_correction
                                          ? 'bg-green-600'
                                          : 'bg-slate-200'
                                      }`}
                                    />
                                  ))}
                                </div>
                                <p className="font-bold text-green-800 mt-1">
                                  {financialPredictions[idx].prioritization?.ease_of_correction}/10
                                </p>
                              </div>
                              <div className="bg-navy-50 p-2 rounded">
                                <p className="text-navy-600 mb-1">ROI Potential</p>
                                <p className="text-2xl font-bold text-navy-800 uppercase">
                                  {financialPredictions[idx].prioritization?.roi_potential}
                                </p>
                              </div>
                            </div>
                            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-2 rounded border border-indigo-200">
                              <p className="text-xs text-indigo-700 font-medium mb-1">
                                🎯 Recommended Timeline: <span className="uppercase">{financialPredictions[idx].prioritization?.recommended_timeline}</span>
                              </p>
                              <p className="text-xs text-slate-700">{financialPredictions[idx].prioritization?.justification}</p>
                            </div>
                          </div>

                          {/* Breakeven Analysis */}
                          <div className="bg-white p-3 rounded-lg border border-slate-300">
                          <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                            <Calculator className="w-3 h-3" /> Breakeven Analysis
                            <Badge variant="outline" className="text-xs ml-auto">Agency-Specific</Badge>
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-slate-50 p-2 rounded">
                              <p className="text-slate-500">Implementation Time</p>
                              <p className="font-medium text-slate-800">
                                {financialPredictions[idx].breakeven?.implementation_time}
                              </p>
                            </div>
                            <div className="bg-slate-50 p-2 rounded">
                              <p className="text-slate-500">Implementation Cost</p>
                              <p className="font-medium text-slate-800">
                                {formatCurrency(financialPredictions[idx].breakeven?.implementation_cost)}
                              </p>
                            </div>
                              <div className="bg-blue-50 p-2 rounded">
                                <p className="text-blue-600">Episodes to Breakeven</p>
                                <p className="font-bold text-blue-800">
                                  {financialPredictions[idx].breakeven?.episodes_to_breakeven} episodes
                                </p>
                              </div>
                              <div className="bg-blue-50 p-2 rounded">
                                <p className="text-blue-600">Time to Breakeven</p>
                                <p className="font-bold text-blue-800">
                                  {financialPredictions[idx].breakeven?.time_to_breakeven}
                                </p>
                              </div>
                            </div>
                            <div className="mt-2 bg-gradient-to-r from-green-50 to-emerald-50 p-2 rounded border border-green-300">
                              <p className="text-xs text-green-700 mb-1">Year 1 Net Benefit</p>
                              <div className="flex items-center justify-between">
                                <p className="text-2xl font-bold text-green-800">
                                  {formatCurrency(financialPredictions[idx].breakeven?.net_benefit_year_1)}
                                </p>
                                <Badge className="bg-green-600 text-white text-lg">
                                  {financialPredictions[idx].breakeven?.roi_percentage}% ROI
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {financialPredictions[idx]?.error && (
                        <div className="border-t border-red-200 bg-red-50 p-3">
                          <p className="text-xs text-red-800">{financialPredictions[idx].error}</p>
                        </div>
                      )}

                      {/* Resolution Workflow Details */}
                      {resolutionWorkflows[idx] && !resolutionWorkflows[idx].error && (
                        <div className="border-t border-red-200 bg-blue-50 p-4 space-y-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Target className="w-4 h-4 text-blue-600" />
                            <h4 className="font-semibold text-blue-900">Resolution Workflow</h4>
                          </div>

                          {/* Root Cause */}
                          <div className="bg-white p-3 rounded border">
                            <p className="text-xs font-semibold text-slate-700 mb-1">Root Cause Analysis</p>
                            <p className="text-sm text-slate-800">{resolutionWorkflows[idx].root_cause}</p>
                            <p className="text-xs text-orange-700 mt-1 bg-orange-50 p-1.5 rounded">
                              <strong>Impact:</strong> {resolutionWorkflows[idx].severity_explanation}
                            </p>
                          </div>

                          {/* Correction Steps */}
                          {resolutionWorkflows[idx].correction_steps?.length > 0 && (
                            <div className="bg-white p-3 rounded border">
                              <p className="text-xs font-semibold text-slate-700 mb-2">Step-by-Step Correction Process</p>
                              <div className="space-y-2">
                                {resolutionWorkflows[idx].correction_steps.map((step, i) => (
                                  <div key={i} className="flex gap-2">
                                    <div className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                      {step.step_number}
                                    </div>
                                    <div className="flex-1">
                                      <p className="text-sm font-medium text-slate-800">{step.action}</p>
                                      {step.specific_fields?.length > 0 && (
                                        <p className="text-xs text-slate-600">
                                          Fields: {step.specific_fields.map(f => <span key={f} className="font-mono bg-slate-100 px-1 rounded">{f}</span>)}
                                        </p>
                                      )}
                                      <p className="text-xs text-slate-500 italic">{step.rationale}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Documentation Changes */}
                          {resolutionWorkflows[idx].documentation_changes?.length > 0 && (
                            <div className="bg-white p-3 rounded border">
                              <p className="text-xs font-semibold text-slate-700 mb-2">Clinical Documentation Changes</p>
                              <div className="space-y-2">
                                {resolutionWorkflows[idx].documentation_changes.map((change, i) => (
                                  <div key={i} className="bg-slate-50 p-2 rounded border">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs font-mono bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
                                        {change.item}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
                                      <div className="bg-red-50 p-1.5 rounded border border-red-200">
                                        <p className="text-red-600 font-medium mb-0.5">Current</p>
                                        <p className="text-slate-700">{change.current_value || 'Not documented'}</p>
                                      </div>
                                      <div className="bg-green-50 p-1.5 rounded border border-green-200">
                                        <p className="text-green-600 font-medium mb-0.5">Recommended</p>
                                        <p className="text-slate-700">{change.recommended_value}</p>
                                      </div>
                                    </div>
                                    <div className="bg-blue-50 p-2 rounded border border-blue-200 mb-1">
                                      <p className="text-xs text-blue-600 font-medium mb-0.5">📝 Example Narrative:</p>
                                      <p className="text-sm text-blue-900 italic">"{change.example_narrative}"</p>
                                    </div>
                                    <p className="text-xs text-slate-600">
                                      <strong>Clinical Justification:</strong> {change.clinical_justification}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* CMS References */}
                          {resolutionWorkflows[idx].cms_references?.length > 0 && (
                            <div className="bg-white p-3 rounded border">
                              <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                                <BookOpen className="w-3 h-3" /> CMS Guidelines Reference
                              </p>
                              <div className="space-y-2">
                                {resolutionWorkflows[idx].cms_references.map((ref, i) => (
                                  <div key={i} className="bg-slate-50 p-2 rounded border text-xs">
                                    <p className="font-medium text-slate-800">{ref.guideline}</p>
                                    <p className="text-slate-600">Section: {ref.section}</p>
                                    <p className="text-slate-700 italic mt-1 bg-white p-1 rounded">"{ref.quote}"</p>
                                    <p className="text-blue-700 mt-1">
                                      <strong>Application:</strong> {ref.application}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Validation Checklist */}
                          {resolutionWorkflows[idx].validation_checklist?.length > 0 && (
                            <div className="bg-white p-3 rounded border">
                              <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Post-Correction Validation
                              </p>
                              <ul className="space-y-1">
                                {resolutionWorkflows[idx].validation_checklist.map((item, i) => (
                                  <li key={i} className="text-xs text-slate-700 flex items-start gap-1">
                                    <span className="text-green-600">✓</span> {item}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Summary Info */}
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-white p-2 rounded border">
                              <p className="text-slate-500 mb-0.5">Estimated Time</p>
                              <p className="font-medium text-slate-800">{resolutionWorkflows[idx].estimated_resolution_time}</p>
                            </div>
                            <div className="bg-green-50 p-2 rounded border border-green-200">
                              <p className="text-green-600 mb-0.5">Revenue Impact</p>
                              <p className="font-medium text-green-800">{resolutionWorkflows[idx].revenue_impact_if_resolved}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {resolutionWorkflows[idx]?.error && (
                        <div className="border-t border-red-200 bg-red-50 p-3">
                          <p className="text-xs text-red-800">{resolutionWorkflows[idx].error}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Optimization Opportunities */}
            {navigation.optimization_opportunities?.length > 0 && (
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Optimization Opportunities
                </h3>
                <div className="space-y-2">
                  {navigation.optimization_opportunities.map((opp, idx) => {
                    const oppIndex = `opp_${idx}`;
                    return (
                      <div key={idx} className="bg-white p-3 rounded border border-green-200">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-green-900">{opp.area}</span>
                          <Badge className="bg-green-600 text-white">{opp.potential_impact}</Badge>
                        </div>
                        <p className="text-xs text-slate-600 mb-1">Current: {opp.current_state}</p>
                        <p className="text-sm text-green-800 mb-1">{opp.opportunity}</p>
                        <div className="bg-blue-50 p-2 rounded text-xs mb-2">
                          <strong>Action:</strong> {opp.action_required}
                        </div>
                        {opp.clinical_justification_needed && (
                          <p className="text-xs text-slate-500 mb-2 italic">
                            Requires: {opp.clinical_justification_needed}
                          </p>
                        )}
                        
                        <Button
                          onClick={() => getFinancialPrediction(opp, oppIndex, 'opportunity')}
                          disabled={loadingPrediction === oppIndex}
                          size="sm"
                          variant="outline"
                          className="w-full border-green-300 hover:bg-green-50"
                        >
                          {loadingPrediction === oppIndex ? (
                            <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Calculating...</>
                          ) : financialPredictions[oppIndex] ? (
                            <><DollarSign className="w-3 h-3 mr-2" /> View Financial Impact</>
                          ) : (
                            <><DollarSign className="w-3 h-3 mr-2" /> Predict Financial Impact</>
                          )}
                        </Button>

                        {/* Financial Prediction for Opportunity */}
                        {financialPredictions[oppIndex] && !financialPredictions[oppIndex].error && (
                          <div className="mt-3 bg-gradient-to-r from-green-50 to-emerald-50 p-3 rounded border-2 border-green-300 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xl">{financialPredictions[oppIndex].visual_summary?.icon}</span>
                              <Badge className={getPriorityColor(financialPredictions[oppIndex].prioritization?.priority_rank || 'medium')}>
                                {financialPredictions[oppIndex].prioritization?.priority_rank?.toUpperCase()}
                              </Badge>
                            </div>
                            <p className="text-xs font-semibold text-green-800">
                              {financialPredictions[oppIndex].visual_summary?.tagline}
                            </p>
                            
                            <div className="bg-white p-2 rounded text-center">
                              <p className="text-xs text-slate-500">Annual Opportunity</p>
                              <p className="text-2xl font-bold text-green-700">
                                {formatCurrency(financialPredictions[oppIndex].annual_projection?.total_opportunity)}
                              </p>
                              <p className="text-xs text-green-600">
                                +{formatCurrency(financialPredictions[oppIndex].per_episode?.gain_per_episode)} per episode
                              </p>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-indigo-50 p-2 rounded text-center">
                                <p className="text-indigo-600">Priority</p>
                                <p className="font-bold text-indigo-800 uppercase">
                                  {financialPredictions[oppIndex].prioritization?.recommended_timeline}
                                </p>
                              </div>
                              <div className="bg-navy-50 p-2 rounded text-center">
                                <p className="text-navy-600">ROI</p>
                                <p className="font-bold text-navy-800">
                                  {financialPredictions[oppIndex].breakeven?.roi_percentage}%
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Patient Outcome Forecasts */}
            {patientForecasts && (
              <div className="bg-gradient-to-r from-blue-50 to-navy-50 p-4 rounded-lg border-2 border-blue-300">
                <h3 className="font-semibold text-blue-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Predictive Patient Outcome Forecasts
                  <Badge className={
                    patientForecasts.confidence_level === 'high' ? 'bg-green-600 text-white' :
                    patientForecasts.confidence_level === 'moderate' ? 'bg-yellow-600 text-white' :
                    'bg-orange-600 text-white'
                  }>
                    {patientForecasts.confidence_level} confidence
                  </Badge>
                </h3>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                  {/* Readmission Risk */}
                  <Card className={`border-2 ${
                    patientForecasts.readmission_risk?.risk_level === 'critical' || patientForecasts.readmission_risk?.risk_level === 'high'
                      ? 'border-red-400 bg-red-50'
                      : patientForecasts.readmission_risk?.risk_level === 'moderate'
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-green-400 bg-green-50'
                  }`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Readmission Risk
                        </h4>
                        <Badge className={
                          patientForecasts.readmission_risk?.risk_level === 'critical' || patientForecasts.readmission_risk?.risk_level === 'high'
                            ? 'bg-red-600 text-white'
                            : patientForecasts.readmission_risk?.risk_level === 'moderate'
                            ? 'bg-yellow-600 text-white'
                            : 'bg-green-600 text-white'
                        }>
                          {patientForecasts.readmission_risk?.risk_level?.toUpperCase()}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="text-center p-2 bg-white rounded border">
                          <p className="text-xs text-slate-600">30-Day Risk</p>
                          <p className="text-2xl font-bold text-red-600">
                            {patientForecasts.readmission_risk?.thirty_day_risk_score}%
                          </p>
                        </div>
                        <div className="text-center p-2 bg-white rounded border">
                          <p className="text-xs text-slate-600">60-Day Risk</p>
                          <p className="text-2xl font-bold text-orange-600">
                            {patientForecasts.readmission_risk?.sixty_day_risk_score}%
                          </p>
                        </div>
                      </div>

                      {patientForecasts.readmission_risk?.top_risk_factors?.length > 0 && (
                        <div className="bg-white p-2 rounded border mb-2">
                          <p className="text-xs font-semibold text-slate-700 mb-1">Top Risk Factors</p>
                          <ul className="text-xs text-slate-700 space-y-1">
                            {patientForecasts.readmission_risk.top_risk_factors.map((factor, i) => (
                              <li key={i}>• {factor}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {patientForecasts.readmission_risk?.preventive_interventions?.length > 0 && (
                        <div className="bg-green-50 p-2 rounded border border-green-200">
                          <p className="text-xs font-semibold text-green-800 mb-1">✓ Preventive Actions</p>
                          <ul className="text-xs text-green-700 space-y-1">
                            {patientForecasts.readmission_risk.preventive_interventions.slice(0, 3).map((int, i) => (
                              <li key={i}>• {int}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Length of Stay */}
                  <Card className="border-2 border-blue-400 bg-blue-50">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          Length of Stay
                        </h4>
                      </div>

                      <div className="text-center p-3 bg-white rounded border-2 border-blue-300 mb-3">
                        <p className="text-xs text-slate-600">Predicted LOS</p>
                        <p className="text-4xl font-bold text-blue-700">
                          {patientForecasts.length_of_stay?.predicted_days}
                        </p>
                        <p className="text-xs text-blue-600">days</p>
                        <p className="text-xs text-slate-500 mt-1">
                          {patientForecasts.length_of_stay?.confidence_range}
                        </p>
                      </div>

                      <div className="bg-white p-2 rounded border mb-2">
                        <p className="text-xs text-slate-600">{patientForecasts.length_of_stay?.compared_to_average}</p>
                      </div>

                      {patientForecasts.length_of_stay?.influencing_factors?.length > 0 && (
                        <div className="bg-blue-50 p-2 rounded border border-blue-200">
                          <p className="text-xs font-semibold text-blue-800 mb-1">Key Factors</p>
                          <ul className="text-xs text-blue-700 space-y-1">
                            {patientForecasts.length_of_stay.influencing_factors.slice(0, 3).map((factor, i) => (
                              <li key={i}>• {factor}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Functional Outcomes */}
                  <Card className="border-2 border-navy-400 bg-navy-50">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold flex items-center gap-2">
                          <Activity className="w-4 h-4" />
                          Functional Outcomes
                        </h4>
                      </div>

                      <div className="text-center p-3 bg-white rounded border-2 border-navy-300 mb-3">
                        <p className="text-xs text-slate-600">Expected Improvement</p>
                        <p className="text-4xl font-bold text-navy-700">
                          {patientForecasts.functional_outcomes?.expected_improvement_percentage}%
                        </p>
                        <p className="text-xs text-navy-600 mt-1">
                          Success Probability: {patientForecasts.functional_outcomes?.success_probability}%
                        </p>
                      </div>

                      <div className="bg-white p-2 rounded border mb-2 text-xs">
                        <p className="text-slate-600">
                          <strong>Discharge Functional Level:</strong> {patientForecasts.functional_outcomes?.discharge_functional_level}
                        </p>
                        <p className="text-slate-600 mt-1">
                          <strong>Timeline:</strong> {patientForecasts.functional_outcomes?.timeline_to_goals}
                        </p>
                      </div>

                      {patientForecasts.functional_outcomes?.barriers_to_improvement?.length > 0 && (
                        <div className="bg-orange-50 p-2 rounded border border-orange-200">
                          <p className="text-xs font-semibold text-orange-800 mb-1">⚠️ Barriers</p>
                          <ul className="text-xs text-orange-700 space-y-1">
                            {patientForecasts.functional_outcomes.barriers_to_improvement.slice(0, 2).map((barrier, i) => (
                              <li key={i}>• {barrier}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Resource Allocation */}
                  <Card className="border-2 border-green-400 bg-green-50">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold flex items-center gap-2">
                          <Target className="w-4 h-4" />
                          Resource Allocation
                        </h4>
                        <Badge className={
                          patientForecasts.resource_allocation?.nursing_intensity === 'very_high' ? 'bg-red-600 text-white' :
                          patientForecasts.resource_allocation?.nursing_intensity === 'high' ? 'bg-orange-600 text-white' :
                          patientForecasts.resource_allocation?.nursing_intensity === 'moderate' ? 'bg-yellow-600 text-white' :
                          'bg-green-600 text-white'
                        }>
                          {patientForecasts.resource_allocation?.nursing_intensity} intensity
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                        <div className="bg-white p-2 rounded border text-center">
                          <p className="text-slate-600">Weekly Visits</p>
                          <p className="text-2xl font-bold text-green-700">
                            {patientForecasts.resource_allocation?.predicted_weekly_visits}
                          </p>
                        </div>
                        <div className="bg-white p-2 rounded border text-center">
                          <p className="text-slate-600">Total Care Hours</p>
                          <p className="text-2xl font-bold text-green-700">
                            {patientForecasts.resource_allocation?.total_care_hours_estimate}
                          </p>
                        </div>
                      </div>

                      <div className="bg-white p-2 rounded border text-xs mb-2">
                        <div className="grid grid-cols-3 gap-1 text-center">
                          <div>
                            <p className="text-slate-500">SN</p>
                            <p className="font-bold">{patientForecasts.resource_allocation?.skilled_nursing_visits}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">PT</p>
                            <p className="font-bold">{patientForecasts.resource_allocation?.pt_sessions_recommended}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">OT</p>
                            <p className="font-bold">{patientForecasts.resource_allocation?.ot_sessions_recommended}</p>
                          </div>
                        </div>
                      </div>

                      {patientForecasts.resource_allocation?.resource_optimization_tips?.length > 0 && (
                        <div className="bg-green-50 p-2 rounded border border-green-200">
                          <p className="text-xs font-semibold text-green-800 mb-1">💡 Optimization</p>
                          <ul className="text-xs text-green-700 space-y-1">
                            {patientForecasts.resource_allocation.resource_optimization_tips.slice(0, 2).map((tip, i) => (
                              <li key={i}>• {tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Care Planning Insights */}
                {patientForecasts.care_planning_insights?.high_priority_interventions?.length > 0 && (
                  <div className="bg-white p-4 rounded-lg border-2 border-indigo-300">
                    <h4 className="font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      High-Priority Care Plan Interventions
                    </h4>
                    <div className="space-y-2">
                      {patientForecasts.care_planning_insights.high_priority_interventions.map((int, idx) => (
                        <div key={idx} className="bg-gradient-to-r from-indigo-50 to-blue-50 p-3 rounded border">
                          <div className="flex items-start gap-2">
                            <span className="bg-indigo-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm flex-shrink-0">
                              {idx + 1}
                            </span>
                            <div className="flex-1">
                              <p className="font-semibold text-sm text-indigo-900">{int.intervention}</p>
                              <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                                <div>
                                  <p className="text-slate-500">Timeframe</p>
                                  <p className="font-medium text-slate-800">{int.timeframe}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500">Expected Outcome</p>
                                  <p className="font-medium text-green-700">{int.expected_outcome}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500">Resources</p>
                                  <p className="font-medium text-blue-700">{int.resource_needs}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key Milestones */}
                {patientForecasts.care_planning_insights?.key_milestones?.length > 0 && (
                  <div className="bg-white p-4 rounded-lg border-2 border-navy-300">
                    <h4 className="font-semibold text-navy-900 mb-3">📅 Care Plan Milestones</h4>
                    <div className="space-y-2">
                      {patientForecasts.care_planning_insights.key_milestones.map((milestone, idx) => (
                        <div key={idx} className="flex items-start gap-3 bg-navy-50 p-2 rounded border border-navy-200">
                          <CheckCircle2 className="w-4 h-4 text-navy-600 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 text-xs">
                            <p className="font-semibold text-navy-900">{milestone.milestone}</p>
                            <p className="text-slate-600">Target: {milestone.target_date}</p>
                            <p className="text-slate-700">Success Criteria: {milestone.success_criteria}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quality Measures Forecast */}
                <div className="bg-white p-4 rounded-lg border-2 border-green-300">
                  <h4 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Quality Measures Performance Forecast
                  </h4>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="text-center p-2 bg-green-50 rounded border border-green-200">
                      <p className="text-xs text-slate-600">Ambulation</p>
                      <p className="text-xl font-bold text-green-700">
                        {patientForecasts.quality_measures_forecast?.improvement_in_ambulation_likelihood}%
                      </p>
                      <p className="text-xs text-green-600">likely to improve</p>
                    </div>
                    <div className="text-center p-2 bg-blue-50 rounded border border-blue-200">
                      <p className="text-xs text-slate-600">Bathing</p>
                      <p className="text-xl font-bold text-blue-700">
                        {patientForecasts.quality_measures_forecast?.improvement_in_bathing_likelihood}%
                      </p>
                      <p className="text-xs text-blue-600">likely to improve</p>
                    </div>
                    <div className="text-center p-2 bg-navy-50 rounded border border-navy-200">
                      <p className="text-xs text-slate-600">Transferring</p>
                      <p className="text-xl font-bold text-navy-700">
                        {patientForecasts.quality_measures_forecast?.improvement_in_transferring_likelihood}%
                      </p>
                      <p className="text-xs text-navy-600">likely to improve</p>
                    </div>
                  </div>

                  {patientForecasts.quality_measures_forecast?.decline_risk_areas?.length > 0 && (
                    <Alert className="bg-orange-50 border-orange-200">
                      <AlertTriangle className="w-4 h-4 text-orange-600" />
                      <AlertDescription className="text-xs">
                        <p className="font-semibold text-orange-900 mb-1">Areas at Risk of Decline</p>
                        <ul className="text-orange-800 space-y-1">
                          {patientForecasts.quality_measures_forecast.decline_risk_areas.map((area, i) => (
                            <li key={i}>• {area}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                {/* Overall Prognosis */}
                <div className="bg-gradient-to-r from-indigo-50 to-navy-50 p-3 rounded-lg border border-indigo-300">
                  <p className="text-xs font-semibold text-indigo-800 mb-1">📊 Overall Prognosis</p>
                  <p className="text-sm text-indigo-900">{patientForecasts.overall_prognosis}</p>
                </div>

                <Button
                  onClick={generatePatientForecasts}
                  variant="outline"
                  size="sm"
                  disabled={isLoadingForecasts}
                  className="w-full"
                >
                  {isLoadingForecasts ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating Forecasts...</>
                  ) : (
                    'Refresh Forecasts'
                  )}
                </Button>
              </div>
            )}

            {isLoadingForecasts && !patientForecasts && (
              <div className="bg-blue-50 p-6 rounded-lg border border-blue-300 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
                <p className="text-sm text-blue-700">Generating predictive forecasts for patient outcomes...</p>
              </div>
            )}

            {/* Key Drivers Summary */}
            {navigation.summary?.key_drivers?.length > 0 && (
              <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                <p className="text-xs font-semibold text-indigo-800 mb-2">Key Payment Drivers</p>
                <div className="flex flex-wrap gap-2">
                  {navigation.summary.key_drivers.map((driver, i) => (
                    <Badge key={i} className="bg-indigo-200 text-indigo-800">{driver}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* AI Group Assignment Validator */}
            <AIGroupAssignmentValidator
              oasisData={pdgmData}
              analysisResults={analysisResults}
              pdgmData={pdgmData}
              patientId={pdgmData?.patient_id}
              autoValidate={true}
            />
            {/* PDGM Scenario Modeler */}
            <PDGMScenarioModeler
              baselineOasisData={pdgmData}
              baselineNavigationData={navigation}
              patientId={pdgmData?.patient_id}
            />

            {/* Re-analyze Button */}
            <Button
              onClick={() => { setNavigation(null); setAutoAnalyzed(false); }}
              variant="outline"
              size="sm"
              className="w-full"
            >
              Re-analyze PDGM Grouping
            </Button>
          </>
        )}

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-red-800 text-sm">{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}