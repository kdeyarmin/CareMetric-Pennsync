import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, TrendingUp, Target, Award, Lightbulb, Brain, CheckCircle2, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function PersonalizedCoachingInsights({ 
  nurseEmail,
  performanceData,
  gapAnalysis,
  featureUsage 
}) {
  const [insights, setInsights] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateInsights = async () => {
    setIsGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert clinical documentation coach. Analyze this nurse's performance data and provide personalized, actionable coaching insights.

PERFORMANCE DATA:
- Average Quality Score: ${performanceData.avgQuality}%
- Average Compliance Score: ${performanceData.avgCompliance}%
- Average Documentation Time: ${performanceData.avgTime} minutes
- Total Notes Enhanced: ${performanceData.totalNotes}
- AI Adoption Rate: ${featureUsage.adoptionRate}%

TOP DOCUMENTATION GAPS:
${gapAnalysis.sortedGaps.slice(0, 5).map(([element, count]) => `- ${element}: ${count} occurrences`).join('\n')}

MOST USED AI FEATURES:
${featureUsage.chartData.slice(0, 5).map(f => `- ${f.feature}: ${f.count} uses`).join('\n')}

Provide:
1. Overall Performance Assessment (1-2 sentences)
2. Top 3 Strengths (specific areas where they excel)
3. Top 3 Priority Focus Areas (where improvement would have biggest impact)
4. Specific, Actionable Recommendations (3-5 concrete steps)
5. Motivational Insight (encouraging note based on their progress)

Be specific, encouraging, and actionable. Focus on growth opportunities while celebrating successes.`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_assessment: { type: "string" },
            strengths: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  description: { type: "string" },
                  impact: { type: "string" }
                }
              }
            },
            focus_areas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  current_level: { type: "string" },
                  target_improvement: { type: "string" },
                  why_important: { type: "string" }
                }
              }
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  expected_outcome: { type: "string" },
                  difficulty: { type: "string" },
                  time_investment: { type: "string" }
                }
              }
            },
            motivation: { type: "string" }
          }
        }
      });

      setInsights(result);
    } catch (error) {
      console.error('Error generating insights:', error);
    }
    setIsGenerating(false);
  };

  if (!insights) {
    return (
      <Card className="border-2 border-purple-300 bg-gradient-to-r from-purple-50 to-pink-50">
        <CardContent className="p-8 text-center">
          <Brain className="w-16 h-16 text-purple-600 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 mb-2">Get AI-Powered Coaching</h3>
          <p className="text-sm text-gray-600 mb-4">
            AI will analyze your performance data and provide personalized coaching insights
          </p>
          <Button
            onClick={generateInsights}
            disabled={isGenerating}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
          >
            {isGenerating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Analyzing Your Performance...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate My Coaching Report
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall Assessment */}
      <Alert className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300">
        <Brain className="w-5 h-5 text-blue-600" />
        <AlertDescription>
          <p className="font-semibold text-blue-900 mb-1">Overall Performance</p>
          <p className="text-sm text-blue-800">{insights.overall_assessment}</p>
        </AlertDescription>
      </Alert>

      {/* Strengths */}
      <Card className="border-2 border-green-300 bg-green-50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Award className="w-5 h-5 text-green-600" />
            Your Strengths
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {insights.strengths?.map((strength, idx) => (
            <div key={idx} className="p-3 bg-white rounded-lg border border-green-200">
              <div className="flex items-start gap-2 mb-1">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm text-gray-900">{strength.area}</p>
                  <p className="text-sm text-gray-700 mt-1">{strength.description}</p>
                  <Badge className="mt-2 bg-green-600 text-xs">{strength.impact}</Badge>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Priority Focus Areas */}
      <Card className="border-2 border-orange-300 bg-orange-50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-5 h-5 text-orange-600" />
            Priority Focus Areas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {insights.focus_areas?.map((area, idx) => (
            <div key={idx} className="p-3 bg-white rounded-lg border border-orange-200">
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 bg-orange-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm text-gray-900">{area.area}</p>
                  <div className="flex gap-2 my-2">
                    <Badge variant="outline" className="text-xs">Current: {area.current_level}</Badge>
                    <Badge className="bg-orange-600 text-xs">Target: {area.target_improvement}</Badge>
                  </div>
                  <p className="text-xs text-gray-700 bg-orange-50 p-2 rounded">
                    💡 {area.why_important}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actionable Recommendations */}
      <Card className="border-2 border-blue-300">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-blue-600" />
            Actionable Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {insights.recommendations?.map((rec, idx) => (
            <div key={idx} className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="font-semibold text-sm text-gray-900 mb-2">{rec.action}</p>
              <div className="space-y-1 text-xs">
                <p className="text-gray-700">
                  <strong>Expected Outcome:</strong> {rec.expected_outcome}
                </p>
                <div className="flex gap-2">
                  <Badge variant="outline" className={
                    rec.difficulty === 'easy' ? 'bg-green-50 text-green-700' :
                    rec.difficulty === 'medium' ? 'bg-yellow-50 text-yellow-700' :
                    'bg-red-50 text-red-700'
                  }>
                    {rec.difficulty}
                  </Badge>
                  <Badge variant="outline">{rec.time_investment}</Badge>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Motivational Message */}
      <Alert className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-300">
        <Award className="w-5 h-5 text-green-600" />
        <AlertDescription>
          <p className="font-semibold text-green-900 mb-1">🎉 Keep It Up!</p>
          <p className="text-sm text-green-800">{insights.motivation}</p>
        </AlertDescription>
      </Alert>

      {/* Regenerate Button */}
      <Button
        onClick={generateInsights}
        disabled={isGenerating}
        variant="outline"
        size="sm"
        className="w-full"
      >
        <Sparkles className="w-4 h-4 mr-2" />
        Regenerate Insights
      </Button>
    </div>
  );
}