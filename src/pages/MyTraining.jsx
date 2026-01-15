import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Target,
  BookOpen,
  Award,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ArrowRight
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { motion } from "framer-motion";

export default function MyTraining() {
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: skillGaps = [] } = useQuery({
    queryKey: ["mySkillGaps", currentUser?.email],
    queryFn: () =>
      base44.entities.SkillGap.filter(
        { user_email: currentUser.email, status: { $ne: "dismissed" } },
        "-severity,-last_detected"
      ),
    enabled: !!currentUser?.email
  });

  const { data: trainingModules = [] } = useQuery({
    queryKey: ["trainingModules"],
    queryFn: () => base44.entities.TrainingModule.filter({ is_active: true })
  });

  const { data: completions = [] } = useQuery({
    queryKey: ["trainingCompletions", currentUser?.email],
    queryFn: () =>
      base44.entities.TrainingCompletion.filter({
        nurse_email: currentUser?.email
      }),
    enabled: !!currentUser?.email
  });

  const { data: badges = [] } = useQuery({
    queryKey: ["providerBadges", currentUser?.email],
    queryFn: () =>
      base44.entities.ProviderBadge.filter({
        provider_email: currentUser?.email
      }),
    enabled: !!currentUser?.email
  });

  const activeGaps = skillGaps.filter((g) => g.status === "identified" || g.status === "in_progress");
  const completedModuleIds = completions.map((c) => c.training_module_id);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case "critical":
        return "bg-red-600 text-white";
      case "high":
        return "bg-orange-500 text-white";
      case "medium":
        return "bg-yellow-500 text-white";
      default:
        return "bg-blue-500 text-white";
    }
  };

  const getGapTypeIcon = (gapType) => {
    const icons = {
      documentation: BookOpen,
      compliance: AlertTriangle,
      clinical_knowledge: Target,
      oasis: Target
    };
    return icons[gapType] || Sparkles;
  };

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto pb-20 sm:pb-6 w-full max-w-full overflow-x-hidden min-w-0">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
          My Training
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          AI-driven skill gaps and available training modules
        </p>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-6">
          <Card>
            <CardContent className="bg-slate-100 dark:bg-slate-800 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                {activeGaps.length}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Skill Gaps
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="bg-slate-100 dark:bg-slate-800 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                {completions.length}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Completed
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="bg-slate-100 dark:bg-slate-800 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                {badges.length}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Badges
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="bg-slate-100 dark:bg-slate-800 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                {trainingModules.length}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Available
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs defaultValue="gaps" className="space-y-4 sm:space-y-6">
        <TabsList>
          <TabsTrigger value="gaps">
            <Target className="w-4 h-4 mr-2" />
            Skill Gaps
          </TabsTrigger>
          <TabsTrigger value="modules">
            <BookOpen className="w-4 h-4 mr-2" />
            Modules
          </TabsTrigger>
          <TabsTrigger value="progress">
            <TrendingUp className="w-4 h-4 mr-2" />
            Progress
          </TabsTrigger>
        </TabsList>

        {/* Skill Gaps Tab */}
        <TabsContent value="gaps" className="space-y-4">
          {activeGaps.length > 0 ? (
            <div className="space-y-4">
              {activeGaps.map((gap, idx) => {
                const GapIcon = getGapTypeIcon(gap.gap_type);
                return (
                  <motion.div
                    key={gap.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                  >
                    <Card className="border-l-4 border-l-blue-600">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1">
                            <GapIcon className="w-5 h-5 text-blue-600 mt-1 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <CardTitle className="text-lg">
                                  {gap.skill_area}
                                </CardTitle>
                                <Badge className={getSeverityColor(gap.severity)}>
                                  {gap.severity}
                                </Badge>
                              </div>
                              <p className="text-sm text-slate-600 dark:text-slate-400">
                                {gap.ai_reasoning}
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            className="flex-shrink-0"
                            onClick={() => {
                              base44.entities.SkillGap.update(gap.id, {
                                status: "in_progress"
                              });
                            }}
                          >
                            Start
                          </Button>
                        </div>
                      </CardHeader>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                  No Active Skill Gaps
                </h3>
                <p className="text-slate-600 dark:text-slate-400">
                  Great work! Continue with available training modules.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Modules Tab */}
        <TabsContent value="modules" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {trainingModules.map((module) => {
              const isCompleted = completedModuleIds.includes(module.id);
              return (
                <Card
                  key={module.id}
                  className={
                    isCompleted
                      ? "border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800"
                      : ""
                  }
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg">{module.title}</CardTitle>
                        <Badge className="mt-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                          {module.category}
                        </Badge>
                      </div>
                      {isCompleted && (
                        <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {module.description}
                    </p>
                    <div className="flex gap-4 text-xs text-slate-600 dark:text-slate-400">
                      <span>⏱ {module.duration_minutes || module.duration} min</span>
                      <span>📊 {module.difficulty_level || module.difficulty}</span>
                    </div>
                    <Button className="w-full" variant={isCompleted ? "outline" : "default"}>
                      {isCompleted ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Completed
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Start Module
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Progress Tab */}
        <TabsContent value="progress" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Your Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    Completion Rate
                  </p>
                  <span className="text-lg font-bold text-blue-600">
                    {trainingModules.length > 0
                      ? Math.round(
                          (completions.length / trainingModules.length) * 100
                        )
                      : 0}
                    %
                  </span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{
                      width:
                        trainingModules.length > 0
                          ? `${(completions.length / trainingModules.length) * 100}%`
                          : "0%"
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                  <p className="text-2xl font-bold text-blue-600 mb-1">
                    {completions.length}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Modules Completed
                  </p>
                </div>
                <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                  <p className="text-2xl font-bold text-green-600 mb-1">
                    {badges.length}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Badges Earned
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}