import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { base44 } from "@/api/base44Client";
import { 
  Brain, 
  Loader2, 
  TrendingUp, 
  AlertTriangle, 
  DollarSign,
  Code,
  Target,
  Lightbulb,
  BarChart3
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PayerInsightsPanel() {
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState(null);
  const [insightType, setInsightType] = useState('comprehensive');
  const [serviceCode, setServiceCode] = useState('');

  const generateInsights = async (type) => {
    setLoading(true);
    setInsightType(type);
    try {
      const response = await base44.functions.invoke('generatePayerInsights', {
        insight_type: type,
        service_code: serviceCode || undefined
      });
      setInsights(response.data);
    } catch (error) {
      console.error('Error generating insights:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'high':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'low':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
    }
  };

  const getRiskColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'high':
        return 'border-red-500 bg-red-50 dark:bg-red-950';
      case 'medium':
        return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950';
      case 'low':
        return 'border-green-500 bg-green-50 dark:bg-green-950';
      default:
        return 'border-slate-300';
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-700">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-600" />
          AI Payer Insights & Predictions
        </CardTitle>
        <CardDescription>
          AI-powered analytics for reimbursement optimization, denial risk, and billing efficiency
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Service Code (Optional)</Label>
            <Input
              placeholder="e.g., 99213, 97110"
              value={serviceCode}
              onChange={(e) => setServiceCode(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Button
            onClick={() => generateInsights('reimbursement_prediction')}
            disabled={loading}
            variant="outline"
            className="flex items-center gap-2"
          >
            <DollarSign className="w-4 h-4" />
            Predict Rates
          </Button>
          <Button
            onClick={() => generateInsights('denial_risk_analysis')}
            disabled={loading}
            variant="outline"
            className="flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4" />
            Denial Risk
          </Button>
          <Button
            onClick={() => generateInsights('modifier_optimization')}
            disabled={loading}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Code className="w-4 h-4" />
            Modifier Tips
          </Button>
          <Button
            onClick={() => generateInsights('comprehensive')}
            disabled={loading}
            variant="outline"
            className="flex items-center gap-2"
          >
            <BarChart3 className="w-4 h-4" />
            Full Analysis
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            <span className="ml-3 text-slate-600">Analyzing payer data...</span>
          </div>
        )}

        {insights && !loading && (
          <div className="mt-6">
            {/* Reimbursement Prediction Insights */}
            {insights.insights?.predicted_range && (
              <div className="space-y-4">
                <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950 dark:to-blue-950 p-6 rounded-lg border border-green-200 dark:border-green-800">
                  <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-green-600" />
                    Predicted Reimbursement for {insights.insights.code_analyzed}
                  </h3>
                  <p className="text-3xl font-bold text-green-700 dark:text-green-300">
                    {insights.insights.predicted_range}
                  </p>
                </div>

                {insights.insights.average_by_payer_type && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Average Rates by Payer Type</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {Object.entries(insights.insights.average_by_payer_type).map(([type, rate]) => (
                        <div key={type} className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg">
                          <p className="text-xs text-slate-600 dark:text-slate-400">{type}</p>
                          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{rate}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {insights.insights.top_payers && insights.insights.top_payers.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Top Paying Payers</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {insights.insights.top_payers.map((payer, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                          <div>
                            <p className="font-medium">{payer.payer_name}</p>
                            <p className="text-xs text-slate-600 dark:text-slate-400">{payer.notes}</p>
                          </div>
                          <Badge className="bg-green-600 text-white">{payer.rate}</Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {insights.insights.state_variations && insights.insights.state_variations.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">State-by-State Variations</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {insights.insights.state_variations.map((variation, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 border-b last:border-0">
                          <div>
                            <Badge variant="secondary" className="mr-2">{variation.state}</Badge>
                            <span className="text-sm">{variation.note}</span>
                          </div>
                          <span className="font-medium text-sm">{variation.avg_rate}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Denial Risk Analysis */}
            {insights.insights?.high_risk_payers && (
              <div className="space-y-4">
                <Card className="border-orange-200 dark:border-orange-800">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-orange-600" />
                      High Prior Authorization Denial Risk
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {insights.insights.high_risk_payers.map((payer, idx) => (
                      <Card key={idx} className={`border-l-4 ${getRiskColor(payer.risk_level)}`}>
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between mb-2">
                            <h4 className="font-semibold">{payer.payer_name}</h4>
                            <Badge className={getSeverityColor(payer.risk_level)}>
                              {payer.risk_level} risk ({payer.risk_score}/100)
                            </Badge>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Reasons:</p>
                              <ul className="ml-4 mt-1 space-y-1">
                                {payer.reasons?.map((reason, i) => (
                                  <li key={i} className="text-sm text-slate-600 dark:text-slate-400 list-disc">
                                    {reason}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-950 p-2 rounded">
                              <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">
                                Mitigation Strategies:
                              </p>
                              <ul className="ml-4 space-y-1">
                                {payer.mitigation_strategies?.map((strategy, i) => (
                                  <li key={i} className="text-sm text-blue-600 dark:text-blue-400 list-disc">
                                    {strategy}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                </Card>

                {insights.insights.denial_patterns && insights.insights.denial_patterns.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Common Denial Patterns</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {insights.insights.denial_patterns.map((pattern, idx) => (
                        <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                          <p className="text-sm font-medium mb-1">{pattern.pattern}</p>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            Affects: {pattern.affected_payers?.join(', ')}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Modifier Optimization */}
            {insights.insights?.recommended_modifiers && (
              <div className="space-y-4">
                <Card className="border-indigo-200 dark:border-indigo-800">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Code className="w-5 h-5 text-indigo-600" />
                      Recommended Billing Modifiers
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {insights.insights.recommended_modifiers.map((mod, idx) => (
                      <Card key={idx} className="border-l-4 border-l-indigo-500">
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <Badge className="bg-indigo-600 text-white mb-2">{mod.modifier}</Badge>
                              <p className="font-medium">{mod.description}</p>
                            </div>
                          </div>
                          <div className="space-y-2 mt-3">
                            <div className="bg-blue-50 dark:bg-blue-950 p-2 rounded">
                              <p className="text-xs font-medium text-blue-700 dark:text-blue-300">When to Use:</p>
                              <p className="text-sm text-blue-600 dark:text-blue-400">{mod.when_to_use}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                Payers Requiring: {mod.payers_requiring?.join(', ')}
                              </p>
                            </div>
                            <div className="bg-green-50 dark:bg-green-950 p-2 rounded">
                              <p className="text-xs text-green-700 dark:text-green-300">
                                <TrendingUp className="w-3 h-3 inline mr-1" />
                                {mod.impact_on_reimbursement}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                </Card>

                {insights.insights.common_mistakes && insights.insights.common_mistakes.length > 0 && (
                  <Card className="border-orange-200 dark:border-orange-800">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-600" />
                        Common Mistakes to Avoid
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {insights.insights.common_mistakes.map((mistake, idx) => (
                        <div key={idx} className="p-3 border-l-4 border-l-orange-500 bg-orange-50 dark:bg-orange-950 rounded">
                          <p className="text-sm font-medium text-orange-900 dark:text-orange-100 mb-1">
                            ❌ {mistake.mistake}
                          </p>
                          <p className="text-sm text-orange-700 dark:text-orange-300">
                            ✅ {mistake.correction}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Comprehensive Insights */}
            {insights.insights?.database_stats && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-slate-500">Total Payers</p>
                      <p className="text-2xl font-bold">{insights.insights.database_stats.total_payers}</p>
                    </CardContent>
                  </Card>
                  {insights.insights.database_stats.by_type && Object.entries(insights.insights.database_stats.by_type).slice(0, 2).map(([type, count]) => (
                    <Card key={type}>
                      <CardContent className="pt-4">
                        <p className="text-xs text-slate-500">{type}</p>
                        <p className="text-2xl font-bold">{count}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {insights.insights.efficiency_opportunities && insights.insights.efficiency_opportunities.length > 0 && (
                  <Card className="border-green-200 dark:border-green-800">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Target className="w-4 h-4 text-green-600" />
                        Efficiency Opportunities
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {insights.insights.efficiency_opportunities.map((opp, idx) => (
                        <div key={idx} className="p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                          <p className="font-medium text-green-900 dark:text-green-100 mb-1">
                            {opp.opportunity}
                          </p>
                          <p className="text-sm text-green-700 dark:text-green-300 mb-2">
                            Impact: {opp.potential_impact}
                          </p>
                          <p className="text-sm text-green-600 dark:text-green-400">
                            → {opp.action}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {insights.insights.coverage_gaps && insights.insights.coverage_gaps.length > 0 && (
                  <Card className="border-yellow-200 dark:border-yellow-800">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-yellow-600" />
                        Coverage Gaps
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {insights.insights.coverage_gaps.map((gap, idx) => (
                        <div key={idx} className="p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant="secondary">{gap.state}</Badge>
                            <span className="text-xs text-yellow-700 dark:text-yellow-300">{gap.impact}</span>
                          </div>
                          <p className="text-sm text-yellow-800 dark:text-yellow-200">
                            Missing: {gap.missing_payer_types?.join(', ')}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* General Recommendations */}
            {(insights.insights?.recommendations || insights.insights?.top_recommendations) && (
              <Card className="border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950 dark:to-indigo-950">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-purple-600" />
                    AI Recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {(insights.insights.recommendations || insights.insights.top_recommendations)?.map((rec, idx) => (
                      <li key={idx} className="flex gap-2 text-sm">
                        <span className="text-purple-600 font-bold">{idx + 1}.</span>
                        <span className="text-purple-900 dark:text-purple-100">{rec}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {insights.insights?.optimization_opportunities && (
              <Card className="border-blue-200 dark:border-blue-800">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                    Optimization Opportunities
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {insights.insights.optimization_opportunities.map((opp, idx) => (
                      <li key={idx} className="p-2 bg-blue-50 dark:bg-blue-950 rounded text-sm text-blue-900 dark:text-blue-100">
                        💡 {opp}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <div className="text-xs text-slate-500 text-center mt-4">
              Analysis generated: {new Date(insights.generated_at).toLocaleString()}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}