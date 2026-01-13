import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Brain, 
  Star, 
  TrendingUp, 
  FileText, 
  Settings,
  BarChart3,
  Sparkles,
  Calendar
} from "lucide-react";
import SmartLearningEngine from "../components/feedback/SmartLearningEngine";
import AIStyleAdapter from "../components/feedback/AIStyleAdapter";
import { formatEastern } from "../components/utils/timezone";

export default function MyAILearning() {
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    }
  });

  const { data: learnedPatterns = [] } = useQuery({
    queryKey: ['learnedPatterns', currentUser?.email],
    queryFn: () => base44.entities.LearnedFormatPattern.filter({ 
      provider_email: currentUser.email,
      is_active: true
    }, '-confidence_score'),
    enabled: !!currentUser?.email
  });

  const { data: allFeedback = [] } = useQuery({
    queryKey: ['allFeedback', currentUser?.email],
    queryFn: () => base44.entities.NoteFeedback.filter({ 
      created_by: currentUser.email 
    }, '-created_date', 50),
    enabled: !!currentUser?.email
  });

  const avgRating = allFeedback.length > 0
    ? (allFeedback.reduce((sum, f) => sum + (f.rating || 0), 0) / allFeedback.length).toFixed(1)
    : 0;

  const ratingDistribution = [1, 2, 3, 4, 5].map(rating => ({
    rating,
    count: allFeedback.filter(f => f.rating === rating).length
  }));

  if (!currentUser) return null;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Learning Dashboard</h1>
        <p className="text-gray-600">Track how AI adapts to your documentation style</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">
            <Brain className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="patterns">
            <FileText className="w-4 h-4 mr-2" />
            Learned Patterns
          </TabsTrigger>
          <TabsTrigger value="feedback">
            <Star className="w-4 h-4 mr-2" />
            My Feedback
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="w-4 h-4 mr-2" />
            Preferences
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SmartLearningEngine 
              userEmail={currentUser.email}
              providerType={currentUser.provider_type || 'RN'}
            />

            {/* Feedback Stats */}
            <Card className="border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-green-600" />
                  Feedback Statistics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-white/60 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-2">Average Rating</p>
                  <div className="flex items-center gap-2">
                    <p className="text-4xl font-bold text-green-900">{avgRating}</p>
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-5 h-5 ${
                            star <= Math.round(avgRating) 
                              ? "fill-yellow-400 text-yellow-400" 
                              : "text-gray-300"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Based on {allFeedback.length} reviews</p>
                </div>

                <div>
                  <p className="text-sm font-medium mb-3">Rating Distribution</p>
                  {ratingDistribution.reverse().map(({ rating, count }) => (
                    <div key={rating} className="flex items-center gap-2 mb-2">
                      <span className="text-xs w-6">{rating}★</span>
                      <Progress value={(count / allFeedback.length) * 100} className="flex-1 h-2" />
                      <span className="text-xs w-8 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Learned Patterns Tab */}
        <TabsContent value="patterns" className="space-y-4">
          {learnedPatterns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Brain className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">No patterns learned yet</p>
                <p className="text-sm text-gray-500">Edit AI-generated notes to teach the system your style</p>
              </CardContent>
            </Card>
          ) : (
            learnedPatterns.map((pattern) => (
              <Card key={pattern.id} className="border-2 border-purple-200">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-purple-600" />
                      {pattern.visit_type?.replace(/_/g, ' ')} - {pattern.diagnosis_category}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {pattern.confidence_score}% confidence
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {pattern.usage_count} observations
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {pattern.extracted_patterns?.overall_style_summary && (
                    <div className="bg-purple-50/50 rounded-lg p-3 border border-purple-200">
                      <p className="text-sm text-purple-900">{pattern.extracted_patterns.overall_style_summary}</p>
                    </div>
                  )}

                  {pattern.extracted_patterns?.terminology_preferences && (
                    <div>
                      <p className="text-sm font-semibold mb-2">Terminology Preferences</p>
                      <div className="space-y-1">
                        {pattern.extracted_patterns.terminology_preferences.slice(0, 5).map((term, idx) => (
                          <div key={idx} className="text-xs bg-white/60 rounded px-3 py-2">
                            <span className="text-gray-500 line-through">{term.ai_term}</span>
                            <span className="mx-2">→</span>
                            <span className="font-medium text-purple-900">{term.preferred_term}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {pattern.extracted_patterns?.added_elements && pattern.extracted_patterns.added_elements.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold mb-2">Always Includes</p>
                      <div className="flex flex-wrap gap-1">
                        {pattern.extracted_patterns.added_elements.map((element, idx) => (
                          <Badge key={idx} className="text-xs bg-green-100 text-green-800">
                            {element}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-gray-500">
                    Last updated: {formatEastern(new Date(pattern.last_observed), 'MMM d, yyyy')}
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Feedback History Tab */}
        <TabsContent value="feedback" className="space-y-4">
          {allFeedback.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Star className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">No feedback provided yet</p>
                <p className="text-sm text-gray-500">Rate AI outputs to help improve quality</p>
              </CardContent>
            </Card>
          ) : (
            allFeedback.map((feedback) => (
              <Card key={feedback.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-500" />
                      <span className="text-sm font-medium">
                        {formatEastern(new Date(feedback.created_date), 'MMM d, yyyy')}
                      </span>
                    </div>
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-4 h-4 ${
                            star <= (feedback.rating || 0)
                              ? "fill-yellow-400 text-yellow-400" 
                              : "text-gray-300"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {feedback.visit_type && (
                    <div className="flex gap-2">
                      <Badge variant="outline" className="text-xs">
                        {feedback.visit_type?.replace(/_/g, ' ')}
                      </Badge>
                      {feedback.diagnosis && (
                        <Badge variant="outline" className="text-xs">
                          {feedback.diagnosis}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {feedback.feedback_type?.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  )}
                  {feedback.feedback_text && (
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
                      {feedback.feedback_text}
                    </p>
                  )}
                  {feedback.improvement_suggestions && feedback.improvement_suggestions.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-1">Suggestions:</p>
                      <ul className="space-y-1">
                        {feedback.improvement_suggestions.map((suggestion, idx) => (
                          <li key={idx} className="text-xs text-gray-700">• {suggestion}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <AIStyleAdapter
            userEmail={currentUser.email}
            providerType={currentUser.provider_type || 'RN'}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}