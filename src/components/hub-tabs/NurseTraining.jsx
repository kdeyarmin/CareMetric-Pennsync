import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useMyTrainingCompletions } from "@/hooks/useMyTrainingCompletions";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Target,
  Award,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Brain,
  FileText,
  BarChart3,
  UserPlus,
  RefreshCw,
  Zap
} from "lucide-react";
import InteractiveDocumentationScenarios from "@/components/training/InteractiveDocumentationScenarios";
import AIComplianceQuizGenerator from "@/components/training/AIComplianceQuizGenerator";
import NurseLearningDashboard from "@/components/training/NurseLearningDashboard";
import DetailedDeficitReport from "@/components/training/DetailedDeficitReport";
import OnboardingTracker from "@/components/training/OnboardingTracker";
import TrainingModuleViewer from "@/components/training/TrainingModuleViewer";
import PersonalizedLearningPath from "@/components/training/PersonalizedLearningPath";
import TrainingLibrary from "@/components/training/TrainingLibrary";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";

export default function NurseTraining() {
  const [activeTab, setActiveTab] = useState("onboarding");
  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [selectedQuizId, setSelectedQuizId] = useState(null);
  const [selectedModule, setSelectedModule] = useState(null);
  const [viewingModule, setViewingModule] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  React.useEffect(() => {
    logActivity(ActivityActions.PAGE_VISIT, { page: 'NurseTraining' });
  }, []);

  const { data: trainingProgress = [] } = useQuery({
    queryKey: ['myTrainingProgress', currentUser?.email],
    queryFn: () => base44.entities.MicroLearningProgress.filter({ 
      nurse_email: currentUser?.email 
    }),
    enabled: !!currentUser?.email,
  });

  const { data: recommendations = [] } = useQuery({
    queryKey: ['myRecommendations', currentUser?.email],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ 
      nurse_email: currentUser?.email,
      addressed: false
    }),
    enabled: !!currentUser?.email,
  });

  // Completed courses come from the live assignment/certificate system.
  const { completedCourseIds } = useMyTrainingCompletions(currentUser?.email);

  const completedCount = (trainingProgress?.filter(p => p?.status === 'completed')?.length || 0) +
                         completedCourseIds.size;
  // Average only completed/scored modules — dividing by all rows (incl. in-progress
  // ones whose score is masked to 0) dilutes the average downward.
  const scoredProgress = trainingProgress?.filter(p => p?.status === 'completed' && typeof p?.score === 'number') || [];
  const avgScore = scoredProgress.length > 0
    ? scoredProgress.reduce((sum, p) => sum + p.score, 0) / scoredProgress.length
    : 0;

  const handleStartModule = (module) => {
    setSelectedModule(module);
    setViewingModule(true);
  };

  const handleModuleComplete = (_score) => {
    setViewingModule(false);
    setSelectedModule(null);
  };

  if (viewingModule && selectedModule) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <TrainingModuleViewer
          module={selectedModule}
          nurseEmail={currentUser?.email}
          onComplete={handleModuleComplete}
          onBack={() => setViewingModule(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-700 font-medium">Completed</p>
                <p className="text-3xl font-bold text-blue-900">{completedCount}</p>
              </div>
              <CheckCircle2 className="w-10 h-10 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-green-700 font-medium">Avg Score</p>
                <p className="text-3xl font-bold text-green-900">{avgScore.toFixed(0)}%</p>
              </div>
              <Award className="w-10 h-10 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-orange-700 font-medium">In Progress</p>
                <p className="text-3xl font-bold text-orange-900">
                  {trainingProgress?.filter(p => p?.status === 'in_progress')?.length || 0}
                </p>
              </div>
              <TrendingUp className="w-10 h-10 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-navy-50 to-navy-100 border-navy-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-navy-700 font-medium">Recommendations</p>
                <p className="text-3xl font-bold text-navy-900">{recommendations?.length || 0}</p>
              </div>
              <Target className="w-10 h-10 text-navy-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Recommendations Banner */}
      {recommendations?.length > 0 && (
        <Card className="mb-6 bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900 mb-1">
                  You have {recommendations?.length || 0} training recommendation{recommendations?.length !== 1 ? 's' : ''}
                </h3>
                <p className="text-sm text-amber-700">
                  Complete practice scenarios and quizzes to address these areas: {' '}
                  {recommendations?.slice(0, 3).map(r => r?.recommendation_type).join(', ')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Training Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-7 h-auto">
          <TabsTrigger value="learning-path" className="flex items-center gap-2 py-3">
            <Target className="w-4 h-4" />
            <span className="hidden md:inline">My Path</span>
          </TabsTrigger>
          <TabsTrigger value="onboarding" className="flex items-center gap-2 py-3">
            <UserPlus className="w-4 h-4" />
            <span className="hidden md:inline">Onboarding</span>
          </TabsTrigger>
          <TabsTrigger value="ongoing" className="flex items-center gap-2 py-3">
            <RefreshCw className="w-4 h-4" />
            <span className="hidden md:inline">Ongoing</span>
          </TabsTrigger>
          <TabsTrigger value="skills" className="flex items-center gap-2 py-3">
            <Zap className="w-4 h-4" />
            <span className="hidden md:inline">Skills</span>
          </TabsTrigger>
          <TabsTrigger value="scenarios" className="flex items-center gap-2 py-3">
            <FileText className="w-4 h-4" />
            <span className="hidden md:inline">Scenarios</span>
          </TabsTrigger>
          <TabsTrigger value="quizzes" className="flex items-center gap-2 py-3">
            <Brain className="w-4 h-4" />
            <span className="hidden md:inline">Quizzes</span>
          </TabsTrigger>
          <TabsTrigger value="progress" className="flex items-center gap-2 py-3">
            <BarChart3 className="w-4 h-4" />
            <span className="hidden md:inline">Progress</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="learning-path" className="space-y-6">
          <PersonalizedLearningPath
            nurseEmail={currentUser?.email}
            onStartModule={handleStartModule}
          />
        </TabsContent>

        <TabsContent value="onboarding" className="space-y-6">
          <OnboardingTracker
            nurseEmail={currentUser?.email}
            onStartModule={handleStartModule}
          />
        </TabsContent>

        <TabsContent value="ongoing" className="space-y-6">
          <TrainingLibrary
            nurseEmail={currentUser?.email}
            moduleType="ongoing"
            onStartModule={handleStartModule}
          />
        </TabsContent>

        <TabsContent value="skills" className="space-y-6">
          <TrainingLibrary
            nurseEmail={currentUser?.email}
            moduleType="skill_development"
            onStartModule={handleStartModule}
          />
        </TabsContent>

        <TabsContent value="scenarios" className="space-y-6">
          <InteractiveDocumentationScenarios
            nurseEmail={currentUser?.email}
            recommendations={recommendations}
            initialScenarioId={selectedScenarioId}
          />
        </TabsContent>

        <TabsContent value="quizzes" className="space-y-6">
          <AIComplianceQuizGenerator
            nurseEmail={currentUser?.email}
            recommendations={recommendations}
            initialTopicId={selectedQuizId}
          />
        </TabsContent>

        <TabsContent value="progress" className="space-y-6">
          <DetailedDeficitReport
            nurseEmail={currentUser?.email}
            onStartScenario={(scenarioId) => {
              setSelectedScenarioId(scenarioId);
              setActiveTab('scenarios');
            }}
            onStartQuiz={(quizId) => {
              setSelectedQuizId(quizId);
              setActiveTab('quizzes');
            }}
          />
          
          <NurseLearningDashboard
            nurseEmail={currentUser?.email}
            trainingProgress={trainingProgress}
            recommendations={recommendations}
            onStartScenario={(scenarioId) => {
              setSelectedScenarioId(scenarioId);
              setActiveTab('scenarios');
            }}
            onStartQuiz={(quizId) => {
              setSelectedQuizId(quizId);
              setActiveTab('quizzes');
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}