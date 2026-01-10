import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, Target, Star, ThumbsUp } from "lucide-react";

/**
 * Shows how nurse feedback is improving training recommendations
 */
export default function TrainingRelevanceInsights({ nurseEmail }) {
  const { data: completions = [] } = useQuery({
    queryKey: ['trainingFeedbackAnalysis', nurseEmail],
    queryFn: async () => {
      const all = await base44.entities.TrainingCompletion.filter({ nurse_email: nurseEmail });
      return all.filter(c => c.relevance_rating || c.effectiveness_rating);
    },
    enabled: !!nurseEmail
  });

  if (completions.length < 3) {
    return (
      <Alert className="bg-blue-50 border-blue-200">
        <Star className="w-4 h-4 text-blue-600" />
        <AlertDescription>
          <p className="text-sm text-blue-900">
            Complete and rate at least 3 training modules to see personalized insights about your learning preferences.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  // Calculate insights
  const avgRelevance = completions.reduce((sum, c) => sum + (c.relevance_rating || 0), 0) / completions.length;
  const avgEffectiveness = completions.reduce((sum, c) => sum + (c.effectiveness_rating || 0), 0) / completions.length;
  const recommendRate = (completions.filter(c => c.would_recommend).length / completions.length) * 100;

  // Analyze trends (recent vs older)
  const recentCompletions = completions.slice(0, 5);
  const olderCompletions = completions.slice(5, 10);
  
  const recentAvgRelevance = recentCompletions.reduce((sum, c) => sum + (c.relevance_rating || 0), 0) / recentCompletions.length;
  const olderAvgRelevance = olderCompletions.length > 0 
    ? olderCompletions.reduce((sum, c) => sum + (c.relevance_rating || 0), 0) / olderCompletions.length
    : recentAvgRelevance;

  const trend = recentAvgRelevance > olderAvgRelevance + 0.3 ? 'improving' : 
                recentAvgRelevance < olderAvgRelevance - 0.3 ? 'declining' : 'stable';

  return (
    <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="w-5 h-5 text-purple-600" />
          Your Training Relevance Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 mb-1">
              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
              <p className="text-2xl font-bold text-gray-900">{avgRelevance.toFixed(1)}</p>
            </div>
            <p className="text-xs text-gray-600">Avg Relevance</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 mb-1">
              <Target className="w-4 h-4 text-blue-500" />
              <p className="text-2xl font-bold text-gray-900">{avgEffectiveness.toFixed(1)}</p>
            </div>
            <p className="text-xs text-gray-600">Effectiveness</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 mb-1">
              <ThumbsUp className="w-4 h-4 text-green-500" />
              <p className="text-2xl font-bold text-gray-900">{recommendRate.toFixed(0)}%</p>
            </div>
            <p className="text-xs text-gray-600">Would Recommend</p>
          </div>
        </div>

        <div className={`p-3 rounded-lg ${
          trend === 'improving' ? 'bg-green-100 border border-green-300' :
          trend === 'declining' ? 'bg-orange-100 border border-orange-300' :
          'bg-blue-100 border border-blue-300'
        }`}>
          <div className="flex items-center gap-2">
            {trend === 'improving' ? (
              <>
                <TrendingUp className="w-5 h-5 text-green-600" />
                <p className="text-sm font-semibold text-green-900">Training relevance is improving!</p>
              </>
            ) : trend === 'declining' ? (
              <>
                <TrendingDown className="w-5 h-5 text-orange-600" />
                <p className="text-sm font-semibold text-orange-900">Training relevance has decreased</p>
              </>
            ) : (
              <>
                <Target className="w-5 h-5 text-blue-600" />
                <p className="text-sm font-semibold text-blue-900">Training relevance is stable</p>
              </>
            )}
          </div>
          <p className="text-xs text-gray-700 mt-1">
            {trend === 'improving' 
              ? 'Recent assignments are better aligned with your needs based on your feedback.'
              : trend === 'declining'
              ? 'We\'re using your feedback to improve future assignments.'
              : 'Continue rating modules to refine your recommendations.'}
          </p>
        </div>

        {avgRelevance >= 4 && (
          <Alert className="bg-green-50 border-green-300">
            <ThumbsUp className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-sm text-green-900">
              Your feedback is helping us assign highly relevant training! Keep it up.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}