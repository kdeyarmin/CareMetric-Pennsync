import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  TrendingUp, TrendingDown, AlertCircle, CheckCircle2, 
  ThumbsUp, Target, Users, RefreshCw, Brain 
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function AIFeedbackAnalytics() {
  const [analyzing, setAnalyzing] = useState(false);

  const { data: feedbackData, isLoading, refetch } = useQuery({
    queryKey: ['aiFeedbackAnalysis'],
    queryFn: async () => {
      const response = await base44.functions.invoke('analyzeAIFeedback', {});
      return response.data;
    },
    staleTime: 300000, // 5 minutes
  });

  const handleReanalyze = async () => {
    setAnalyzing(true);
    await refetch();
    setAnalyzing(false);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600">Analyzing AI feedback data...</p>
        </CardContent>
      </Card>
    );
  }

  if (!feedbackData?.success) {
    return (
      <Alert className="border-yellow-300 bg-yellow-50">
        <AlertCircle className="w-4 h-4" />
        <AlertDescription>
          No feedback data available yet. Feedback will appear here once nurses start rating AI insights.
        </AlertDescription>
      </Alert>
    );
  }

  const { overall_stats, type_metrics, recommendations, low_rated_insights } = feedbackData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">AI Feedback Analytics</h2>
        <Button onClick={handleReanalyze} disabled={analyzing} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${analyzing ? 'animate-spin' : ''}`} />
          Reanalyze
        </Button>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Feedback</p>
                <p className="text-3xl font-bold text-gray-900">{overall_stats.total_feedback_count}</p>
              </div>
              <Users className="w-10 h-10 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg Rating</p>
                <p className="text-3xl font-bold text-gray-900">{overall_stats.avg_rating}/5</p>
              </div>
              <Target className="w-10 h-10 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Action Taken</p>
                <p className="text-3xl font-bold text-gray-900">{overall_stats.action_taken_rate}%</p>
              </div>
              <CheckCircle2 className="w-10 h-10 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Nurses</p>
                <p className="text-3xl font-bold text-gray-900">{overall_stats.unique_nurses}</p>
              </div>
              <ThumbsUp className="w-10 h-10 text-indigo-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recommendations */}
      {recommendations && recommendations.length > 0 && (
        <Card className="border-orange-300 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Brain className="w-5 h-5 text-orange-600" />
              AI Model Improvement Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.slice(0, 5).map((rec, idx) => (
              <Alert key={idx} className={`
                ${rec.severity === 'critical' ? 'border-red-300 bg-red-50' : ''}
                ${rec.severity === 'high' ? 'border-orange-300 bg-orange-50' : ''}
                ${rec.severity === 'medium' ? 'border-yellow-300 bg-yellow-50' : ''}
              `}>
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-semibold text-sm mb-1">
                        {rec.insight_type.replace(/_/g, ' ').toUpperCase()}
                      </p>
                      <p className="text-sm mb-1">{rec.issue}</p>
                      <p className="text-xs text-gray-600">{rec.suggestion}</p>
                    </div>
                    <Badge className={`
                      ${rec.severity === 'critical' ? 'bg-red-600' : ''}
                      ${rec.severity === 'high' ? 'bg-orange-600' : ''}
                      ${rec.severity === 'medium' ? 'bg-yellow-600' : ''}
                    `}>
                      {rec.severity}
                    </Badge>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Performance by Insight Type */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Performance by Insight Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {type_metrics.map((metric) => (
              <div key={metric.insight_type} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-gray-900 capitalize">
                      {metric.insight_type.replace(/_/g, ' ')}
                    </h3>
                    <Badge variant="outline">{metric.total_feedback} responses</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {parseFloat(metric.avg_rating) >= 4 ? (
                      <TrendingUp className="w-5 h-5 text-green-600" />
                    ) : parseFloat(metric.avg_rating) < 3 ? (
                      <TrendingDown className="w-5 h-5 text-red-600" />
                    ) : null}
                    <span className="text-2xl font-bold">{metric.avg_rating}</span>
                    <span className="text-sm text-gray-500">/5</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Accuracy</p>
                    <p className="font-semibold">{metric.accuracy_rate}%</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Action Rate</p>
                    <p className="font-semibold">{metric.action_rate}%</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Inaccuracy</p>
                    <p className="font-semibold text-red-600">{metric.inaccuracy_rate}%</p>
                  </div>
                </div>

                {metric.common_feedback_themes && metric.common_feedback_themes.length > 0 && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-gray-600 mb-2">Common Themes:</p>
                    <div className="flex flex-wrap gap-2">
                      {metric.common_feedback_themes.map((theme, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {theme.theme} ({theme.frequency})
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Low Rated Insights */}
      {low_rated_insights && low_rated_insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              Recent Low-Rated Insights ({low_rated_insights.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {low_rated_insights.slice(0, 10).map((insight, idx) => (
                <AccordionItem key={idx} value={`item-${idx}`}>
                  <AccordionTrigger className="text-sm">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="bg-red-50">
                        {insight.rating}/5
                      </Badge>
                      <span className="capitalize">{insight.type.replace(/_/g, ' ')}</span>
                      <Badge className="bg-gray-600 text-xs">{insight.accuracy}</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 text-sm">
                      <div>
                        <p className="font-semibold text-gray-700">Insight Content:</p>
                        <p className="text-gray-600 bg-gray-50 p-2 rounded">{insight.insight_content}</p>
                      </div>
                      {insight.feedback && (
                        <div>
                          <p className="font-semibold text-gray-700">Nurse Feedback:</p>
                          <p className="text-gray-600 bg-blue-50 p-2 rounded">{insight.feedback}</p>
                        </div>
                      )}
                      <div className="flex gap-4 text-xs">
                        <span>Relevance: <strong>{insight.relevance}</strong></span>
                        <span>Usefulness: <strong>{insight.usefulness}</strong></span>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}
    </div>
  );
}