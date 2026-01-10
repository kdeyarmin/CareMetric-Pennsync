import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import PremiumFeatureGate from "../components/subscription/PremiumFeatureGate";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  GraduationCap,
  BookOpen,
  HelpCircle,
  Play,
  Trophy,
  Target,
  Clock,
  CheckCircle2,
  Star,
  TrendingUp,
  Award
} from "lucide-react";

import AITrainingContentGenerator from "../components/training/AITrainingContentGenerator";
import InteractiveQuizModule from "../components/training/InteractiveQuizModule";
import ClinicalSimulationModule from "../components/training/ClinicalSimulationModule";
import NurseFeedbackAggregator from "../components/training/NurseFeedbackAggregator";
import PersonalizedTrainingPlan from "../components/training/PersonalizedTrainingPlan";
import TargetedLessonGenerator from "../components/training/TargetedLessonGenerator";
import AIPersonalizedTrainingPlan from "../components/training/AIPersonalizedTrainingPlan";
import AIInteractiveQuiz from "../components/training/AIInteractiveQuiz";
import AIPatientSimulation from "../components/training/AIPatientSimulation";
import SkillGapRemediationSection from "../components/training/SkillGapRemediationSection";
import StateSurveyVideos from "../components/training/StateSurveyVideos";
import EducationVideos from "../components/training/EducationVideos";
import AIPersonalizedTrainingHub from "../components/training/AIPersonalizedTrainingHub";
import TrainingProgressDashboard from "../components/training/TrainingProgressDashboard";
import StaffEducationComplianceReport from "../components/training/StaffEducationComplianceReport";
import ModuleViewer from "../components/training/ModuleViewer";
import AIQuizGenerator from "../components/training/AIQuizGenerator";
import EmptyState from "../components/ui/EmptyState";
import { motion } from "framer-motion";

