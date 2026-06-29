import { lazy, Suspense, useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyTrainingCompletions } from "@/hooks/useMyTrainingCompletions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles,
  ListChecks,
  Library,
  BarChart3,
  FileText,
  Target,
  Award,
  TrendingUp,
  Clock,
  CheckCircle2,
  Loader2,
  Brain,
  Lightbulb,
  PlayCircle,
  GraduationCap
} from "lucide-react";
import InteractiveTrainingModule from "../components/training/InteractiveTrainingModule";
import PersonalizedTrainingRecommender from "../components/training/PersonalizedTrainingRecommender";
import PageContainer from "@/components/ui/PageContainer";
import EmbeddedPage from "@/components/ui/embeddedPage";
import PageHeader from "@/components/ui/PageHeader";

// Lazy spoke — the former Nurse Training (documentation skills) page is now a tab.
const NurseTraining = lazy(() => import("@/components/hub-tabs/NurseTraining"));

// Tab keys, kept in sync with the TabsTrigger values below. Used to validate the
// ?tab= deep-link so the retired Nurse Training page redirects to the right tab.
// "personalized" is the default.
const TAB_KEYS = ["personalized", "required", "library", "progress", "documentation"];

const tabLoader = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

export default function NurseTrainingHub() {
  const [_selectedModule, setSelectedModule] = useState(null);
  const [activeTraining, setActiveTraining] = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "personalized";

  // Reflect the active tab in the URL so tabs are shareable/bookmarkable and the
  // redirect from the retired Nurse Training page deep-links correctly.
  // "personalized" is the default, so it stays a clean /NurseTrainingHub.
  const handleTabChange = (value) => {
    setSearchParams(value === "personalized" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= so the
  // default tab is plain /NurseTrainingHub. Only fires when the param resolved to
  // the default tab, so a valid deep-link like ?tab=documentation is untouched.
  useEffect(() => {
    if (requestedTab !== null && activeTab === "personalized") {
      setSearchParams({}, { replace: true });
    }
  }, [requestedTab, activeTab, setSearchParams]);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: trainingModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.list(),
    initialData: []
  });

  // Live completion data (course assignments/certs) + AI micro-training progress,
  // replacing the retired per-module TrainingCompletion entity.
  const { completedCourseIds, scoreByCourse, microProgress, assignments } = useMyTrainingCompletions(currentUser?.email);

  const { data: skillGaps = [] } = useQuery({
    queryKey: ['mySkillGaps', currentUser?.email],
    queryFn: async () => {
      const response = await base44.functions.invoke('analyzeNursePerformance', {
        nurse_email: currentUser?.email,
        date_range_days: 30
      });
      const data = response.data || response;
      return data.skill_gaps || [];
    },
    enabled: !!currentUser?.email,
    initialData: []
  });

  const generateTrainingMutation = useMutation({
    mutationFn: async (skillGap) => {
      const response = await base44.functions.invoke('generatePersonalizedTraining', {
        skill_gap: skillGap
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      setActiveTraining(data);
    }
  });

  // AI-generated personalized training completions are recorded as
  // MicroLearningProgress (the live entity for AI micro-learning) rather than the
  // retired TrainingCompletion. Real catalog courses go through the course
  // player + grading pipeline via startTrainingMutation instead.
  const completeModuleMutation = useMutation({
    mutationFn: async ({ score, _timeSpent }) => {
      return await base44.entities.MicroLearningProgress.create({
        nurse_email: currentUser.email,
        skill_area: activeTraining?.title || activeTraining?.skill_gap || 'Personalized training',
        module_type: 'micro_lesson',
        status: 'completed',
        score,
        attempts: 1,
        source: 'ai_recommendation',
        content: activeTraining || {},
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-micro-progress', currentUser?.email] });
      setActiveTraining(null);
      setSelectedModule(null);
    }
  });

  // Launch a module's course as a completable assignment. Reuses an existing
  // assignment for this nurse+course if one exists (so we don't pile up
  // duplicates), otherwise self-enrolls, then opens the player in the real
  // (non-preview) flow where attempts can be submitted, scored and completed.
  const startTrainingMutation = useMutation({
    mutationFn: async (module) => {
      const email = currentUser?.email;
      if (!email || !module?.course_id) {
        throw new Error('Missing user or course information');
      }
      const existing = await base44.entities.TrainingAssignment.filter(
        { assigned_to_user_id: email, course_id: module.course_id },
        '-assigned_date',
        1
      );
      if (existing && existing[0]) return existing[0];
      return base44.entities.TrainingAssignment.create({
        course_id: module.course_id,
        course_title: module.title,
        assigned_to_user_id: email,
        assigned_by: email,
        assigned_date: new Date().toISOString(),
        status: 'assigned',
        required: !!module.is_required,
        priority: module.is_required ? 'high' : 'medium',
      });
    },
    onSuccess: (assignment) => {
      navigate(`${createPageUrl('TrainingCoursePlayer')}?assignment=${assignment.id}`);
    },
    onError: (error) => {
      toast.error(error?.message || 'Could not start training. Please try again.');
    }
  });

  // A module is complete when its linked course has a passing assignment/cert.
  const courseIdByModuleId = Object.fromEntries(trainingModules.map(m => [m.id, m.course_id]));
  const getCompletionStatus = (moduleId) =>
    completedCourseIds.has(courseIdByModuleId[moduleId]) ? 'completed' : 'not_started';
  const getCompletionScore = (moduleId) => scoreByCourse[courseIdByModuleId[moduleId]] || 0;

  const requiredModules = trainingModules.filter(m => m.is_required);
  const recommendedModules = trainingModules.filter(m => !m.is_required);

  const completedModulesCount = trainingModules.filter(m => m.course_id && completedCourseIds.has(m.course_id)).length;
  const inProgressCount = assignments.filter(a => a.status === 'in_progress').length;

  // Unified completion history: completed course assignments + AI micro-training.
  const completionHistory = [
    ...assignments
      .filter(a => a.status === 'completed' || a.pass_fail_result === 'passed')
      .map(a => ({ id: a.id, title: a.course_title, status: 'completed', score: a.score_percentage, completion_date: a.completion_date })),
    ...microProgress.map(p => ({ id: p.id, title: p.skill_area || 'AI-Generated Training', status: p.status, score: p.score, completion_date: p.updated_date || p.created_date })),
  ];

  const completionRate = trainingModules.length > 0
    ? Math.round((completedModulesCount / trainingModules.length) * 100)
    : 0;

  if (activeTraining) {
    return (
      <InteractiveTrainingModule
        trainingData={activeTraining}
        onComplete={(score, timeSpent) => {
          completeModuleMutation.mutate({
            moduleId: 'ai_generated',
            score,
            timeSpent
          });
        }}
        onExit={() => setActiveTraining(null)}
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={GraduationCap}
        eyebrow="Training"
        title="Nurse Training Hub"
        description="AI-powered personalized training and skill development"
        favoritePage="NurseTrainingHub"
      />

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Completion Rate</p>
                <p className="text-3xl font-bold text-blue-600">{completionRate}%</p>
              </div>
              <Award className="w-8 h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Completed</p>
                <p className="text-3xl font-bold text-emerald-600">
                  {completedModulesCount}
                </p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">In Progress</p>
                <p className="text-3xl font-bold text-orange-600">
                  {inProgressCount}
                </p>
              </div>
              <Clock className="w-8 h-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Skill Gaps</p>
                <p className="text-3xl font-bold text-red-600">{skillGaps.length}</p>
              </div>
              <Target className="w-8 h-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      <EmbeddedPage>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="personalized" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Sparkles className="w-4 h-4 mr-2" />
              AI Personalized
            </TabsTrigger>
            <TabsTrigger value="required" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <ListChecks className="w-4 h-4 mr-2" />
              Required
            </TabsTrigger>
            <TabsTrigger value="library" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Library className="w-4 h-4 mr-2" />
              Library
            </TabsTrigger>
            <TabsTrigger value="progress" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BarChart3 className="w-4 h-4 mr-2" />
              My Progress
            </TabsTrigger>
            <TabsTrigger value="documentation" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <FileText className="w-4 h-4 mr-2" />
              Documentation Training
            </TabsTrigger>
          </TabsList>
        </div>

        {/* AI Personalized Training */}
        <TabsContent value="personalized" className="space-y-6">
          <PersonalizedTrainingRecommender
            skillGaps={skillGaps}
            onStartTraining={(gap) => generateTrainingMutation.mutate(gap)}
            isGenerating={generateTrainingMutation.isPending}
          />

          {/* AI-Generated Training Section */}
          {skillGaps.length > 0 && (
            <Card>
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-navy-600" />
                  Generate Custom Training
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <p className="text-slate-700 mb-4">
                  Select a skill gap to generate personalized AI training content with lessons, scenarios, and quizzes.
                </p>
                <div className="space-y-2">
                  {skillGaps.map((gap, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 bg-navy-50 rounded-lg border border-navy-200">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{gap.skill}</p>
                        <p className="text-sm text-slate-600">{gap.recommendation}</p>
                        <Badge variant="destructive" className="mt-2">{gap.gap_severity} priority</Badge>
                      </div>
                      <Button
                        onClick={() => generateTrainingMutation.mutate(gap.skill)}
                        disabled={generateTrainingMutation.isPending}
                        className="bg-navy-600 hover:bg-navy-700"
                      >
                        {generateTrainingMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <Lightbulb className="w-4 h-4 mr-2" />
                            Generate Training
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Required Training */}
        <TabsContent value="required">
          <div className="grid md:grid-cols-2 gap-4">
            {requiredModules.map(module => (
              <Card key={module.id} className="border-red-200">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="text-base">{module.title}</span>
                    <Badge variant="destructive">Required</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-slate-600">{module.description}</p>
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {module.duration_minutes} min
                    </div>
                    <Badge variant="outline">{module.category}</Badge>
                  </div>
                  {getCompletionStatus(module.id) === 'completed' ? (
                    <div className="flex items-center gap-2 text-emerald-600">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        Completed - Score: {getCompletionScore(module.id)}%
                      </span>
                    </div>
                  ) : (
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      onClick={() => startTrainingMutation.mutate(module)}
                      disabled={startTrainingMutation.isPending}
                    >
                      <PlayCircle className="w-4 h-4 mr-2" />
                      Start Training
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Training Library */}
        <TabsContent value="library">
          <div className="grid md:grid-cols-2 gap-4">
            {recommendedModules.map(module => (
              <Card key={module.id}>
                <CardHeader>
                  <CardTitle className="text-base">{module.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-slate-600">{module.description}</p>
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {module.duration_minutes} min
                    </div>
                    <Badge variant="outline">{module.category}</Badge>
                    <Badge variant="outline">{module.difficulty_level}</Badge>
                  </div>
                  {getCompletionStatus(module.id) === 'completed' ? (
                    <div className="flex items-center gap-2 text-emerald-600">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        Completed - Score: {getCompletionScore(module.id)}%
                      </span>
                    </div>
                  ) : (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => startTrainingMutation.mutate(module)}
                      disabled={startTrainingMutation.isPending}
                    >
                      <PlayCircle className="w-4 h-4 mr-2" />
                      Start Training
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* My Progress */}
        <TabsContent value="progress">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Training Progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Overall Completion</span>
                  <span className="text-sm font-semibold">{completionRate}%</span>
                </div>
                <Progress value={completionRate} className="h-3" />
              </div>

              <ScrollArea className="h-96">
                <div className="space-y-3">
                  {completionHistory.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-8">No completed training yet.</p>
                  )}
                  {completionHistory.map(completion => {
                    return (
                      <div key={completion.id} className="p-4 border rounded-lg">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold text-slate-900">
                              {completion.title || 'AI-Generated Training'}
                            </h4>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge className={
                                completion.status === 'completed' ? 'bg-emerald-500' :
                                completion.status === 'in_progress' ? 'bg-orange-500' :
                                'bg-slate-500'
                              }>
                                {completion.status}
                              </Badge>
                              {completion.score && (
                                <span className="text-sm text-slate-600">Score: {completion.score}%</span>
                              )}
                            </div>
                            {completion.completion_date && (
                              <p className="text-xs text-slate-500 mt-1">
                                Completed: {new Date(completion.completion_date).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documentation Training — the former Nurse Training page (practice
            scenarios, compliance quizzes, onboarding/ongoing learning paths). */}
        <TabsContent value="documentation">
          <Suspense fallback={tabLoader}>
            <NurseTraining />
          </Suspense>
        </TabsContent>
      </Tabs>
      </EmbeddedPage>
    </PageContainer>
  );
}