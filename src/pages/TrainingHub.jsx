import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  GraduationCap, BookOpen, Target, TrendingUp, Award, Sparkles,
  Clock, CheckCircle, AlertCircle, PlayCircle, Loader2, Users, BarChart3
} from "lucide-react";
import { format } from "date-fns";
import PersonalizedLearningPathPlanner from "../components/training/PersonalizedLearningPathPlanner";
import BadgeDisplay from "../components/training/BadgeDisplay";
import TrainingProgressDashboard from "../components/training/TrainingProgressDashboard";
import PersonalizedRecommendationsWidget from "../components/training/PersonalizedRecommendationsWidget";
import InteractiveTrainingViewer from "../components/training/InteractiveTrainingViewer";
import AITrainingRecommendations from "../components/training/AITrainingRecommendations";
import TrainingResourceLibrary from "../components/training/TrainingResourceLibrary";
import StaffProgressTracker from "../components/training/StaffProgressTracker";
import SkillGapAnalysisPanel from "../components/training/SkillGapAnalysisPanel";
import PersonalTrainingDashboard from "../components/training/PersonalTrainingDashboard";

export default function TrainingHub() {
  const [selectedTraining, setSelectedTraining] = useState(null);
  const [activeView, setActiveView] = useState("my-training");

  const { data: currentUser, isLoading: userLoading } = useQuery({
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
    queryFn: () => base44.entities.TrainingCompletion.filter({ nurse_email: currentUser?.email }),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: badges = [] } = useQuery({
    queryKey: ['providerBadges', currentUser?.email],
    queryFn: () => base44.entities.ProviderBadge.filter({ provider_email: currentUser?.email }),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: certifications = [] } = useQuery({
    queryKey: ['certifications', currentUser?.email],
    queryFn: () => base44.entities.ProviderCertification.filter({ provider_email: currentUser?.email }),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: trainingModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.list(),
    initialData: []
  });

  const { data: skillGaps = [] } = useQuery({
    queryKey: ['mySkillGaps', currentUser?.email],
    queryFn: () => base44.entities.SkillGap.filter({ user_email: currentUser?.email }),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    enabled: currentUser?.role === 'admin',
    initialData: []
  });

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (selectedTraining) {
    const module = trainingModules.find(m => m.id === selectedTraining.training_module_id);
    if (!module) return null;

    return (
      <div className="p-3 sm:p-4 md:p-6 max-w-4xl mx-auto pb-20 sm:pb-6">
        <Button variant="outline" onClick={() => setSelectedTraining(null)} className="mb-3 sm:mb-4 w-full sm:w-auto touch-target">
          ← Back to Training
        </Button>
        <InteractiveTrainingViewer 
          module={module}
          completion={selectedTraining}
          onComplete={() => setSelectedTraining(null)}
        />
      </div>
    );
  }

  const isAdmin = currentUser?.role === 'admin';
  const completedModuleIds = completions.map(c => c.training_module_id);
  const earnedCerts = certifications.filter(c => c.status === 'earned');
  const assigned = completions.filter(t => t.status === 'assigned');
  const inProgress = completions.filter(t => t.status === 'in_progress');
  const completed = completions.filter(t => t.status === 'completed');
  const overdue = completions.filter(t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date());
  const completionRate = completions.length > 0 ? Math.round((completed.length / completions.length) * 100) : 0;
  const activeGaps = skillGaps.filter(g => g.status === 'identified' || g.status === 'in_progress').length;

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto pb-20 sm:pb-6 w-full max-w-full overflow-x-hidden min-w-0">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
          Training Hub
        </h1>
        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 mt-1">
          Personalized learning, skill development, and certifications
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-2 md:gap-3 mb-3 sm:mb-4 md:mb-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-2 sm:p-3 text-center">
            <p className="text-xl sm:text-2xl font-bold text-blue-700">{completed.length}</p>
            <p className="text-[10px] sm:text-xs text-blue-600 mt-1">Completed</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardContent className="p-3 text-center">
            <p className="text-xl sm:text-2xl font-bold text-amber-700">{inProgress.length}</p>
            <p className="text-[10px] sm:text-xs text-amber-600 mt-1">In Progress</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-3 text-center">
            <p className="text-xl sm:text-2xl font-bold text-purple-700">{completionRate}%</p>
            <p className="text-[10px] sm:text-xs text-purple-600 mt-1">Completion</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-3 text-center">
            <p className="text-xl sm:text-2xl font-bold text-green-700">{earnedCerts.length}</p>
            <p className="text-[10px] sm:text-xs text-green-600 mt-1">Certifications</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <CardContent className="p-3 text-center">
            <p className="text-xl sm:text-2xl font-bold text-orange-700">{activeGaps}</p>
            <p className="text-[10px] sm:text-xs text-orange-600 mt-1">Skill Gaps</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue={activeView} onValueChange={setActiveView} className="w-full">
        <div className="w-full overflow-x-auto mb-4 scrollbar-hide">
          <TabsList className="inline-flex w-max min-w-full gap-1 p-1">
            <TabsTrigger value="my-training" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap">My Training</TabsTrigger>
            <TabsTrigger value="assigned" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap">Assigned ({assigned.length + inProgress.length})</TabsTrigger>
            <TabsTrigger value="ai-recommendations" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap">AI Recs</TabsTrigger>
            <TabsTrigger value="library" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap">Library</TabsTrigger>
            <TabsTrigger value="skills" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap">Skills</TabsTrigger>
            <TabsTrigger value="badges" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap">Badges</TabsTrigger>
            {isAdmin && <TabsTrigger value="staff" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3 whitespace-nowrap">Staff</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="my-training" className="space-y-4 mt-6">
          <PersonalTrainingDashboard 
            userEmail={currentUser?.email}
            completions={completions}
            trainingModules={trainingModules}
          />
        </TabsContent>

        <TabsContent value="assigned" className="space-y-3 sm:space-y-4 mt-6 w-full">
          {[...assigned, ...inProgress].map(training => {
            const module = trainingModules.find(m => m.id === training.training_module_id);
            if (!module) return null;
            const isOverdue = training.due_date && new Date(training.due_date) < new Date();

            return (
              <Card key={training.id} className={`${isOverdue ? "border-red-200" : ""} w-full`}>
                <CardHeader className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
                    <div className="flex-1 w-full min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <CardTitle className="text-base sm:text-lg break-words">{module.title}</CardTitle>
                        {training.status === 'in_progress' && <Badge className="bg-blue-100 text-blue-800">In Progress</Badge>}
                        {isOverdue && <Badge className="bg-red-100 text-red-800">Overdue</Badge>}
                      </div>
                      <CardDescription>{module.description}</CardDescription>
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{module.duration_minutes} min</span>
                        {training.due_date && <span className={isOverdue ? "text-red-600 font-medium" : ""}>Due: {format(new Date(training.due_date), 'MMM d, yyyy')}</span>}
                      </div>
                    </div>
                    <Button onClick={() => setSelectedTraining(training)} className="bg-blue-600 w-full sm:w-auto touch-target">
                      <PlayCircle className="w-4 h-4 mr-2" />
                      {training.status === 'in_progress' ? 'Continue' : 'Start'}
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
          {assigned.length === 0 && inProgress.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <p className="text-slate-600">All caught up!</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="ai-recommendations" className="mt-6">
          <AITrainingRecommendations 
            userEmail={currentUser?.email}
            skillGaps={skillGaps}
            completions={completions}
            trainingModules={trainingModules}
          />
        </TabsContent>

        <TabsContent value="library" className="mt-6">
          <TrainingResourceLibrary 
            trainingModules={trainingModules}
            completions={completions}
            userEmail={currentUser?.email}
          />
        </TabsContent>

        <TabsContent value="skills" className="mt-6">
          <SkillGapAnalysisPanel 
            userEmail={currentUser?.email}
            skillGaps={skillGaps}
            trainingModules={trainingModules}
          />
        </TabsContent>

        <TabsContent value="badges" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="w-5 h-5" />
                Your Badges & Certifications
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BadgeDisplay badges={badges} />
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="staff" className="mt-6">
            <StaffProgressTracker 
              users={allUsers}
              trainingModules={trainingModules}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}