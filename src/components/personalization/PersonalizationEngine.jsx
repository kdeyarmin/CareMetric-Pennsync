import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Sparkles, 
  Brain, 
  Target, 
  Zap, 
  TrendingUp,
  Clock,
  ChevronRight,
  Lightbulb,
  Star
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function PersonalizationEngine({ userEmail, providerType }) {
  const { data: insights, isLoading } = useQuery({
    queryKey: ['personalizedInsights', userEmail],
    queryFn: async () => {
      const response = await base44.functions.invoke('generatePersonalizedInsights', {
        providerEmail: userEmail
      });
      return response.data || response;
    },
    enabled: !!userEmail,
    staleTime: 1800000, // Cache for 30 minutes
    refetchOnWindowFocus: false
  });

  if (isLoading) {
    return (
      <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50">
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-purple-600 animate-pulse" />
            <p className="text-sm text-purple-900">Learning your preferences...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!insights?.success || !insights?.insights) return null;

  const { templates, quickActions, patientInsights, aiSuggestions } = insights.insights;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-2 border-purple-400 bg-gradient-to-br from-purple-100 via-pink-100 to-indigo-100">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-600" />
            Your Personalized Insights
          </CardTitle>
          <p className="text-xs text-purple-800">
            AI-powered recommendations based on your workflow patterns
          </p>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recommended Templates */}
        {templates?.length > 0 && (
          <Card className="border-2 border-blue-300 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="w-5 h-5 text-blue-600" />
                Recommended Templates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {templates.map((template, idx) => (
                <Link 
                  key={idx}
                  to={`${createPageUrl("SmartNoteAssistant")}?visitType=${template.visit_type}`}
                >
                  <Alert className="hover:bg-blue-50 cursor-pointer transition-colors border-blue-200">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                    <AlertDescription>
                      <p className="font-semibold text-sm text-blue-900">{template.name}</p>
                      <p className="text-xs text-blue-700 mt-1">{template.reason}</p>
                    </AlertDescription>
                  </Alert>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Quick Action Suggestions */}
        {quickActions?.length > 0 && (
          <Card className="border-2 border-green-300 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-5 h-5 text-green-600" />
                Workflow Optimizations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {quickActions.map((action, idx) => (
                <Alert key={idx} className="border-green-200 bg-green-50">
                  <Clock className="w-4 h-4 text-green-600" />
                  <AlertDescription>
                    <p className="font-semibold text-sm text-green-900">{action.action}</p>
                    <p className="text-xs text-green-700 mt-1">{action.benefit}</p>
                    <Badge className="mt-2 bg-green-200 text-green-800 text-xs">
                      ⚡ Saves {action.time_saved}
                    </Badge>
                  </AlertDescription>
                </Alert>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Patient Care Insights */}
        {patientInsights?.length > 0 && (
          <Card className="border-2 border-purple-300 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-5 h-5 text-purple-600" />
                Patient Care Insights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {patientInsights.map((insight, idx) => {
                const priorityColor = {
                  high: 'border-red-300 bg-red-50',
                  medium: 'border-orange-300 bg-orange-50',
                  low: 'border-blue-300 bg-blue-50'
                }[insight.priority] || 'border-gray-300 bg-gray-50';

                return (
                  <Alert key={idx} className={priorityColor}>
                    <Lightbulb className="w-4 h-4" />
                    <AlertDescription>
                      <p className="font-semibold text-sm">{insight.insight}</p>
                      <p className="text-xs mt-1">{insight.action}</p>
                      <Badge variant="outline" className="mt-2 text-xs">
                        {insight.priority} priority
                      </Badge>
                    </AlertDescription>
                  </Alert>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* AI Feature Suggestions */}
        {aiSuggestions?.length > 0 && (
          <Card className="border-2 border-indigo-300 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="w-5 h-5 text-indigo-600" />
                AI Features to Try
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {aiSuggestions.map((suggestion, idx) => (
                <Alert key={idx} className="border-indigo-200 bg-indigo-50">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <AlertDescription>
                    <p className="font-semibold text-sm text-indigo-900">{suggestion.feature}</p>
                    <p className="text-xs text-indigo-700 mt-1">{suggestion.benefit}</p>
                    <p className="text-xs text-indigo-600 mt-2 italic">
                      💡 Tip: {suggestion.usage_tip}
                    </p>
                  </AlertDescription>
                </Alert>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}