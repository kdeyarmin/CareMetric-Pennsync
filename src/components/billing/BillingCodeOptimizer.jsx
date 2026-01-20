import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Code, TrendingUp, CheckCircle, Lightbulb, DollarSign, Target } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function BillingCodeOptimizer({ payerId = null }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [applyingRecommendations, setApplyingRecommendations] = useState([]);
  const queryClient = useQueryClient();

  const analyzePatterns = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('analyzeBillingCodePatterns', {
        payer_id: payerId
      });
      setAnalysis(response.data.analysis);
      
      const totalRecs = response.data.analysis?.optimization_summary?.total_recommendations || 0;
      toast.success(`Analysis complete - ${totalRecs} optimization opportunities found`);
    } catch (error) {
      console.error('Error analyzing patterns:', error);
      toast.error('Failed to analyze billing patterns');
    } finally {
      setLoading(false);
    }
  };

  const applyRecommendation = async (payerDbId, recommendation) => {
    setApplyingRecommendations(prev => [...prev, `${payerDbId}-${recommendation.code}`]);
    
    try {
      const payer = await base44.entities.Payer.get(payerDbId);
      
      // Find and update the billing code
      const updatedCodes = payer.billing_codes.map(code => {
        if (code.code === recommendation.code) {
          return {
            ...code,
            modifier_codes: recommendation.suggested_modifiers
          };
        }
        return code;
      });

      await base44.entities.Payer.update(payerDbId, {
        billing_codes: updatedCodes
      });

      toast.success(`Updated modifiers for ${recommendation.code}`);
      queryClient.invalidateQueries(['payers']);
      
      // Remove from recommendations
      setAnalysis(prev => ({
        ...prev,
        payer_specific_recommendations: prev.payer_specific_recommendations.map(rec => {
          if (rec.payer_id === payerDbId) {
            return {
              ...rec,
              recommendations: rec.recommendations.filter(r => r.code !== recommendation.code)
            };
          }
          return rec;
        })
      }));
    } catch (error) {
      console.error('Error applying recommendation:', error);
      toast.error('Failed to apply recommendation');
    } finally {
      setApplyingRecommendations(prev => prev.filter(id => id !== `${payerDbId}-${recommendation.code}`));
    }
  };

  const getConfidenceBadge = (confidence) => {
    if (confidence >= 85) return <Badge className="bg-green-600 text-white">High Confidence</Badge>;
    if (confidence >= 70) return <Badge className="bg-yellow-600 text-white">Medium Confidence</Badge>;
    return <Badge className="bg-slate-600 text-white">Low Confidence</Badge>;
  };

  return (
    <Card className="border-indigo-200 dark:border-indigo-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code className="w-5 h-5 text-indigo-600" />
          AI Billing Code Optimizer
        </CardTitle>
        <CardDescription>
          AI analyzes your billing codes to suggest missing modifiers and optimization opportunities
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Button
          onClick={analyzePatterns}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing Billing Patterns...
            </>
          ) : (
            <>
              <Code className="w-4 h-4 mr-2" />
              Analyze Billing Code Patterns
            </>
          )}
        </Button>

        {analysis && (
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-slate-500">Payers Analyzed</p>
                  <p className="text-2xl font-bold">{analysis.optimization_summary?.total_payers_analyzed || 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-slate-500">Recommendations</p>
                  <p className="text-2xl font-bold text-blue-600">{analysis.optimization_summary?.total_recommendations || 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-slate-500">High Confidence</p>
                  <p className="text-2xl font-bold text-green-600">{analysis.optimization_summary?.high_confidence_recommendations || 0}</p>
                </CardContent>
              </Card>
              <Card className="bg-green-50 dark:bg-green-950">
                <CardContent className="pt-4">
                  <p className="text-xs text-green-700 dark:text-green-300">Revenue Impact</p>
                  <p className="text-sm font-semibold text-green-800 dark:text-green-200">
                    {analysis.optimization_summary?.estimated_revenue_impact || 'N/A'}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Tabs defaultValue="recommendations" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="recommendations">Payer Recommendations</TabsTrigger>
                <TabsTrigger value="patterns">Pattern Insights</TabsTrigger>
                <TabsTrigger value="missing">Missing Codes</TabsTrigger>
              </TabsList>

              {/* Payer-Specific Recommendations */}
              <TabsContent value="recommendations" className="space-y-3">
                {analysis.payer_specific_recommendations?.map((payerRec, idx) => (
                  <Card key={idx} className="border-l-4 border-l-indigo-500">
                    <CardHeader>
                      <CardTitle className="text-sm">{payerRec.payer_name}</CardTitle>
                      <CardDescription>
                        {payerRec.recommendations?.length || 0} optimization opportunities
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {payerRec.recommendations?.map((rec, recIdx) => (
                        <div key={recIdx} className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge className="bg-indigo-600 text-white">{rec.code}</Badge>
                                <Badge variant="outline">{rec.code_type}</Badge>
                                {getConfidenceBadge(rec.confidence)}
                              </div>
                              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                {rec.reason}
                              </p>
                            </div>
                          </div>

                          <div className="space-y-2 mt-3">
                            <div className="bg-white dark:bg-slate-800 p-2 rounded">
                              <p className="text-xs text-slate-600 dark:text-slate-400">
                                <strong>Current:</strong> {rec.current_modifiers?.join(', ') || 'None'}
                              </p>
                              <p className="text-xs text-green-700 dark:text-green-300">
                                <strong>Suggested:</strong> {rec.suggested_modifiers?.join(', ')}
                              </p>
                            </div>

                            <div className="bg-green-50 dark:bg-green-950 p-2 rounded">
                              <p className="text-xs text-green-800 dark:text-green-200">
                                <DollarSign className="w-3 h-3 inline mr-1" />
                                <strong>Impact:</strong> {rec.potential_impact}
                              </p>
                            </div>

                            <p className="text-xs text-slate-600 dark:text-slate-400">
                              <strong>Evidence:</strong> {rec.evidence}
                            </p>

                            <Button
                              onClick={() => applyRecommendation(payerRec.payer_id, rec)}
                              disabled={applyingRecommendations.includes(`${payerRec.payer_id}-${rec.code}`)}
                              className="w-full bg-indigo-600 hover:bg-indigo-700"
                              size="sm"
                            >
                              {applyingRecommendations.includes(`${payerRec.payer_id}-${rec.code}`) ? (
                                <>
                                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                                  Applying...
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="w-3 h-3 mr-2" />
                                  Apply Modifiers
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              {/* Pattern Insights */}
              <TabsContent value="patterns" className="space-y-3">
                {analysis.pattern_insights?.map((insight, idx) => (
                  <Card key={idx} className="border-l-4 border-l-blue-500">
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex items-start gap-2">
                        <Target className="w-4 h-4 text-blue-600 mt-1 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-sm">{insight.pattern}</p>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                            Affects: {insight.affected_payer_types?.join(', ')}
                          </p>
                          <div className="bg-blue-50 dark:bg-blue-950 p-2 rounded mt-2">
                            <p className="text-xs text-blue-800 dark:text-blue-200">
                              <strong>Recommendation:</strong> {insight.recommendation}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {insight.codes_affected?.map((code, i) => (
                              <Badge key={i} variant="outline" className="text-xs">{code}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              {/* Missing Code Opportunities */}
              <TabsContent value="missing" className="space-y-3">
                {analysis.missing_code_opportunities?.map((opp, idx) => (
                  <Card key={idx} className="border-l-4 border-l-green-500">
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <Lightbulb className="w-5 h-5 text-green-600 flex-shrink-0" />
                        <div className="flex-1">
                          <Badge variant="secondary" className="mb-2">{opp.payer_type}</Badge>
                          <p className="font-medium text-sm mb-2">{opp.reason}</p>
                          
                          <div className="bg-green-50 dark:bg-green-950 p-3 rounded">
                            <p className="text-xs font-medium text-green-900 dark:text-green-100 mb-2">
                              Commonly Missing Codes:
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {opp.commonly_missing_codes?.map((code, i) => (
                                <Badge key={i} className="bg-green-600 text-white">{code}</Badge>
                              ))}
                            </div>
                          </div>

                          <p className="text-sm text-slate-700 dark:text-slate-300 mt-2">
                            <strong>Action:</strong> {opp.recommended_action}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}