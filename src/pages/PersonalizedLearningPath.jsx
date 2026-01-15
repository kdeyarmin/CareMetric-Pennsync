import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Target, TrendingUp, BookOpen, CheckCircle2,
  AlertTriangle, Brain, Sparkles, Loader2, RefreshCw,
  XCircle, ArrowRight } from
"lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { motion } from "framer-motion";

export default function PersonalizedLearningPath() {
  const queryClient = useQueryClient();
  const [analyzing, setAnalyzing] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: skillGaps = [], isLoading } = useQuery({
    queryKey: ['mySkillGaps', currentUser?.email],
    queryFn: () => base44.entities.SkillGap.filter({
      user_email: currentUser.email,
      status: { "$ne": "dismissed" }
    }, '-severity,-last_detected'),
    enabled: !!currentUser?.email
  });

  const { data: trainingModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.filter({ is_active: true })
  });

  const runAnalysisMutation = useMutation({
    mutationFn: async () => {
      const { analyzeUserPerformance } = await import('@/functions/analyzeUserPerformance');
      return await analyzeUserPerformance({ user_email: currentUser.email });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mySkillGaps'] });
    }
  });

  const updateGapStatusMutation = useMutation({
    mutationFn: ({ gapId, status }) => base44.entities.SkillGap.update(gapId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mySkillGaps'] });
    }
  });

  const handleRunAnalysis = async () => {
    setAnalyzing(true);
    try {
      await runAnalysisMutation.mutateAsync();
    } finally {
      setAnalyzing(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':return 'bg-red-600 text-white';
      case 'high':return 'bg-orange-500 text-white';
      case 'medium':return 'bg-yellow-500 text-white';
      case 'low':return 'bg-blue-500 text-white';
      default:return 'bg-gray-500 text-white';
    }
  };

  const getGapTypeIcon = (gapType) => {
    switch (gapType) {
      case 'documentation':return BookOpen;
      case 'compliance':return AlertTriangle;
      case 'clinical_knowledge':return Brain;
      case 'oasis':return Target;
      default:return Sparkles;
    }
  };

  const activeGaps = skillGaps.filter((g) => g.status === 'identified' || g.status === 'in_progress');
  const addressedGaps = skillGaps.filter((g) => g.status === 'addressed');

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Your Personalized Learning Path
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              AI-identified skill gaps and tailored training recommendations
            </p>
          </div>
          <Button
            onClick={handleRunAnalysis}
            disabled={analyzing || runAnalysisMutation.isPending} className="bg-slate-200 text-slate-900 px-4 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow-sm dark:bg-slate-600 dark:hover:bg-slate-700 h-9 hover:bg-blue-700">


            {analyzing || runAnalysisMutation.isPending ?
            <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </> :

            <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Run New Analysis
              </>
            }
          </Button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="bg-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Active Gaps</p>
                  <p className="text-2xl font-bold text-gray-900">{activeGaps.length}</p>
                </div>
                <Target className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="bg-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Critical/High</p>
                  <p className="text-2xl font-bold text-orange-600">
                    {activeGaps.filter((g) => g.severity === 'critical' || g.severity === 'high').length}
                  </p>
                </div>
                <AlertTriangle className="w-8 h-8 text-orange-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="bg-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">In Progress</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {skillGaps.filter((g) => g.status === 'in_progress').length}
                  </p>
                </div>
                <TrendingUp className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="bg-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Addressed</p>
                  <p className="text-2xl font-bold text-green-600">{addressedGaps.length}</p>
                </div>
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Active Skill Gaps */}
      {activeGaps.length > 0 ?
      <div className="space-y-4 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-600" />
            Areas for Improvement
          </h2>
          {activeGaps.map((gap, idx) => {
          const GapIcon = getGapTypeIcon(gap.gap_type);
          const recommendedModules = trainingModules.filter((tm) =>
          gap.recommended_modules?.includes(tm.id)
          );

          return (
            <motion.div
              key={gap.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}>

                <Card className="hover:shadow-lg transition-all border-l-4 border-l-blue-600">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="mt-1">
                          <GapIcon className="w-6 h-6 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <CardTitle className="text-lg">{gap.skill_area}</CardTitle>
                            <Badge className={getSeverityColor(gap.severity)}>
                              {gap.severity}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {gap.gap_type.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          {gap.frequency_count > 1 &&
                        <Badge variant="outline" className="text-xs mb-2">
                              Detected {gap.frequency_count} times
                            </Badge>
                        }
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                            {gap.ai_reasoning}
                          </p>

                          {/* Recommended Training Modules */}
                          {recommendedModules.length > 0 &&
                        <div className="mt-4">
                              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Recommended Training:
                              </p>
                              <div className="space-y-2">
                                {recommendedModules.map((module) =>
                            <Link
                              key={module.id}
                              to={createPageUrl('ProviderTrainingHub')}>

                                    <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors">
                                      <div className="flex items-center gap-2">
                                        <BookOpen className="w-4 h-4 text-blue-600" />
                                        <span className="text-sm font-medium">{module.title}</span>
                                        {module.duration_minutes &&
                                  <Badge variant="outline" className="text-xs">
                                            {module.duration_minutes} min
                                          </Badge>
                                  }
                                      </div>
                                      <ArrowRight className="w-4 h-4 text-blue-600" />
                                    </div>
                                  </Link>
                            )}
                              </div>
                            </div>
                        }
                        </div>
                      </div>

                      <div className="flex gap-2 ml-3">
                        <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateGapStatusMutation.mutate({
                          gapId: gap.id,
                          status: 'in_progress'
                        })}
                        disabled={gap.status === 'in_progress'}>

                          {gap.status === 'in_progress' ? 'In Progress' : 'Start'}
                        </Button>
                        <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateGapStatusMutation.mutate({
                          gapId: gap.id,
                          status: 'dismissed'
                        })}>

                          <XCircle className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              </motion.div>);

        })}
        </div> :

      <Card className="mb-8">
          <CardContent className="bg-slate-100 p-12 text-center">
            <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              No Active Skill Gaps Identified
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Great work! Run a new analysis to check for areas to improve.
            </p>
            <Button
            onClick={handleRunAnalysis}
            disabled={analyzing} className="bg-slate-200 text-slate-900 px-4 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow-sm dark:bg-slate-600 dark:hover:bg-slate-700 h-9 hover:bg-blue-700">


              {analyzing ? 'Analyzing...' : 'Run Analysis'}
            </Button>
          </CardContent>
        </Card>
      }

      {/* Addressed Gaps */}
      {addressedGaps.length > 0 &&
      <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Addressed Skills
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {addressedGaps.map((gap) =>
          <Card key={gap.id} className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 dark:text-white">{gap.skill_area}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Addressed on {gap.addressed_date ? new Date(gap.addressed_date).toLocaleDateString() : 'Recently'}
                      </p>
                    </div>
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                </CardContent>
              </Card>
          )}
          </div>
        </div>
      }
    </div>);

}