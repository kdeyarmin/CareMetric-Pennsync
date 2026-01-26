import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  GraduationCap,
  BookOpen,
  Target,
  TrendingUp,
  Search,
  Sparkles,
  Award,
  BarChart3,
  Users,
  Loader2
} from "lucide-react";

import AITrainingRecommendations from "../components/training/AITrainingRecommendations";
import TrainingResourceLibrary from "../components/training/TrainingResourceLibrary";
import StaffProgressTracker from "../components/training/StaffProgressTracker";
import SkillGapAnalysisPanel from "../components/training/SkillGapAnalysisPanel";
import PersonalTrainingDashboard from "../components/training/PersonalTrainingDashboard";

export default function StaffTrainingModule() {
  const [activeTab, setActiveTab] = useState("overview");

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

  const { data: trainingModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.list(),
    initialData: []
  });

  const { data: completions = [] } = useQuery({
    queryKey: ['myCompletions', currentUser?.email],
    queryFn: () => base44.entities.TrainingCompletion.filter({ nurse_email: currentUser?.email }),
    enabled: !!currentUser?.email,
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

  const isAdmin = currentUser?.role === 'admin';

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
      </div>
    );
  }

  // Calculate stats
  const completedCount = completions.filter(c => c.status === 'completed').length;
  const inProgressCount = completions.filter(c => c.status === 'in_progress').length;
  const overdueCount = completions.filter(c => 
    c.status !== 'completed' && c.due_date && new Date(c.due_date) < new Date()
  ).length;
  const completionRate = completions.length > 0 
    ? Math.round((completedCount / completions.length) * 100) 
    : 0;
  const activeGaps = skillGaps.filter(g => g.status === 'identified' || g.status === 'in_progress').length;

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto pb-20 sm:pb-6 w-full overflow-x-hidden">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-3 sm:gap-4 mb-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
            <GraduationCap className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100">
              Staff Training Module
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              AI-powered personalized learning & skill development
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4 text-center">
              <p className="text-2xl sm:text-3xl font-bold text-blue-700 dark:text-blue-300">{completedCount}</p>
              <p className="text-xs sm:text-sm text-blue-600 dark:text-blue-400 mt-1">Completed</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900 border-amber-200 dark:border-amber-800">
            <CardContent className="p-4 text-center">
              <p className="text-2xl sm:text-3xl font-bold text-amber-700 dark:text-amber-300">{inProgressCount}</p>
              <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400 mt-1">In Progress</p>
            </CardContent>
          </Card>
          <Card className={`bg-gradient-to-br ${overdueCount > 0 ? 'from-red-50 to-red-100 dark:from-red-950 dark:to-red-900 border-red-200 dark:border-red-800' : 'from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200 dark:border-green-800'}`}>
            <CardContent className="p-4 text-center">
              <p className={`text-2xl sm:text-3xl font-bold ${overdueCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>{overdueCount}</p>
              <p className={`text-xs sm:text-sm mt-1 ${overdueCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>Overdue</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200 dark:border-purple-800">
            <CardContent className="p-4 text-center">
              <p className="text-2xl sm:text-3xl font-bold text-purple-700 dark:text-purple-300">{completionRate}%</p>
              <p className="text-xs sm:text-sm text-purple-600 dark:text-purple-400 mt-1">Completion Rate</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900 border-orange-200 dark:border-orange-800">
            <CardContent className="p-4 text-center">
              <p className="text-2xl sm:text-3xl font-bold text-orange-700 dark:text-orange-300">{activeGaps}</p>
              <p className="text-xs sm:text-sm text-orange-600 dark:text-orange-400 mt-1">Skill Gaps</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-6">
        <TabsList className="w-full overflow-x-auto bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm">
          <div className="flex w-max min-w-full space-x-1 p-1">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Target className="w-4 h-4" />
              <span className="hidden sm:inline">My Training</span>
              <span className="sm:hidden">Training</span>
            </TabsTrigger>
            <TabsTrigger value="recommendations" className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">AI Recommendations</span>
              <span className="sm:hidden">AI</span>
            </TabsTrigger>
            <TabsTrigger value="library" className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Resource Library</span>
              <span className="sm:hidden">Library</span>
            </TabsTrigger>
            <TabsTrigger value="skills" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="hidden sm:inline">Skill Gaps</span>
              <span className="sm:hidden">Skills</span>
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="staff" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">Staff Progress</span>
                <span className="sm:hidden">Staff</span>
              </TabsTrigger>
            )}
          </div>
        </TabsList>

        {/* My Training Tab */}
        <TabsContent value="overview" className="space-y-4">
          <PersonalTrainingDashboard 
            userEmail={currentUser?.email}
            completions={completions}
            trainingModules={trainingModules}
          />
        </TabsContent>

        {/* AI Recommendations Tab */}
        <TabsContent value="recommendations" className="space-y-4">
          <AITrainingRecommendations 
            userEmail={currentUser?.email}
            skillGaps={skillGaps}
            completions={completions}
            trainingModules={trainingModules}
          />
        </TabsContent>

        {/* Resource Library Tab */}
        <TabsContent value="library" className="space-y-4">
          <TrainingResourceLibrary 
            trainingModules={trainingModules}
            completions={completions}
            userEmail={currentUser?.email}
          />
        </TabsContent>

        {/* Skill Gaps Tab */}
        <TabsContent value="skills" className="space-y-4">
          <SkillGapAnalysisPanel 
            userEmail={currentUser?.email}
            skillGaps={skillGaps}
            trainingModules={trainingModules}
          />
        </TabsContent>

        {/* Staff Progress Tab (Admin Only) */}
        {isAdmin && (
          <TabsContent value="staff" className="space-y-4">
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