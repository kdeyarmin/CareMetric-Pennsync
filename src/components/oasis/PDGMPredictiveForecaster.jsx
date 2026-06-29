import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Target,
  BarChart3,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  LineChart,
  Sliders,
  Activity
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart as RechartsLineChart, Line } from 'recharts';
import { calculatePDGM } from "@/functions/calculatePDGM";

export default function PDGMPredictiveForecaster({ pdgmData, analysisResults, currentPayment, triggeredPathways }) {
  const [isPredicting, setIsPredicting] = useState(false);
  const [predictions, setPredictions] = useState(null);
  const [hasAutoPredicted, setHasAutoPredicted] = useState(false);
  const [simulationMode, setSimulationMode] = useState(false);
  const [simulatedScores, setSimulatedScores] = useState(null);
  const [simulationResults, setSimulationResults] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const { data: agencySettings } = useQuery({
    queryKey: ['agencySettings'],
    queryFn: async () => {
      const result = await base44.entities.AgencySettings.list();
      return result[0] || null;
    }
  });

  const generatePredictions = useCallback(async () => {
    if (!pdgmData || !analysisResults) return;

    setIsPredicting(true);

    try {
      const result = await invokeLLM({
        model: "claude_opus_4_8",
        prompt: `You are a PDGM financial forecasting expert. Generate predictive reimbursement scenarios based on potential documentation improvements.

CURRENT OASIS DATA:
${JSON.stringify({
  primary_diagnosis: pdgmData.primary_diagnosis,
  primary_diagnosis_code: pdgmData.primary_diagnosis_code,
  comorbidities: pdgmData.comorbidities,
  functional_scores: pdgmData.functional_scores,
  admission_source: pdgmData.admission_source,
  episode_timing: pdgmData.episode_timing,
  clinical_items: pdgmData.clinical_items
}, null, 2)}

CURRENT PAYMENT: $${currentPayment || 'Not yet calculated'}

ANALYSIS FINDINGS:
- Accuracy Issues: ${analysisResults.accuracy_issues?.length || 0}
- Revenue Tips: ${analysisResults.revenue_tips?.length || 0}
- Rescore Opportunities: ${analysisResults.specific_rescore_opportunities?.length || 0}
- Quick Wins: ${analysisResults.quick_wins?.length || 0}

TRIGGERED CLINICAL PATHWAYS:
${triggeredPathways?.map(p => `- ${p.pathway_name}: ${p.rescore_opportunities?.length || 0} rescore opps, ${p.documentation_prompts?.length || 0} doc prompts`).join('\n') || 'None'}

AGENCY SETTINGS:
- Average Episodes/Year: ${agencySettings?.avg_episodes_per_year || 50}
- Wage Index: ${agencySettings?.wage_index || 1.0}

Generate 5 predictive scenarios showing financial impact of improvements:

1. BASELINE (Current State)
   - Keep current documentation as-is
   - Current payment estimate

2. QUICK WINS ONLY (Fastest ROI)
   - Apply only the easy, low-effort improvements
   - 1-2 week implementation time
   - What changes: specific M-items or documentation
   - Payment impact

3. PATHWAY OPTIMIZATION (Moderate Effort)
   - Apply clinical pathway recommendations
   - Address key functional and comorbidity gaps
   - 1-2 month implementation
   - Payment impact

4. COMPREHENSIVE CORRECTION (Full Optimization)
   - Apply ALL identified improvements
   - Address all accuracy issues, revenue tips, rescores
   - 2-3 month full implementation
   - Maximum payment potential

5. BEST CASE SCENARIO (Clinical Excellence)
   - Optimal documentation for this diagnosis
   - Industry best practices applied
   - Maximum allowable PDGM payment for this case
   - Aspirational target

For each scenario, provide:
- Specific changes made (which M-items, diagnosis additions, etc.)
- Projected PDGM payment
- Implementation timeline
- Implementation effort (low/medium/high)
- ROI timeline
- Annual revenue impact (based on similar episodes)
- Probability of achieving (realistic %)

Also provide:
- Financial trajectory over 12 months
- Breakeven analysis for each scenario
- Risk-adjusted recommendations

Return JSON:
{
  "scenarios": [
    {
      "name": "scenario name",
      "description": "what this represents",
      "changes": [{"item": "what changes", "from": "current", "to": "new"}],
      "projected_payment": 0,
      "payment_increase": 0,
      "percentage_increase": 0,
      "implementation_timeline": "timeframe",
      "implementation_effort": "low/medium/high",
      "effort_hours": 0,
      "roi_timeline": "when breaks even",
      "annual_impact": 0,
      "probability": 0,
      "key_actions": ["specific actions needed"]
    }
  ],
  "financial_trajectory": {
    "month_1": {"conservative": 0, "realistic": 0, "optimistic": 0},
    "month_3": {"conservative": 0, "realistic": 0, "optimistic": 0},
    "month_6": {"conservative": 0, "realistic": 0, "optimistic": 0},
    "month_12": {"conservative": 0, "realistic": 0, "optimistic": 0}
  },
  "breakeven_analysis": {
    "quick_wins": {"cost": 0, "episodes_to_breakeven": 0, "time_to_breakeven": ""},
    "pathway_optimization": {"cost": 0, "episodes_to_breakeven": 0, "time_to_breakeven": ""},
    "comprehensive": {"cost": 0, "episodes_to_breakeven": 0, "time_to_breakeven": ""}
  },
  "recommendations": {
    "immediate_focus": "what to do right now",
    "30_day_goals": "what to achieve in 30 days",
    "90_day_goals": "what to achieve in 90 days",
    "success_metrics": ["how to measure success"]
  }
}`,
        response_json_schema: {
          type: "object",
          properties: {
            scenarios: { type: "array", items: { type: "object" } },
            financial_trajectory: { type: "object" },
            breakeven_analysis: { type: "object" },
            recommendations: { type: "object" }
          }
        }
      });

      setPredictions(result);
    } catch (err) {
      console.error("Prediction error:", err);
    }

    setIsPredicting(false);
  }, [pdgmData, analysisResults, currentPayment, triggeredPathways, agencySettings]);

  useEffect(() => {
    if (pdgmData && analysisResults && !predictions && !isPredicting && !hasAutoPredicted) {
      generatePredictions();
      setHasAutoPredicted(true);
    }
  }, [pdgmData, analysisResults, predictions, isPredicting, hasAutoPredicted, generatePredictions]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  const initSimulationScores = () => {
    if (!pdgmData?.functional_scores) return;
    setSimulatedScores({
      m1800_grooming: pdgmData.functional_scores.m1800_grooming || 0,
      m1810_dress_upper: pdgmData.functional_scores.m1810_dress_upper || 0,
      m1820_dress_lower: pdgmData.functional_scores.m1820_dress_lower || 0,
      m1830_bathing: pdgmData.functional_scores.m1830_bathing || 0,
      m1840_toilet_transfer: pdgmData.functional_scores.m1840_toilet_transfer || 0,
      m1850_transferring: pdgmData.functional_scores.m1850_transferring || 0,
      m1860_ambulation: pdgmData.functional_scores.m1860_ambulation || 0
    });
  };

  const runSimulation = async () => {
    if (!simulatedScores || !pdgmData) return;

    setIsSimulating(true);
    
    try {
      // Create modified PDGM data with simulated scores
      const modifiedPdgmData = {
        ...pdgmData,
        functional_scores: simulatedScores
      };

      // Calculate new PDGM payment
      const response = await calculatePDGM({
        pdgmData: pdgmData,
        correctedPdgmData: modifiedPdgmData
      });

      // Get AI analysis of the grouping changes
      const analysis = await invokeLLM({
        model: "claude_opus_4_8",
        prompt: `Analyze how these functional score changes impact PDGM grouping and payment.

ORIGINAL SCORES:
${JSON.stringify(pdgmData.functional_scores, null, 2)}

SIMULATED SCORES:
${JSON.stringify(simulatedScores, null, 2)}

ORIGINAL PAYMENT DATA:
${JSON.stringify(response.data?.original, null, 2)}

NEW PAYMENT DATA:
${JSON.stringify(response.data?.corrected, null, 2)}

Provide detailed analysis:

1. FUNCTIONAL LEVEL IMPACT
   - Did functional level change? (Low → Medium → High)
   - Which specific M-items drove the change?
   - Functional points calculation

2. PDGM GROUPING CHANGES
   - Did this affect Clinical Group classification?
   - Any impact on Comorbidity adjustment?
   - Changes to case-mix multipliers

3. PAYMENT IMPACT BREAKDOWN
   - Payment difference: $ and %
   - Which component contributed most to the change?
   - Is this change clinically justifiable?

4. DOCUMENTATION RECOMMENDATIONS
   - What specific clinical observations support these scores?
   - Required narrative documentation
   - CMS compliance considerations

5. IMPLEMENTATION GUIDANCE
   - Is this improvement realistic?
   - What clinical evidence is needed?
   - Training/education requirements

Return JSON:
{
  "functional_level_impact": {
    "original_level": "low/medium/high",
    "new_level": "low/medium/high",
    "changed": true/false,
    "original_points": 0,
    "new_points": 0,
    "driving_changes": ["which M-items caused shift"]
  },
  "grouping_changes": {
    "clinical_group_changed": true/false,
    "clinical_group_from": "group name",
    "clinical_group_to": "group name",
    "comorbidity_adjustment_changed": true/false,
    "case_mix_multiplier_impact": "explanation"
  },
  "payment_breakdown": {
    "original_payment": 0,
    "new_payment": 0,
    "difference": 0,
    "percentage_change": 0,
    "primary_driver": "which component contributed most",
    "clinically_justifiable": true/false,
    "justification_notes": "why or why not"
  },
  "documentation_requirements": {
    "required_narratives": ["specific observations needed"],
    "supporting_evidence": ["clinical evidence required"],
    "cms_compliance_notes": "compliance considerations"
  },
  "implementation": {
    "realistic": true/false,
    "realistic_rating": 0-100,
    "clinical_evidence_needed": ["what to document"],
    "training_needs": ["staff training required"],
    "risk_factors": ["potential challenges"]
  },
  "summary": "one sentence summary of impact"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            functional_level_impact: { type: "object" },
            grouping_changes: { type: "object" },
            payment_breakdown: { type: "object" },
            documentation_requirements: { type: "object" },
            implementation: { type: "object" },
            summary: { type: "string" }
          }
        }
      });

      setSimulationResults({
        paymentData: response.data,
        analysis: analysis
      });
    } catch (err) {
      console.error("Simulation error:", err);
    }

    setIsSimulating(false);
  };

  const handleScoreChange = (item, value) => {
    setSimulatedScores(prev => ({
      ...prev,
      [item]: value[0]
    }));
  };

  const getEffortColor = (effort) => {
    switch (effort) {
      case 'low': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const chartData = predictions?.scenarios?.map(s => ({
    name: (s.name || '').split(' ')[0],
    Payment: s.projected_payment,
    Increase: s.payment_increase
  })) || [];

  const trajectoryData = predictions?.financial_trajectory ? [
    { month: 'Month 1', Conservative: predictions.financial_trajectory.month_1?.conservative, Realistic: predictions.financial_trajectory.month_1?.realistic, Optimistic: predictions.financial_trajectory.month_1?.optimistic },
    { month: 'Month 3', Conservative: predictions.financial_trajectory.month_3?.conservative, Realistic: predictions.financial_trajectory.month_3?.realistic, Optimistic: predictions.financial_trajectory.month_3?.optimistic },
    { month: 'Month 6', Conservative: predictions.financial_trajectory.month_6?.conservative, Realistic: predictions.financial_trajectory.month_6?.realistic, Optimistic: predictions.financial_trajectory.month_6?.optimistic },
    { month: 'Month 12', Conservative: predictions.financial_trajectory.month_12?.conservative, Realistic: predictions.financial_trajectory.month_12?.realistic, Optimistic: predictions.financial_trajectory.month_12?.optimistic }
  ] : [];

  if (!pdgmData) return null;

  const mItemConfig = {
    m1800_grooming: { label: "M1800 Grooming", max: 3, icon: Activity },
    m1810_dress_upper: { label: "M1810 Dress Upper", max: 3, icon: Activity },
    m1820_dress_lower: { label: "M1820 Dress Lower", max: 3, icon: Activity },
    m1830_bathing: { label: "M1830 Bathing", max: 6, icon: Activity },
    m1840_toilet_transfer: { label: "M1840 Toilet Transfer", max: 4, icon: Activity },
    m1850_transferring: { label: "M1850 Transferring", max: 5, icon: Activity },
    m1860_ambulation: { label: "M1860 Ambulation", max: 6, icon: Activity }
  };

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-navy-50 to-gold-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            PDGM Predictive Forecaster
          </div>
          <div className="flex items-center gap-2">
            {currentPayment && (
              <Badge className="bg-slate-600 text-white text-lg px-3">
                Current: {formatCurrency(currentPayment)}
              </Badge>
            )}
            <Button
              variant={simulationMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setSimulationMode(!simulationMode);
                if (!simulationMode && !simulatedScores) {
                  initSimulationScores();
                }
              }}
              className={simulationMode ? "bg-orange-600 hover:bg-orange-700" : ""}
            >
              <Sliders className="w-4 h-4 mr-2" />
              {simulationMode ? "Exit" : "Simulate"} Changes
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Documentation Improvement Simulator */}
        {simulationMode && (
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 p-4 rounded-lg border-2 border-orange-300 space-y-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-orange-600" />
                <h3 className="font-semibold text-orange-900">Documentation Improvement Simulator</h3>
              </div>
              <Badge className="bg-orange-600 text-white">Live PDGM Calculation</Badge>
            </div>

            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-blue-800 text-xs">
                Adjust functional scores below to see real-time impact on PDGM grouping and payment. 
                This shows how specific documentation improvements affect classification and revenue.
              </AlertDescription>
            </Alert>

            {/* Functional Score Sliders */}
            <div className="space-y-3">
              {Object.entries(mItemConfig).map(([key, config]) => {
                const currentValue = simulatedScores?.[key] || 0;
                const originalValue = pdgmData?.functional_scores?.[key] || 0;
                const hasChanged = currentValue !== originalValue;

                return (
                  <div key={key} className="bg-white p-3 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <config.icon className="w-4 h-4 text-slate-600" />
                        <span className="text-sm font-medium text-slate-900">{config.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasChanged && (
                          <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-300">
                            {originalValue} → {currentValue}
                          </Badge>
                        )}
                        <Badge className={`text-sm ${hasChanged ? 'bg-orange-600' : 'bg-slate-600'}`}>
                          {currentValue}
                        </Badge>
                      </div>
                    </div>
                    <Slider
                      value={[currentValue]}
                      onValueChange={(v) => handleScoreChange(key, v)}
                      max={config.max}
                      step={1}
                      className="mt-2"
                    />
                    <div className="flex justify-between text-xs text-slate-500 mt-1">
                      <span>0 (Independent)</span>
                      <span>{config.max} (Dependent)</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Calculate Button */}
            <Button
              onClick={runSimulation}
              disabled={isSimulating || !simulatedScores}
              className="w-full bg-orange-600 hover:bg-orange-700"
            >
              {isSimulating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Calculating Impact...</>
              ) : (
                <><Target className="w-4 h-4 mr-2" /> Calculate PDGM Impact</>
              )}
            </Button>

            {/* Simulation Results */}
            {simulationResults && (
              <div className="space-y-3 mt-4 pt-4 border-t border-orange-300">
                {/* Summary */}
                <div className="bg-white p-3 rounded-lg border-2 border-orange-300">
                  <p className="text-sm font-semibold text-orange-900 mb-2">
                    {simulationResults.analysis.summary}
                  </p>
                </div>

                {/* Payment Impact */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white p-3 rounded text-center border">
                    <p className="text-xs text-slate-500 mb-1">Original</p>
                    <p className="text-lg font-bold text-slate-700">
                      {formatCurrency(simulationResults.analysis.payment_breakdown?.original_payment)}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded text-center border">
                    <ArrowRight className="w-5 h-5 text-orange-500 mx-auto mb-1" />
                    <p className="text-xs text-orange-600">
                      {simulationResults.analysis.payment_breakdown?.difference >= 0 ? '+' : ''}
                      {simulationResults.analysis.payment_breakdown?.percentage_change}%
                    </p>
                  </div>
                  <div className={`p-3 rounded text-center border-2 ${
                    simulationResults.analysis.payment_breakdown?.difference >= 0 
                      ? 'bg-green-50 border-green-300' 
                      : 'bg-red-50 border-red-300'
                  }`}>
                    <p className="text-xs text-slate-500 mb-1">Simulated</p>
                    <p className={`text-lg font-bold ${
                      simulationResults.analysis.payment_breakdown?.difference >= 0 
                        ? 'text-green-700' 
                        : 'text-red-700'
                    }`}>
                      {formatCurrency(simulationResults.analysis.payment_breakdown?.new_payment)}
                    </p>
                  </div>
                </div>

                {/* Functional Level Impact */}
                {simulationResults.analysis.functional_level_impact && (
                  <div className="bg-white p-3 rounded-lg border">
                    <p className="text-xs font-semibold text-slate-700 mb-2">Functional Level Impact</p>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">
                          {simulationResults.analysis.functional_level_impact.original_level}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          ({simulationResults.analysis.functional_level_impact.original_points} pts)
                        </span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400" />
                      <div className="flex items-center gap-2">
                        <Badge className={`capitalize ${
                          simulationResults.analysis.functional_level_impact.changed 
                            ? 'bg-orange-600' 
                            : 'bg-slate-600'
                        }`}>
                          {simulationResults.analysis.functional_level_impact.new_level}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          ({simulationResults.analysis.functional_level_impact.new_points} pts)
                        </span>
                      </div>
                    </div>
                    {simulationResults.analysis.functional_level_impact.driving_changes?.length > 0 && (
                      <div className="text-xs text-slate-600">
                        <p className="font-medium mb-1">Key Changes:</p>
                        <ul className="space-y-0.5">
                          {simulationResults.analysis.functional_level_impact.driving_changes.map((change, idx) => (
                            <li key={idx}>• {change}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* PDGM Grouping Changes */}
                {simulationResults.analysis.grouping_changes && (
                  <div className="bg-white p-3 rounded-lg border">
                    <p className="text-xs font-semibold text-slate-700 mb-2">PDGM Grouping Changes</p>
                    
                    {simulationResults.analysis.grouping_changes.clinical_group_changed ? (
                      <div className="bg-yellow-50 p-2 rounded border border-yellow-300 mb-2">
                        <p className="text-xs font-medium text-yellow-800 mb-1">⚠️ Clinical Group Changed</p>
                        <div className="flex items-center gap-2 text-xs">
                          <span>{simulationResults.analysis.grouping_changes.clinical_group_from}</span>
                          <ArrowRight className="w-3 h-3" />
                          <span className="font-bold">{simulationResults.analysis.grouping_changes.clinical_group_to}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-green-700 mb-2">✓ Clinical group unchanged</p>
                    )}
                    
                    {simulationResults.analysis.grouping_changes.comorbidity_adjustment_changed && (
                      <p className="text-xs text-orange-700 mb-2">⚠️ Comorbidity adjustment impacted</p>
                    )}
                    
                    <p className="text-xs text-slate-600">
                      {simulationResults.analysis.grouping_changes.case_mix_multiplier_impact}
                    </p>
                  </div>
                )}

                {/* Documentation Requirements */}
                {simulationResults.analysis.documentation_requirements && (
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <p className="text-xs font-semibold text-blue-900 mb-2">Documentation Requirements</p>
                    
                    {simulationResults.analysis.documentation_requirements.required_narratives?.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs font-medium text-blue-800 mb-1">Required Narratives:</p>
                        <ul className="text-xs text-blue-700 space-y-0.5">
                          {simulationResults.analysis.documentation_requirements.required_narratives.slice(0, 3).map((narrative, idx) => (
                            <li key={idx}>• {narrative}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {simulationResults.analysis.documentation_requirements.cms_compliance_notes && (
                      <p className="text-xs text-blue-600 italic">
                        {simulationResults.analysis.documentation_requirements.cms_compliance_notes}
                      </p>
                    )}
                  </div>
                )}

                {/* Implementation Feasibility */}
                {simulationResults.analysis.implementation && (
                  <div className={`p-3 rounded-lg border-2 ${
                    simulationResults.analysis.implementation.realistic 
                      ? 'bg-green-50 border-green-300' 
                      : 'bg-red-50 border-red-300'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-slate-800">Implementation Feasibility</p>
                      <Badge className={
                        simulationResults.analysis.implementation.realistic 
                          ? 'bg-green-600' 
                          : 'bg-red-600'
                      }>
                        {simulationResults.analysis.implementation.realistic_rating}% Realistic
                      </Badge>
                    </div>
                    
                    {simulationResults.analysis.implementation.clinical_evidence_needed?.length > 0 && (
                      <div className="text-xs text-slate-700">
                        <p className="font-medium mb-1">Evidence Needed:</p>
                        <ul className="space-y-0.5">
                          {simulationResults.analysis.implementation.clinical_evidence_needed.slice(0, 2).map((evidence, idx) => (
                            <li key={idx}>• {evidence}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Case-Mix Comparison Chart */}
                {simulationResults.paymentData?.original && simulationResults.paymentData?.corrected && (
                  <div className="bg-white p-3 rounded-lg border">
                    <p className="text-xs font-semibold text-slate-700 mb-2">Case-Mix Component Comparison</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <RechartsLineChart data={[
                        { 
                          component: 'Clinical',
                          Original: simulationResults.paymentData.original.clinicalWeight,
                          Simulated: simulationResults.paymentData.corrected.clinicalWeight
                        },
                        { 
                          component: 'Functional',
                          Original: simulationResults.paymentData.original.functionalMultiplier,
                          Simulated: simulationResults.paymentData.corrected.functionalMultiplier
                        },
                        { 
                          component: 'Comorbidity',
                          Original: simulationResults.paymentData.original.comorbidityMultiplier,
                          Simulated: simulationResults.paymentData.corrected.comorbidityMultiplier
                        }
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="component" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: '10px' }} />
                        <Line type="monotone" dataKey="Original" stroke="#6b7280" strokeWidth={2} />
                        <Line type="monotone" dataKey="Simulated" stroke="#ea580c" strokeWidth={2} />
                      </RechartsLineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Original Predictive Scenarios */}
        {!simulationMode && (
          <>
            {isPredicting ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-navy-600 mx-auto mb-3" />
                <p className="text-sm text-slate-600">Generating predictive scenarios...</p>
              </div>
            ) : !predictions ? (
          <Button onClick={generatePredictions} className="w-full bg-navy-600 hover:bg-navy-700">
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Revenue Predictions
          </Button>
        ) : (
          <>
            {/* Payment Scenarios Comparison */}
            <div className="bg-gradient-to-r from-indigo-50 to-navy-50 p-4 rounded-lg border border-navy-200">
              <h3 className="font-semibold text-navy-900 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Payment Scenarios
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="Payment" fill="#8b5cf6" />
                  <Bar dataKey="Increase" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Scenario Cards */}
            <div className="space-y-3">
              {predictions.scenarios?.map((scenario, idx) => (
                <div 
                  key={idx}
                  className={`p-4 rounded-lg border-2 ${
                    idx === 0 ? 'bg-slate-50 border-slate-300' :
                    idx === 1 ? 'bg-green-50 border-green-300' :
                    idx === predictions.scenarios.length - 1 ? 'bg-navy-50 border-navy-300' :
                    'bg-blue-50 border-blue-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-slate-400">#{idx + 1}</span>
                      <div>
                        <h4 className="font-bold text-slate-900">{scenario.name}</h4>
                        <p className="text-xs text-slate-600">{scenario.description}</p>
                      </div>
                    </div>
                    <Badge className={getEffortColor(scenario.implementation_effort)}>
                      {scenario.implementation_effort} effort
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2 my-3">
                    <div className="bg-white p-2 rounded text-center">
                      <p className="text-xs text-slate-500">Payment</p>
                      <p className="text-lg font-bold text-navy-700">
                        {formatCurrency(scenario.projected_payment)}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded text-center">
                      <p className="text-xs text-slate-500">Increase</p>
                      <p className="text-lg font-bold text-green-700">
                        +{formatCurrency(scenario.payment_increase)}
                      </p>
                      <p className="text-xs text-green-600">+{scenario.percentage_increase}%</p>
                    </div>
                    <div className="bg-white p-2 rounded text-center">
                      <p className="text-xs text-slate-500">Annual</p>
                      <p className="text-lg font-bold text-indigo-700">
                        {formatCurrency(scenario.annual_impact)}
                      </p>
                    </div>
                  </div>

                  <div className="bg-white/50 p-2 rounded mb-2 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-600">Timeline: <strong>{scenario.implementation_timeline}</strong></span>
                      <span className="text-slate-600">ROI: <strong>{scenario.roi_timeline}</strong></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600">Probability:</span>
                      <Progress value={scenario.probability} className="h-2 flex-1" />
                      <span className="font-bold text-navy-700">{scenario.probability}%</span>
                    </div>
                  </div>

                  {scenario.changes && scenario.changes.length > 0 && (
                    <div className="space-y-1 mb-2">
                      <p className="text-xs font-semibold text-slate-700">Key Changes:</p>
                      {scenario.changes.slice(0, 3).map((change, cIdx) => (
                        <div key={cIdx} className="flex items-center gap-2 text-xs bg-white p-1.5 rounded">
                          <ArrowRight className="w-3 h-3 text-blue-500 flex-shrink-0" />
                          <span className="text-slate-700">{change.item}: <strong>{change.to}</strong></span>
                        </div>
                      ))}
                      {scenario.changes.length > 3 && (
                        <p className="text-xs text-slate-500 italic">+{scenario.changes.length - 3} more changes</p>
                      )}
                    </div>
                  )}

                  {scenario.key_actions && scenario.key_actions.length > 0 && (
                    <div className="bg-blue-50 p-2 rounded border border-blue-200">
                      <p className="text-xs font-semibold text-blue-700 mb-1">Actions Needed:</p>
                      <ul className="text-xs text-blue-800 space-y-0.5">
                        {scenario.key_actions.slice(0, 2).map((action, aIdx) => (
                          <li key={aIdx}>• {action}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Financial Trajectory */}
            {predictions.financial_trajectory && (
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border border-green-200">
                <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                  <LineChart className="w-4 h-4" />
                  12-Month Revenue Trajectory
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={trajectoryData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    <Bar dataKey="Conservative" fill="#6b7280" />
                    <Bar dataKey="Realistic" fill="#3557b0" />
                    <Bar dataKey="Optimistic" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-green-700 text-center mt-2">
                  Cumulative impact based on {agencySettings?.avg_episodes_per_year || 50} similar episodes/year
                </p>
              </div>
            )}

            {/* Breakeven Analysis */}
            {predictions.breakeven_analysis && (
              <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                <h3 className="font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Breakeven Analysis
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(predictions.breakeven_analysis).map(([key, data]) => (
                    <div key={key} className="bg-white p-3 rounded border text-center">
                      <p className="text-xs text-slate-600 mb-1 capitalize">{key.replace('_', ' ')}</p>
                      <p className="text-sm font-bold text-indigo-700">
                        {data.episodes_to_breakeven} episodes
                      </p>
                      <p className="text-xs text-slate-600">{data.time_to_breakeven}</p>
                      <p className="text-xs text-slate-500 mt-1">Cost: {formatCurrency(data.cost)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {predictions.recommendations && (
              <div className="bg-gradient-to-r from-navy-50 to-blue-50 p-4 rounded-lg border border-navy-200">
                <h3 className="font-semibold text-navy-900 mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Strategic Roadmap
                </h3>
                <div className="space-y-3">
                  <div className="bg-white p-3 rounded border border-red-200">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="bg-red-600 text-white text-xs">NOW</Badge>
                      <p className="text-xs font-semibold text-slate-700">Immediate Focus</p>
                    </div>
                    <p className="text-sm text-slate-800">{predictions.recommendations.immediate_focus}</p>
                  </div>
                  <div className="bg-white p-3 rounded border border-orange-200">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="bg-orange-500 text-white text-xs">30 DAYS</Badge>
                      <p className="text-xs font-semibold text-slate-700">Short-Term Goals</p>
                    </div>
                    <p className="text-sm text-slate-800">{predictions.recommendations['30_day_goals']}</p>
                  </div>
                  <div className="bg-white p-3 rounded border border-blue-200">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="bg-blue-600 text-white text-xs">90 DAYS</Badge>
                      <p className="text-xs font-semibold text-slate-700">Long-Term Goals</p>
                    </div>
                    <p className="text-sm text-slate-800">{predictions.recommendations['90_day_goals']}</p>
                  </div>
                </div>
                {predictions.recommendations.success_metrics && (
                  <div className="mt-3 bg-white p-2 rounded border">
                    <p className="text-xs font-semibold text-slate-700 mb-1">Success Metrics:</p>
                    <ul className="text-xs text-slate-700 space-y-0.5">
                      {predictions.recommendations.success_metrics.map((metric, idx) => (
                        <li key={idx} className="flex items-start gap-1">
                          <CheckCircle2 className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                          {metric}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <Button
              onClick={() => { setPredictions(null); setHasAutoPredicted(false); }}
              variant="outline"
              size="sm"
              className="w-full"
            >
              Regenerate Predictions
            </Button>
          </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}