export default function StaffTrainingHub() {
  const navigate = useNavigate();
  
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    },
  });

  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [skillGaps, setSkillGaps] = useState([]);
  const [activeModule, setActiveModule] = useState(null);

  // Only fetch current user's training data
  const { data: trainingProgress = [] } = useQuery({
    queryKey: ['myTrainingProgress', currentUser?.email],
    queryFn: () => base44.entities.MicroLearningProgress.filter({ nurse_email: currentUser?.email }),
    enabled: !!currentUser?.email,
  });

  const { data: completions = [] } = useQuery({
    queryKey: ['myTrainingCompletions', currentUser?.email],
    queryFn: () => base44.entities.TrainingCompletion.filter({ nurse_email: currentUser?.email }),
    enabled: !!currentUser?.email,
  });

  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['myComplianceAudits', currentUser?.email],
    queryFn: () => base44.entities.ComplianceAudit.filter({ nurse_email: currentUser?.email }),
    enabled: !!currentUser?.email,
  });

  const { data: recommendations = [] } = useQuery({
    queryKey: ['myTrainingRecommendations', currentUser?.email],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ nurse_email: currentUser?.email }),
    enabled: !!currentUser?.email,
  });

  const [selectedQuizTopic, setSelectedQuizTopic] = useState(null);
  const [selectedSimScenario, setSelectedSimScenario] = useState(null);
  const [selectedModule, setSelectedModule] = useState(null);

  const { data: trainingModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.filter({ is_active: true }),
    initialData: [],
  });

  const saveProgressMutation = useMutation({
    mutationFn: (data) => base44.entities.MicroLearningProgress.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trainingProgress'] })
  });

  const handleQuizCompleted = async (result) => {
    try {
      await saveProgressMutation.mutateAsync({
        nurse_email: currentUser?.email,
        skill_area: result.category,
        module_type: 'quiz',
        status: result.percentage >= 80 ? 'completed' : 'needs_review',
        score: result.percentage,
        time_spent_minutes: result.duration,
        source: 'manual'
      });
    } catch (error) {
      // Error logged server-side
    }
  };

  const handleSimulationCompleted = async (result) => {
    try {
      await saveProgressMutation.mutateAsync({
        nurse_email: currentUser?.email,
        skill_area: result.scenario,
        module_type: 'scenario',
        status: result.score >= 70 ? 'completed' : 'needs_review',
        score: result.score,
        source: 'manual'
      });
    } catch (error) {
      // Error logged server-side
    }
  };

  // Calculate stats
  const completedQuizzes = trainingProgress.filter(p => p.module_type === 'quiz' && p.status === 'completed').length;
  const completedSimulations = trainingProgress.filter(p => p.module_type === 'scenario' && p.status === 'completed').length;
  const averageScore = trainingProgress.length > 0 
    ? Math.round(trainingProgress.reduce((sum, p) => sum + (p.score || 0), 0) / trainingProgress.length)
    : 0;
  const totalTime = trainingProgress.reduce((sum, p) => sum + (p.time_spent_minutes || 0), 0);

  return (
    <PremiumFeatureGate
      featureName="Training Hub"
      featureDescription="Access personalized AI-powered training with interactive quizzes, patient simulations, and skill development plans. This premium feature accelerates your professional growth."
      allowTrial={true}
    >
    <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto w-full max-w-full overflow-x-hidden min-w-0">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 sm:w-7 sm:h-7 text-indigo-600" />
          My Training Hub
        </h1>
        <p className="text-sm sm:text-base text-gray-600 mt-1">Your personalized training on documentation, compliance, and patient communication</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <motion.div whileHover={{ scale: 1.05 }} transition={{ type: "spring", stiffness: 300 }}>
          <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-none hover-lift">
            <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-[10px] sm:text-xs">Quizzes Passed</p>
                <p className="text-xl sm:text-2xl font-bold">{completedQuizzes}</p>
              </div>
              <HelpCircle className="w-6 h-6 sm:w-8 sm:h-8 text-blue-200" />
            </div>
          </CardContent>
        </Card>
        </motion.div>

        <motion.div whileHover={{ scale: 1.05 }} transition={{ type: "spring", stiffness: 300 }}>
          <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white border-none hover-lift">
            <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-[10px] sm:text-xs">Simulations</p>
                <p className="text-xl sm:text-2xl font-bold">{completedSimulations}</p>
              </div>
              <Play className="w-6 h-6 sm:w-8 sm:h-8 text-purple-200" />
            </div>
          </CardContent>
        </Card>
        </motion.div>

        <motion.div whileHover={{ scale: 1.05 }} transition={{ type: "spring", stiffness: 300 }}>
          <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white border-none hover-lift">
            <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-[10px] sm:text-xs">Avg Score</p>
                <p className="text-xl sm:text-2xl font-bold">{averageScore}%</p>
              </div>
              <Target className="w-6 h-6 sm:w-8 sm:h-8 text-green-200" />
            </div>
          </CardContent>
        </Card>
        </motion.div>

        <motion.div whileHover={{ scale: 1.05 }} transition={{ type: "spring", stiffness: 300 }}>
          <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border-none hover-lift">
            <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-[10px] sm:text-xs">Time Invested</p>
                <p className="text-xl sm:text-2xl font-bold">{totalTime}m</p>
              </div>
              <Clock className="w-6 h-6 sm:w-8 sm:h-8 text-orange-200" />
            </div>
          </CardContent>
        </Card>
        </motion.div>
      </div>

      {/* Module Viewer Modal */}
      {selectedModule && (
        <div className="mb-6">
          <Card className="border-2 border-purple-300">
            <CardHeader className="bg-purple-50">
              <div className="flex items-center justify-between">
                <CardTitle>Currently Viewing: {selectedModule.title}</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedModule(null)}
                >
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <ModuleViewer
                module={selectedModule}
                userEmail={currentUser?.email}
                onComplete={() => {
                  setSelectedModule(null);
                  queryClient.invalidateQueries({ queryKey: ['myTrainingCompletions'] });
                }}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Individual User Training Hub */}
      <Tabs defaultValue="aipath" className="w-full">
          <TabsList className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-11 gap-1 w-full mb-6 h-auto p-1">
            <TabsTrigger value="modules" className="flex items-center gap-1 text-xs sm:text-sm px-2 py-2">
              <BookOpen className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Modules</span>
            </TabsTrigger>
            <TabsTrigger value="aipath" className="flex items-center gap-1 bg-gradient-to-r from-purple-50 to-indigo-50 data-[state=active]:bg-purple-100 text-xs sm:text-sm px-2 py-2">
              <Star className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">AI Path</span>
            </TabsTrigger>
            <TabsTrigger value="progress" className="flex items-center gap-1 text-xs sm:text-sm px-2 py-2">
              <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Progress</span>
            </TabsTrigger>
          <TabsTrigger value="overview" className="flex items-center gap-1 text-xs sm:text-sm px-2 py-2">
            <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="survey" className="flex items-center gap-1 bg-gradient-to-r from-red-50 to-orange-50 data-[state=active]:bg-red-100 text-xs sm:text-sm px-2 py-2">
            <Trophy className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Survey</span>
          </TabsTrigger>
          <TabsTrigger value="videos" className="flex items-center gap-1 text-xs sm:text-sm px-2 py-2">
            <BookOpen className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Videos</span>
          </TabsTrigger>
          <TabsTrigger value="remediation" className="flex items-center gap-1 text-xs sm:text-sm px-2 py-2">
            <Target className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Remediation</span>
          </TabsTrigger>
          <TabsTrigger value="myplan" className="flex items-center gap-1 text-xs sm:text-sm px-2 py-2">
            <Star className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">My Plan</span>
          </TabsTrigger>
          <TabsTrigger value="learn" className="flex items-center gap-1 text-xs sm:text-sm px-2 py-2">
            <BookOpen className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Learn</span>
          </TabsTrigger>
          <TabsTrigger value="quiz" className="flex items-center gap-1 text-xs sm:text-sm px-2 py-2">
            <HelpCircle className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Quiz</span>
          </TabsTrigger>
          <TabsTrigger value="simulate" className="flex items-center gap-1 text-xs sm:text-sm px-2 py-2">
            <Play className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Simulate</span>
          </TabsTrigger>
          </TabsList>

          {/* Training Modules Tab */}
          <TabsContent value="modules">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {trainingModules.map((module, idx) => {
                const userCompletion = completions.find(c => c.training_module_id === module.id);
                const isCompleted = userCompletion?.status === 'completed';
                
                return (
                  <motion.div
                    key={module.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    whileHover={{ y: -4 }}
                  >
                    <Card className={`cursor-pointer hover:shadow-xl transition-all hover-lift ${
                      isCompleted ? 'border-green-300 bg-green-50 dark:bg-green-900/10 dark:border-green-700' : 'border-gray-200 dark:border-gray-700'
                    }`} onClick={() => setSelectedModule(module)}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900 mb-1">{module.title}</h3>
                          <p className="text-xs text-gray-600 line-clamp-2">{module.description}</p>
                        </div>
                        {isCompleted && (
                          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                        )}
                      </div>
                      
                      <div className="flex flex-wrap gap-2 mb-3">
                        <Badge variant="outline" className="text-xs">{module.category}</Badge>
                        <Badge variant="outline" className="text-xs">{module.difficulty_level}</Badge>
                        <Badge variant="outline" className="text-xs flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {module.duration_minutes}m
                        </Badge>
                      </div>

                      {userCompletion && (
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-600">Progress</span>
                            <span className="font-medium">{userCompletion.status}</span>
                          </div>
                          {userCompletion.score && (
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-600">Score</span>
                              <Badge className="bg-blue-600">{userCompletion.score}%</Badge>
                            </div>
                          )}
                        </div>
                      )}

                      {module.is_required && (
                        <Badge className="mt-2 bg-red-600 text-xs">Required</Badge>
                        )}
                        </CardContent>
                        </Card>
                        </motion.div>
                        );
                        })}
              {trainingModules.length === 0 && (
                <div className="col-span-3">
                  <EmptyState
                    icon={GraduationCap}
                    iconColor="text-indigo-300"
                    title="No Training Modules Available"
                    description="Training content will appear here once added by administrators. Check back soon or contact your admin to add training materials."
                  />
                </div>
              )}
            </div>
          </TabsContent>

          {/* AI Personalized Training Path */}
          <TabsContent value="aipath">
            <div className="space-y-6">
              {currentUser && <TrainingRelevanceInsights nurseEmail={currentUser.email} />}
              {currentUser && <AIPersonalizedTrainingHub nurseEmail={currentUser.email} />}
            </div>
          </TabsContent>

          {/* Training Progress Dashboard */}
          <TabsContent value="progress">
            <div className="space-y-6">
              {currentUser && <TrainingRelevanceInsights nurseEmail={currentUser.email} />}
              {currentUser && <TrainingProgressDashboard nurseEmail={currentUser.email} />}
            </div>
          </TabsContent>

          {/* State Survey Preparation Tab */}
        <TabsContent value="survey">
          <StateSurveyVideos />
        </TabsContent>

        {/* Education Videos Tab */}
        <TabsContent value="videos">
          <EducationVideos />
        </TabsContent>

        {/* Skill Gap Remediation Tab */}
        <TabsContent value="remediation">
          <SkillGapRemediationSection
            nurseEmail={currentUser?.email}
            onComplete={() => queryClient.invalidateQueries({ queryKey: ['trainingProgress'] })}
          />
        </TabsContent>

        {/* My Plan Tab - AI-Powered Personalized Training */}
        <TabsContent value="myplan">
          {activeModule ? (
            <TargetedLessonGenerator
              module={activeModule}
              nurseEmail={currentUser?.email}
              onComplete={(result) => {
                queryClient.invalidateQueries({ queryKey: ['trainingProgress'] });
                setActiveModule(null);
              }}
              onExit={() => setActiveModule(null)}
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* AI-Generated Training Plan */}
              <AIPersonalizedTrainingPlan
                nurseEmail={currentUser?.email}
                audits={complianceAudits}
                recommendations={recommendations}
                onStartModule={(module) => {
                  setSelectedQuizTopic(module.weak_area_addressed);
                  setActiveTab('quiz');
                }}
              />
              
              {/* Feedback Aggregator */}
              <div className="space-y-4">
                <NurseFeedbackAggregator
                  nurseEmail={currentUser?.email}
                  onTrainingRecommendations={(gaps) => setSkillGaps(gaps)}
                />
                
                {/* Quick Actions based on weak areas */}
                {skillGaps.length > 0 && (
                  <Card className="border-orange-200 bg-orange-50">
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Target className="w-4 h-4 text-orange-600" />
                        Recommended Actions
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {skillGaps.slice(0, 3).map((gap, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-white rounded">
                          <span className="text-sm">{gap.area || gap.skill_area}</span>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => {
                                setSelectedQuizTopic(gap.area || gap.skill_area);
                                setActiveTab('quiz');
                              }}
                            >
                              Quiz
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => {
                                setSelectedSimScenario(gap.area?.toLowerCase().replace(/\s+/g, '_') || 'general');
                                setActiveTab('simulate');
                              }}
                            >
                              Simulate
                            </Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Learning Progress */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Award className="w-4 h-4 text-yellow-500" />
                  Your Learning Progress
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {['Documentation', 'Compliance', 'Communication', 'Safety'].map((area) => {
                  const areaProgress = trainingProgress.filter(p => 
                    p.skill_area?.toLowerCase().includes(area.toLowerCase())
                  );
                  const completed = areaProgress.filter(p => p.status === 'completed').length;
                  const progress = areaProgress.length > 0 ? (completed / Math.max(areaProgress.length, 3)) * 100 : 0;
                  
                  return (
                    <div key={area}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium text-gray-700">{area}</span>
                        <span className="text-xs text-gray-500">{Math.round(progress)}%</span>
                      </div>
                      <Progress value={progress} className="h-2" />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-500" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trainingProgress.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No training activity yet. Start with a quiz or simulation!
                  </p>
                ) : (
                  <div className="space-y-3">
                    {trainingProgress.slice(0, 5).map((activity, idx) => (
                      <div key={idx} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          activity.status === 'completed' ? 'bg-green-100' : 'bg-yellow-100'
                        }`}>
                          {activity.module_type === 'quiz' ? (
                            <HelpCircle className={`w-4 h-4 ${activity.status === 'completed' ? 'text-green-600' : 'text-yellow-600'}`} />
                          ) : (
                            <Play className={`w-4 h-4 ${activity.status === 'completed' ? 'text-green-600' : 'text-yellow-600'}`} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{activity.skill_area}</p>
                          <p className="text-xs text-gray-500">{activity.module_type} • {activity.score}%</p>
                        </div>
                        <Badge className={activity.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}>
                          {activity.status === 'completed' ? 'Passed' : 'Review'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Start */}
            <Card className="lg:col-span-2 bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Start Training</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Button 
                    variant="outline" 
                    className="h-auto py-4 flex flex-col items-center gap-2 bg-white hover:bg-blue-50"
                    onClick={() => setActiveTab('learn')}
                  >
                    <BookOpen className="w-6 h-6 text-blue-600" />
                    <span className="font-medium">Learn Best Practices</span>
                    <span className="text-xs text-gray-500">AI-generated content</span>
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    className="h-auto py-4 flex flex-col items-center gap-2 bg-white hover:bg-green-50"
                    onClick={() => setActiveTab('quiz')}
                  >
                    <HelpCircle className="w-6 h-6 text-green-600" />
                    <span className="font-medium">Take a Quiz</span>
                    <span className="text-xs text-gray-500">Test your knowledge</span>
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    className="h-auto py-4 flex flex-col items-center gap-2 bg-white hover:bg-purple-50"
                    onClick={() => setActiveTab('simulate')}
                  >
                    <Play className="w-6 h-6 text-purple-600" />
                    <span className="font-medium">Run Simulation</span>
                    <span className="text-xs text-gray-500">Practice scenarios</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Learn Tab */}
        <TabsContent value="learn">
          <AITrainingContentGenerator 
            nurseEmail={currentUser?.email}
            onContentGenerated={(content) => {}}
          />
        </TabsContent>

        {/* Quiz Tab */}
        <TabsContent value="quiz">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* AI Interactive Quiz */}
            <AIInteractiveQuiz
              topic={selectedQuizTopic || "Medicare Home Health Documentation"}
              difficulty="intermediate"
              questionCount={5}
              onComplete={(result) => {
                handleQuizCompleted({ ...result, category: selectedQuizTopic || 'General' });
                setSelectedQuizTopic(null);
              }}
            />
            
            {/* Classic Quiz Module */}
            <div>
              <h3 className="text-sm font-semibold mb-3 text-gray-700">Or choose a category:</h3>
              <InteractiveQuizModule 
                nurseEmail={currentUser?.email}
                onQuizCompleted={handleQuizCompleted}
              />
            </div>
          </div>
        </TabsContent>

        {/* Simulate Tab */}
        <TabsContent value="simulate">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* AI Patient Simulation */}
            <AIPatientSimulation
              scenario={selectedSimScenario || "general"}
              difficulty="intermediate"
              onComplete={(result) => {
                handleSimulationCompleted(result);
                setSelectedSimScenario(null);
              }}
            />
            
            {/* Classic Simulation Module */}
            <div>
              <h3 className="text-sm font-semibold mb-3 text-gray-700">Or choose a scenario:</h3>
              <ClinicalSimulationModule 
                nurseEmail={currentUser?.email}
                onSimulationCompleted={handleSimulationCompleted}
              />
            </div>
          </div>
        </TabsContent>
        </Tabs>
        </div>
    </PremiumFeatureGate>
        );
        }