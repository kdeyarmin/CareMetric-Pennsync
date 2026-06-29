import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  TrendingUp,
  Loader2,
  ArrowRight,
  Info,
  PieChart
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function EnhancedPDGMCaseMixAnalyzer({ pdgmData, navigationData }) {
  const [caseMixAnalysis, setCaseMixAnalysis] = useState(null);
  const ai = useAICall();

  const performCaseMixAnalysis = useCallback(async () => {
    if (!pdgmData || !navigationData?.case_mix_calculation) return;


    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Perform detailed PDGM case-mix component analysis showing the dollar contribution of each factor.

PDGM DATA:
${JSON.stringify(navigationData, null, 2)}

FUNCTIONAL SCORES:
${JSON.stringify(pdgmData.functional_scores, null, 2)}

COMORBIDITIES:
${JSON.stringify(pdgmData.comorbidities, null, 2)}

Calculate the exact dollar contribution of each case-mix component:

1. BASE PAYMENT RATE
   - National base rate: $X
   - Wage index adjustment: ${pdgmData.wage_index || 1.0}
   - Adjusted base: $X

2. CLINICAL GROUP WEIGHT
   - Weight value: ${navigationData.clinical_group?.weight || 'N/A'}
   - Clinical group: ${navigationData.clinical_group?.assigned_group || 'N/A'}
   - Dollar contribution: Base × Weight = $X
   - Percentage of total payment: X%

3. FUNCTIONAL IMPAIRMENT MULTIPLIER
   - Multiplier value: ${navigationData.functional_level?.multiplier || 'N/A'}
   - Functional level: ${navigationData.functional_level?.level || 'N/A'}
   - Points: ${navigationData.functional_level?.points || 'N/A'}
   - Dollar contribution: (Base × Clinical) × Functional = $X
   - Percentage of total payment: X%
   - M-item breakdown: Show which M-items contributed most points

4. COMORBIDITY ADJUSTMENT MULTIPLIER  
   - Multiplier value: ${navigationData.comorbidity_adjustment?.multiplier || 'N/A'}
   - Adjustment level: ${navigationData.comorbidity_adjustment?.level || 'N/A'}
   - Dollar contribution: Previous total × Comorbidity = $X
   - Percentage of total payment: X%
   - Comorbidity point breakdown

5. TIMING/SOURCE ADJUSTMENT
   - Episode timing: ${pdgmData.episode_timing || 'N/A'}
   - Admission source: ${pdgmData.admission_source || 'N/A'}
   - Timing multiplier: ${navigationData.admission_timing?.timing_multiplier || 'N/A'}
   - Dollar contribution: $X
   - Percentage of total payment: X%

6. FINAL PAYMENT CALCULATION
   - Total payment: $X
   - Show formula with actual dollar amounts at each step

7. OPTIMIZATION OPPORTUNITIES
   - Which component has most improvement potential
   - What specific changes would yield highest dollar impact
   - For each potential change, show:
     * Current value vs potential value
     * Dollar increase
     * Required documentation changes
     * Clinical justification needed

Return detailed JSON with exact dollar amounts:`,
        response_json_schema: {
          type: "object",
          properties: {
            base_payment: {
              type: "object",
              properties: {
                national_base_rate: { type: "number" },
                wage_index: { type: "number" },
                adjusted_base: { type: "number" }
              }
            },
            component_contributions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  component: { type: "string" },
                  value: { type: "number" },
                  dollar_contribution: { type: "number" },
                  percentage_of_total: { type: "number" },
                  details: { type: "string" }
                }
              }
            },
            functional_m_item_breakdown: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  m_item: { type: "string" },
                  score: { type: "number" },
                  points: { type: "number" },
                  contribution_to_level: { type: "string" }
                }
              }
            },
            comorbidity_breakdown: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  comorbidity: { type: "string" },
                  icd10_code: { type: "string" },
                  points: { type: "number" }
                }
              }
            },
            payment_formula_steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step: { type: "string" },
                  calculation: { type: "string" },
                  result: { type: "number" }
                }
              }
            },
            optimization_opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  component: { type: "string" },
                  current_value: { type: "number" },
                  potential_value: { type: "number" },
                  dollar_increase: { type: "number" },
                  specific_changes_needed: { type: "array", items: { type: "string" } },
                  clinical_justification_required: { type: "string" },
                  implementation_difficulty: { type: "string" }
                }
              }
            },
            total_payment: { type: "number" }
          }
        }
      });

      setCaseMixAnalysis(result);
    } catch (error) {
      console.error("Case-mix analysis error:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [pdgmData, navigationData]);

  useEffect(() => {
    if (pdgmData && navigationData?.case_mix_calculation && !caseMixAnalysis) {
      performCaseMixAnalysis();
    }
  }, [pdgmData, navigationData, caseMixAnalysis, performCaseMixAnalysis]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  const getDifficultyColor = (difficulty) => {
    const colors = {
      low: 'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-orange-100 text-orange-800'
    };
    return colors[difficulty] || 'bg-slate-100 text-slate-800';
  };

  if (!caseMixAnalysis) {
    return (
      <Card className="border-2 border-indigo-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <PieChart className="w-5 h-5 text-indigo-600" />
            Case-Mix Component Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4">
          {ai.loading ? (
            <div className="text-center">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto mb-2" />
              <p className="text-xs text-slate-600">Analyzing case-mix components...</p>
            </div>
          ) : (
            <p className="text-sm text-slate-600 text-center">Loading case-mix analysis...</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const chartData = caseMixAnalysis.component_contributions?.map(comp => ({
    name: comp.component,
    value: comp.dollar_contribution,
    percentage: comp.percentage_of_total
  })) || [];

  const COLORS = ['#264491', '#8B5CF6', '#0d9488', '#F59E0B', '#10B981'];

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChart className="w-5 h-5 text-indigo-600" />
            Case-Mix Component Breakdown
          </div>
          <Badge className="bg-indigo-600 text-white text-lg">
            {formatCurrency(caseMixAnalysis.total_payment)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Component Contributions Chart */}
        <div className="bg-white p-3 rounded-lg border">
          <p className="text-sm font-semibold text-slate-700 mb-3">Dollar Contribution by Component</p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(value) => formatCurrency(value)} />
              <Bar dataKey="value" name="Dollar Contribution">
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Component Details */}
        <div className="space-y-2">
          {caseMixAnalysis.component_contributions?.map((component, idx) => (
            <div key={idx} className="bg-gradient-to-r from-slate-50 to-slate-50 p-3 rounded border">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                  <span className="text-sm font-medium text-slate-900">{component.component}</span>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-900">{formatCurrency(component.dollar_contribution)}</p>
                  <p className="text-xs text-slate-500">{component.percentage_of_total}% of total</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-slate-600">Multiplier:</span>
                <Badge variant="outline" className="text-xs">{component.value}</Badge>
              </div>
              <p className="text-xs text-slate-600">{component.details}</p>
            </div>
          ))}
        </div>

        {/* Functional M-Item Breakdown */}
        {caseMixAnalysis.functional_m_item_breakdown?.length > 0 && (
          <div className="bg-navy-50 p-3 rounded border border-navy-200">
            <p className="text-sm font-semibold text-navy-900 mb-2">Functional M-Item Point Breakdown</p>
            <div className="space-y-1">
              {caseMixAnalysis.functional_m_item_breakdown.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs bg-white p-2 rounded">
                  <span className="text-slate-700">{item.m_item}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Score: {item.score}</Badge>
                    <Badge className="bg-navy-600 text-white">{item.points} pts</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comorbidity Breakdown */}
        {caseMixAnalysis.comorbidity_breakdown?.length > 0 && (
          <div className="bg-orange-50 p-3 rounded border border-orange-200">
            <p className="text-sm font-semibold text-orange-900 mb-2">Comorbidity Point Breakdown</p>
            <div className="space-y-1">
              {caseMixAnalysis.comorbidity_breakdown.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs bg-white p-2 rounded">
                  <div>
                    <p className="text-slate-800 font-medium">{item.comorbidity}</p>
                    <p className="text-slate-500 text-[10px]">{item.icd10_code}</p>
                  </div>
                  <Badge className="bg-orange-600 text-white">{item.points} pts</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Payment Calculation Steps */}
        {caseMixAnalysis.payment_formula_steps?.length > 0 && (
          <div className="bg-blue-50 p-3 rounded border border-blue-200">
            <p className="text-sm font-semibold text-blue-900 mb-2">Payment Calculation Formula</p>
            <div className="space-y-2">
              {caseMixAnalysis.payment_formula_steps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <Badge className="bg-blue-600 text-white w-6 h-6 flex items-center justify-center p-0">
                    {idx + 1}
                  </Badge>
                  <div className="flex-1 bg-white p-2 rounded border">
                    <p className="text-slate-800 font-medium mb-1">{step.step}</p>
                    <p className="text-slate-600 font-mono text-[10px]">{step.calculation}</p>
                    <p className="text-blue-700 font-bold">{formatCurrency(step.result)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Optimization Opportunities */}
        {caseMixAnalysis.optimization_opportunities?.length > 0 && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-lg border-2 border-green-300">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-5 h-5 text-green-600" />
              <span className="font-semibold text-green-900">Component Optimization Opportunities</span>
            </div>
            <div className="space-y-3">
              {caseMixAnalysis.optimization_opportunities
                .sort((a, b) => b.dollar_increase - a.dollar_increase)
                .map((opp, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border-2 border-green-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-900">{opp.component}</span>
                      <Badge className="bg-green-600 text-white">
                        +{formatCurrency(opp.dollar_increase)}
                      </Badge>
                    </div>
                    
                    <div className="flex items-center gap-3 mb-2 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-600">Current:</span>
                        <Badge variant="outline">{opp.current_value}</Badge>
                      </div>
                      <ArrowRight className="w-3 h-3 text-green-600" />
                      <div className="flex items-center gap-1">
                        <span className="text-slate-600">Potential:</span>
                        <Badge className="bg-green-100 text-green-800">{opp.potential_value}</Badge>
                      </div>
                    </div>

                    {opp.specific_changes_needed?.length > 0 && (
                      <div className="bg-blue-50 p-2 rounded mb-2">
                        <p className="text-xs font-medium text-blue-800 mb-1">Required Changes:</p>
                        <ul className="text-xs text-blue-700 space-y-0.5">
                          {opp.specific_changes_needed.map((change, cIdx) => (
                            <li key={cIdx}>• {change}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                      <p className="text-xs text-yellow-800">
                        <strong>Clinical Justification:</strong> {opp.clinical_justification_required}
                      </p>
                    </div>

                    <div className="flex items-center justify-between mt-2">
                      <Badge className={getDifficultyColor(opp.implementation_difficulty)}>
                        {opp.implementation_difficulty} difficulty
                      </Badge>
                      <span className="text-xs text-slate-500">
                        ROI: {formatCurrency(opp.dollar_increase)} / {opp.implementation_difficulty} effort
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Total Payment Summary */}
        <Alert className="bg-gradient-to-r from-indigo-100 to-navy-100 border-indigo-300">
          <Info className="w-4 h-4 text-indigo-700" />
          <AlertDescription className="text-indigo-900">
            <p className="font-semibold mb-1">Total PDGM Payment: {formatCurrency(caseMixAnalysis.total_payment)}</p>
            <p className="text-xs">
              This breakdown shows exactly how each case-mix component contributes to the final payment. 
              Focus optimization efforts on components with highest dollar improvement potential.
            </p>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}