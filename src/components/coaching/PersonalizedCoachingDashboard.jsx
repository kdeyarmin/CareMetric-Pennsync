import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  TrendingUp,
  Target,
  BookOpen,
  Lightbulb,
  Award,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  ChevronRight,
  Star,
  Zap
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function PersonalizedCoachingDashboard({ 
  nurseEmail,
  compact = false 
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [coaching, setCoaching] = useState(null);
  const [metrics, setMetrics] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const handleGenerateCoaching = async () => {
    setIsGenerating(true);
    try {
      const result = await base44.functions.invoke('generatePersonalizedCoaching', {
        nurseEmail: nurseEmail || currentUser?.email
      });

      setCoaching(result.coaching);
      setMetrics(result.metrics);
    } catch (error) {
      console.error('Error generating coaching:', error);
      alert('Failed to generate coaching. Please try again.');
    }
    setIsGenerating(false);
  };

  if (!coaching) {
    return (
      <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50">
        <CardHeader>
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600" />
            Your Personal AI Coach
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-700">
            Get personalized feedback and growth recommendations based on your documentation performance.
          </p>
          <Button
            onClick={handleGenerateCoaching}
            disabled={isGenerating}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 min-h-[44px]"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Your Performance...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Get My Personalized Coaching
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <Card className="border-2 border-purple-300 bg-gradient-to-r from-purple-600 to-pink-600 text-white">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 rounded-full flex items-center justify-center">
                <Brain className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold">Your AI Coach</h2>
                <p className="text-xs sm:text-sm text-purple-100">Personalized Growth Insights</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGenerateCoaching}
              disabled={isGenerating}
              className="text-white hover:bg-white/20 min-h-[44px]"
            >
              <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Performance Overview */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <Card>
            <CardContent className="p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-gray-600 mb-1">Quality Score</p>
              <p className="text-xl sm:text-2xl font-bold text-blue-600">{metrics.avgQualityScore}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-gray-600 mb-1">Compliance</p>
              <p className="text-xl sm:text-2xl font-bold text-green-600">{metrics.avgComplianceScore}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-gray-600 mb-1">Improvement</p>
              <p className="text-xl sm:text-2xl font-bold text-purple-600">+{metrics.avgComplianceImprovement}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-gray-600 mb-1">Training</p>
              <p className="text-xl sm:text-2xl font-bold text-orange-600">{metrics.completedTraining}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Overall Summary */}
      <Card className="border-2 border-blue-300 bg-blue-50">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 flex-shrink-0 mt-1" />
            <div>
              <h3 className="font-semibold text-sm sm:text-base text-gray-900 mb-2">Coach's Summary</h3>
              <p className="text-xs sm:text-sm text-gray-700 leading-relaxed">{coaching.overall_coaching_summary}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strengths */}
      <Card className="border-2 border-green-300">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-green-700">
            <Award className="w-4 h-4 sm:w-5 sm:h-5" />
            Your Strengths
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {coaching.strengths?.map((strength, idx) => (
            <div key={idx} className="flex items-start gap-2 p-2 sm:p-3 bg-green-50 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs sm:text-sm text-gray-700">{strength}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Priority Improvement Areas */}
      <Card className="border-2 border-orange-300">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-orange-700">
            <Target className="w-4 h-4 sm:w-5 sm:h-5" />
            Priority Focus Areas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="space-y-2">
            {coaching.priority_areas?.map((area, idx) => (
              <AccordionItem 
                key={idx} 
                value={`area-${idx}`}
                className="border-2 border-orange-200 rounded-lg bg-orange-50"
              >
                <AccordionTrigger className="px-3 sm:px-4 py-3 hover:no-underline">
                  <div className="flex items-center gap-2 sm:gap-3 text-left">
                    <Badge className="bg-orange-600 flex-shrink-0 text-xs">#{idx + 1}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-xs sm:text-sm text-gray-900 break-words">{area.area}</p>
                      <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5 line-clamp-1">{area.gap}</p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-3 sm:px-4 pb-4 space-y-3">
                  <div className="bg-white p-3 rounded border">
                    <p className="text-[10px] sm:text-xs font-semibold text-gray-700 mb-1">📊 Impact:</p>
                    <p className="text-xs sm:text-sm text-gray-600">{area.impact}</p>
                  </div>
                  <div className="bg-white p-3 rounded border">
                    <p className="text-[10px] sm:text-xs font-semibold text-gray-700 mb-2">✅ Action Steps:</p>
                    <ul className="space-y-1">
                      {area.action_steps?.map((step, stepIdx) => (
                        <li key={stepIdx} className="text-xs sm:text-sm text-gray-700 flex items-start gap-2">
                          <span className="text-orange-600 flex-shrink-0">•</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Badge className="bg-blue-100 text-blue-800 text-xs">
                    ⏱️ Estimated: {area.time_to_improve}
                  </Badge>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* Personalized Training Plan */}
      <Card className="border-2 border-indigo-300">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-indigo-700">
            <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
            Your Learning Path
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="text-xs sm:text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-500" />
              Recommended Training Modules
            </h4>
            <div className="space-y-2">
              {coaching.training_plan?.recommended_modules?.map((module, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 sm:p-3 bg-indigo-50 rounded hover:bg-indigo-100 transition-colors">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                  <p className="text-xs sm:text-sm text-gray-700 flex-1">{module}</p>
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs sm:text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <Zap className="w-4 h-4 text-purple-500" />
              Quick Micro-Learning Topics
            </h4>
            <div className="flex flex-wrap gap-2">
              {coaching.training_plan?.micro_learning_topics?.map((topic, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {topic}
                </Badge>
              ))}
            </div>
          </div>

          <Link to={createPageUrl("StaffTrainingHub")}>
            <Button className="w-full bg-indigo-600 hover:bg-indigo-700 min-h-[44px]">
              Go to Training Hub
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Documentation Tips */}
      <Card className="border-2 border-blue-300">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-blue-700">
            <Lightbulb className="w-4 h-4 sm:w-5 sm:h-5" />
            Quick Documentation Tips
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <h4 className="text-xs sm:text-sm font-semibold text-gray-900 mb-2">⚡ Quick Wins</h4>
            <ul className="space-y-1">
              {coaching.documentation_tips?.quick_wins?.slice(0, 3).map((tip, idx) => (
                <li key={idx} className="text-xs sm:text-sm text-gray-700 flex items-start gap-2">
                  <span className="text-green-600 flex-shrink-0">✓</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs sm:text-sm font-semibold text-gray-900 mb-2">⚠️ Avoid These Pitfalls</h4>
            <ul className="space-y-1">
              {coaching.documentation_tips?.common_pitfalls?.slice(0, 3).map((pitfall, idx) => (
                <li key={idx} className="text-xs sm:text-sm text-gray-700 flex items-start gap-2">
                  <span className="text-red-600 flex-shrink-0">✗</span>
                  <span>{pitfall}</span>
                </li>
              ))}
            </ul>
          </div>

          {coaching.documentation_tips?.phrase_templates?.length > 0 && (
            <div>
              <h4 className="text-xs sm:text-sm font-semibold text-gray-900 mb-2">📝 Phrase Templates</h4>
              <div className="space-y-2">
                {coaching.documentation_tips.phrase_templates.slice(0, 2).map((template, idx) => (
                  <div key={idx} className="bg-blue-50 p-2 sm:p-3 rounded border border-blue-200">
                    <p className="text-xs sm:text-sm text-blue-900 italic">"{template}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Growth Trajectory */}
      <Card className="border-2 border-green-300">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-green-700">
            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
            Your Growth Path
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-gray-50 p-3 sm:p-4 rounded-lg border">
            <p className="text-[10px] sm:text-xs text-gray-600 mb-1">Current Level</p>
            <p className="text-sm sm:text-base font-semibold text-gray-900">{coaching.growth_trajectory?.current_level}</p>
          </div>

          <div>
            <h4 className="text-xs sm:text-sm font-semibold text-gray-900 mb-2">🎯 30-Day Goals</h4>
            <ul className="space-y-2">
              {coaching.growth_trajectory?.thirty_day_goals?.map((goal, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs sm:text-sm text-gray-700">
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  <span>{goal}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-3 sm:p-4 rounded-lg border-2 border-green-300">
            <p className="text-[10px] sm:text-xs text-gray-600 mb-1">90-Day Mastery Pathway</p>
            <p className="text-xs sm:text-sm text-gray-800">{coaching.growth_trajectory?.ninety_day_pathway}</p>
          </div>
        </CardContent>
      </Card>

      {/* Motivational Insights */}
      <Card className="border-2 border-yellow-300 bg-gradient-to-br from-yellow-50 to-amber-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-yellow-700">
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
            You're Making Progress!
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {coaching.motivational_insights?.map((insight, idx) => (
              <div key={idx} className="flex items-start gap-2 p-2 sm:p-3 bg-white rounded-lg border border-yellow-200">
                <Star className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs sm:text-sm text-gray-700">{insight}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Action Items */}
      {metrics?.topIssues?.length > 0 && (
        <Card className="border-2 border-red-300">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" />
              Common Documentation Gaps to Address
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {metrics.topIssues.map((issue, idx) => (
                <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs sm:text-sm font-semibold text-gray-900">{issue.element}</p>
                    <Badge className={
                      issue.severity === 'critical' ? 'bg-red-600' :
                      issue.severity === 'high' ? 'bg-orange-500' :
                      'bg-yellow-500'
                    }>
                      {issue.frequency}x
                    </Badge>
                  </div>
                  <p className="text-[10px] sm:text-xs text-gray-600">
                    Appeared in {issue.frequency} of your recent notes
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Next Steps CTA */}
      <Alert className="bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-300">
        <Sparkles className="w-4 h-4 text-purple-600" />
        <AlertDescription className="text-xs sm:text-sm text-purple-900">
          <p className="font-semibold mb-2">Ready to level up?</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Link to={createPageUrl("StaffTrainingHub")} className="flex-1">
              <Button variant="outline" size="sm" className="w-full border-purple-400 hover:bg-purple-50 min-h-[44px]">
                Start Training
              </Button>
            </Link>
            <Link to={createPageUrl("SmartNoteAssistant")} className="flex-1">
              <Button variant="outline" size="sm" className="w-full border-purple-400 hover:bg-purple-50 min-h-[44px]">
                Practice Documentation
              </Button>
            </Link>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}