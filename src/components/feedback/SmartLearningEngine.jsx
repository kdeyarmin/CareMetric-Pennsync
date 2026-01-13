import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Brain, TrendingUp, Sparkles, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

/**
 * Smart Learning Engine - Shows how AI has learned from nurse's feedback
 * and adapted to their documentation style
 */
export default function SmartLearningEngine({ userEmail, providerType }) {
  const [insights, setInsights] = useState(null);

  const { data: preferences } = useQuery({
    queryKey: ['providerPreferences', userEmail],
    queryFn: async () => {
      const prefs = await base44.entities.ProviderPreferences.filter({ 
        provider_email: userEmail 
      });
      return prefs[0];
    },
    enabled: !!userEmail
  });

  const { data: usagePattern } = useQuery({
    queryKey: ['usagePattern', userEmail],
    queryFn: async () => {
      const patterns = await base44.entities.ProviderUsagePattern.filter({ 
        provider_email: userEmail 
      });
      return patterns[0];
    },
    enabled: !!userEmail
  });

  const { data: recentFeedback = [] } = useQuery({
    queryKey: ['recentFeedback', userEmail],
    queryFn: async () => {
      const currentUser = await base44.auth.me();
      return base44.entities.NoteFeedback.filter({ 
        created_by: currentUser.email 
      }, '-created_date', 10);
    },
    enabled: !!userEmail
  });

  const learningProfile = preferences?.ai_personalization?.learning_profile;
  const avgRating = recentFeedback.length > 0 
    ? (recentFeedback.reduce((sum, f) => sum + (f.rating || 0), 0) / recentFeedback.length).toFixed(1)
    : 0;

  const adaptationScore = learningProfile?.feedback_count 
    ? Math.min(100, (learningProfile.feedback_count * 10) + (avgRating * 10))
    : 0;

  if (!preferences && !usagePattern) return null;

  return (
    <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-600" />
          AI Learning Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Adaptation Score */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Personalization Level</span>
            <span className="text-2xl font-bold text-purple-600">{Math.round(adaptationScore)}%</span>
          </div>
          <Progress value={adaptationScore} className="h-2 bg-purple-100" />
          <p className="text-xs text-gray-600 mt-1">
            {adaptationScore < 30 && "🌱 Just getting started - provide more feedback to improve"}
            {adaptationScore >= 30 && adaptationScore < 60 && "🚀 Learning your style..."}
            {adaptationScore >= 60 && adaptationScore < 85 && "✨ Well-adapted to your preferences"}
            {adaptationScore >= 85 && "🎯 Highly personalized to your style"}
          </p>
        </div>

        {/* Learning Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/60 rounded-lg p-3">
            <p className="text-xs text-gray-600">Notes Generated</p>
            <p className="text-xl font-bold text-purple-900">
              {usagePattern?.total_notes_generated || 0}
            </p>
          </div>
          <div className="bg-white/60 rounded-lg p-3">
            <p className="text-xs text-gray-600">Avg. Rating</p>
            <p className="text-xl font-bold text-purple-900">
              {avgRating > 0 ? `${avgRating} ⭐` : '-'}
            </p>
          </div>
          <div className="bg-white/60 rounded-lg p-3">
            <p className="text-xs text-gray-600">Feedback Given</p>
            <p className="text-xl font-bold text-purple-900">
              {learningProfile?.feedback_count || 0}
            </p>
          </div>
          <div className="bg-white/60 rounded-lg p-3">
            <p className="text-xs text-gray-600">Acceptance Rate</p>
            <p className="text-xl font-bold text-purple-900">
              {usagePattern?.ai_suggestion_acceptance_rate || 0}%
            </p>
          </div>
        </div>

        {/* Learned Preferences */}
        {preferences?.ai_personalization && (
          <div className="bg-white/60 rounded-lg p-3 space-y-2">
            <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              Your Style Preferences
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="text-xs">
                {preferences.ai_personalization.writing_style || 'clinical'} style
              </Badge>
              <Badge variant="outline" className="text-xs">
                {preferences.ai_personalization.detail_level || 'moderate'} detail
              </Badge>
              <Badge variant="outline" className="text-xs">
                {preferences.ai_personalization.tone || 'professional'} tone
              </Badge>
            </div>
          </div>
        )}

        {/* Most Common Visit Types */}
        {usagePattern?.frequent_visit_types && usagePattern.frequent_visit_types.length > 0 && (
          <div className="bg-white/60 rounded-lg p-3">
            <p className="text-sm font-semibold text-gray-900 mb-2">Most Common Visits</p>
            <div className="space-y-1">
              {usagePattern.frequent_visit_types.slice(0, 3).map((vt, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-gray-700">{vt.visit_type?.replace(/_/g, ' ')}</span>
                  <Badge variant="outline" className="text-xs">{vt.count}x</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Improvement Areas */}
        {learningProfile?.preferred_improvements && learningProfile.preferred_improvements.length > 0 && (
          <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
            <p className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              AI Focus Areas
            </p>
            <div className="flex flex-wrap gap-1">
              {learningProfile.preferred_improvements.slice(0, 4).map((area, idx) => (
                <Badge key={idx} className="text-xs bg-amber-100 text-amber-800">
                  {area.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-amber-700 mt-2">
              AI prioritizes these areas based on your feedback
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}