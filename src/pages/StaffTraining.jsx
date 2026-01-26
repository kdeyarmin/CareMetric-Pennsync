import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GraduationCap, BookOpen, TrendingUp, Award, Target, Brain } from 'lucide-react';
import AITrainingRecommendationEngine from '../components/training/AITrainingRecommendationEngine';
import TrainingLibraryCatalog from '../components/training/TrainingLibraryCatalog';
import StaffProgressTracker from '../components/training/StaffProgressTracker';
import { Badge } from '@/components/ui/badge';

export default function StaffTraining() {
  const [selectedTab, setSelectedTab] = useState('dashboard');

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: myTrainingCompletions = [] } = useQuery({
    queryKey: ['myTrainingCompletions', currentUser?.email],
    queryFn: () => base44.entities.TrainingCompletion.filter({ 
      nurse_email: currentUser.email 
    }),
    enabled: !!currentUser?.email,
  });

  const { data: allTrainingModules = [] } = useQuery({
    queryKey: ['allTrainingModules'],
    queryFn: () => base44.entities.TrainingModule.list(),
  });

  const { data: myRecommendations = [] } = useQuery({
    queryKey: ['myTrainingRecommendations', currentUser?.email],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ 
      user_email: currentUser.email,
      status: 'active'
    }),
    enabled: !!currentUser?.email,
  });

  const { data: mySkillGaps = [] } = useQuery({
    queryKey: ['mySkillGaps', currentUser?.email],
    queryFn: () => base44.entities.SkillGap.filter({ 
      user_email: currentUser.email 
    }),
    enabled: !!currentUser?.email,
  });

  // Calculate stats
  const completedCount = myTrainingCompletions.filter(t => t.status === 'completed').length;
  const inProgressCount = myTrainingCompletions.filter(t => t.status === 'in_progress').length;
  const avgScore = myTrainingCompletions.filter(t => t.score).length > 0
    ? Math.round(myTrainingCompletions.filter(t => t.score).reduce((sum, t) => sum + t.score, 0) / myTrainingCompletions.filter(t => t.score).length)
    : 0;
  const totalModules = allTrainingModules.length;
  const completionRate = totalModules > 0 ? Math.round((completedCount / totalModules) * 100) : 0;

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="p-8 text-center">
            <p className="text-gray-600">Please log in to access training</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <GraduationCap className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Staff Training Center</h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          AI-powered personalized learning and professional development
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Award className="w-6 h-6 text-blue-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{completedCount}</p>
            <p className="text-xs text-gray-600">Completed Modules</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <BookOpen className="w-6 h-6 text-purple-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{inProgressCount}</p>
            <p className="text-xs text-gray-600">In Progress</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{avgScore}%</p>
            <p className="text-xs text-gray-600">Average Score</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Target className="w-6 h-6 text-amber-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{completionRate}%</p>
            <p className="text-xs text-gray-600">Completion Rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Active Recommendations Banner */}
      {myRecommendations.length > 0 && (
        <Card className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Brain className="w-6 h-6 text-blue-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <p className="font-semibold text-gray-900 mb-1">
                  🎯 You have {myRecommendations.length} AI-recommended training{myRecommendations.length > 1 ? 's' : ''}
                </p>
                <p className="text-sm text-gray-700">
                  Based on your performance analytics and skill gaps, we've identified personalized learning opportunities for you.
                </p>
              </div>
              <Badge className="bg-blue-600">{myRecommendations.length}</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="dashboard">
            <Target className="w-4 h-4 mr-2" />
            My Progress
          </TabsTrigger>
          <TabsTrigger value="recommendations">
            <Brain className="w-4 h-4 mr-2" />
            AI Recommendations
          </TabsTrigger>
          <TabsTrigger value="library">
            <BookOpen className="w-4 h-4 mr-2" />
            Training Library
          </TabsTrigger>
        </TabsList>

        {/* Progress Dashboard Tab */}
        <TabsContent value="dashboard" className="space-y-6">
          <StaffProgressTracker 
            currentUser={currentUser}
            completions={myTrainingCompletions}
            modules={allTrainingModules}
            skillGaps={mySkillGaps}
          />
        </TabsContent>

        {/* AI Recommendations Tab */}
        <TabsContent value="recommendations" className="space-y-6">
          <AITrainingRecommendationEngine 
            currentUser={currentUser}
            recommendations={myRecommendations}
            skillGaps={mySkillGaps}
            completions={myTrainingCompletions}
          />
        </TabsContent>

        {/* Training Library Tab */}
        <TabsContent value="library" className="space-y-6">
          <TrainingLibraryCatalog 
            modules={allTrainingModules}
            userCompletions={myTrainingCompletions}
            currentUser={currentUser}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}