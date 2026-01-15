import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  Award,
  TrendingUp,
  CheckCircle2,
  ArrowRight,
  GraduationCap,
  Sparkles } from
"lucide-react";
import PersonalizedLearningPathPlanner from "../components/training/PersonalizedLearningPathPlanner";
import BadgeDisplay from "../components/training/BadgeDisplay";
import TrainingProgressDashboard from "../components/training/TrainingProgressDashboard";

 

export default function ProviderTrainingHub() {
  

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

  const { data: completions = [] } = useQuery({
    queryKey: ['trainingCompletions', currentUser?.email],
    queryFn: () => base44.entities.TrainingCompletion.filter({
      nurse_email: currentUser?.email
    }),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: badges = [] } = useQuery({
    queryKey: ['providerBadges', currentUser?.email],
    queryFn: () => base44.entities.ProviderBadge.filter({
      provider_email: currentUser?.email
    }),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: certifications = [] } = useQuery({
    queryKey: ['certifications', currentUser?.email],
    queryFn: () => base44.entities.ProviderCertification.filter({
      provider_email: currentUser?.email
    }),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: trainingModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.list(),
    initialData: []
  });

  const completedModuleIds = completions.map((c) => c.training_module_id);
  const earnedCerts = certifications.filter((c) => c.status === 'earned');
  const inProgressCerts = certifications.filter((c) => c.status === 'in_progress');

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto pb-20 sm:pb-6 w-full max-w-full overflow-x-hidden min-w-0">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 sm:gap-4 mb-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-slate-600 dark:bg-slate-700 rounded-lg flex items-center justify-center shadow-lg flex-shrink-0">
            <GraduationCap className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 truncate">Provider Training Hub</h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 truncate">Master advanced features and earn certifications</p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <Card>
            <CardContent className="bg-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{completions.length}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Modules Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="bg-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{badges.length}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Badges Earned</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="bg-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{earnedCerts.length}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Certifications</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="bg-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{inProgressCerts.length}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">In Progress</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs defaultValue="learning-path" className="space-y-4 sm:space-y-6">
        <TabsList className="w-full overflow-x-auto">
          <div className="flex w-max min-w-full space-x-2 p-1">
          <TabsTrigger value="learning-path">Learning Path</TabsTrigger>
          <TabsTrigger value="modules">Modules</TabsTrigger>
          <TabsTrigger value="badges">Badges</TabsTrigger>
          <TabsTrigger value="progress">Progress</TabsTrigger>
        </div>
        </TabsList>

        {/* Learning Path Tab */}
        <TabsContent value="learning-path" className="space-y-4">
          {currentUser &&
          <PersonalizedLearningPathPlanner
            providerEmail={currentUser.email}
            providerType={currentUser.provider_type} />

          }
        </TabsContent>

        {/* Modules Tab */}
        <TabsContent value="modules" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {trainingModules.map((module) => {
              const isCompleted = completedModuleIds.includes(module.id);

              return (
                <Card key={module.id} className={isCompleted ? "border-slate-300 dark:border-slate-600 bg-slate-200 dark:bg-slate-800" : ""}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <CardTitle className="text-lg">{module.title}</CardTitle>
                        <Badge className="mt-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                          {module.category}
                        </Badge>
                      </div>
                      {isCompleted &&
                      <CheckCircle2 className="w-5 h-5 text-slate-700 dark:text-slate-400 flex-shrink-0 mt-1" />
                      }
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-gray-600">{module.description}</p>
                    
                    <div className="flex gap-4 text-xs text-gray-600">
                      <span>⏱ {module.duration} min</span>
                      <span>📊 {module.difficulty}</span>
                    </div>

                    <Button
                      className="w-full"
                      variant={isCompleted ? "outline" : "default"}>

                      {isCompleted ?
                      <>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Completed
                        </> :

                      <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Start Module
                        </>
                      }
                    </Button>
                  </CardContent>
                </Card>);

            })}
          </div>
        </TabsContent>

        {/* Badges Tab */}
        <TabsContent value="badges" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="w-5 h-5" />
                Your Badges
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BadgeDisplay badges={badges} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Progress Tab */}
        <TabsContent value="progress" className="space-y-4">
          <TrainingProgressDashboard
            completions={completions}
            certifications={certifications} />

        </TabsContent>
      </Tabs>
    </div>);

}