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
  Sparkles
} from "lucide-react";
import PersonalizedLearningPathPlanner from "../components/training/PersonalizedLearningPathPlanner";
import BadgeDisplay from "../components/training/BadgeDisplay";
import TrainingProgressDashboard from "../components/training/TrainingProgressDashboard";

const ALL_MODULES = {
  RN: [
    { id: "smart-notes-101", title: "Smart Notes 101", description: "Learn to leverage AI for faster, more compliant documentation", category: "Smart Notes", duration: 15, difficulty: "Beginner" },
    { id: "ai-scribe-mastery", title: "AI Scribe Mastery", description: "Master voice dictation and AI-powered note generation", category: "AI Features", duration: 20, difficulty: "Intermediate" },
    { id: "care-plan-optimization", title: "Care Plan Optimization", description: "Use AI to create better, more effective care plans", category: "Care Planning", duration: 25, difficulty: "Intermediate" },
    { id: "oasis-compliance-pro", title: "OASIS Compliance Pro", description: "Ensure perfect Medicare compliance with AI assistance", category: "Compliance", duration: 30, difficulty: "Advanced" }
  ],
  LPN: [
    { id: "smart-notes-101", title: "Smart Notes 101", description: "Learn to leverage AI for faster, more compliant documentation", category: "Smart Notes", duration: 15, difficulty: "Beginner" },
    { id: "ai-scribe-mastery", title: "AI Scribe Mastery", description: "Master voice dictation and AI-powered note generation", category: "AI Features", duration: 20, difficulty: "Intermediate" },
    { id: "documentation-best-practices", title: "Documentation Best Practices", description: "Essential documentation skills for LPN providers", category: "Documentation", duration: 20, difficulty: "Beginner" }
  ],
  PT: [
    { id: "smart-notes-101", title: "Smart Notes 101", description: "Learn to leverage AI for faster, more compliant documentation", category: "Smart Notes", duration: 15, difficulty: "Beginner" },
    { id: "care-plan-optimization", title: "Care Plan Optimization", description: "Use AI to create better, more effective care plans", category: "Care Planning", duration: 25, difficulty: "Intermediate" },
    { id: "telehealth-guidance", title: "Telehealth Best Practices", description: "Conduct effective virtual therapy sessions", category: "Telehealth", duration: 20, difficulty: "Beginner" }
  ],
  OT: [
    { id: "smart-notes-101", title: "Smart Notes 101", description: "Learn to leverage AI for faster, more compliant documentation", category: "Smart Notes", duration: 15, difficulty: "Beginner" },
    { id: "care-plan-optimization", title: "Care Plan Optimization", description: "Use AI to create better, more effective care plans", category: "Care Planning", duration: 25, difficulty: "Intermediate" },
    { id: "telehealth-guidance", title: "Telehealth Best Practices", description: "Conduct effective virtual therapy sessions", category: "Telehealth", duration: 20, difficulty: "Beginner" }
  ],
  MD: [
    { id: "smart-notes-101", title: "Smart Notes 101", description: "Learn to leverage AI for faster, more compliant documentation", category: "Smart Notes", duration: 15, difficulty: "Beginner" },
    { id: "ai-scribe-mastery", title: "AI Scribe Mastery", description: "Master voice dictation and AI-powered note generation", category: "AI Features", duration: 20, difficulty: "Intermediate" },
    { id: "care-plan-optimization", title: "Care Plan Optimization", description: "Use AI to create better, more effective care plans", category: "Care Planning", duration: 25, difficulty: "Intermediate" }
  ]
};

export default function ProviderTrainingHub() {
  const [selectedModule, setSelectedModule] = useState(null);

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

  const completedModuleIds = completions.map(c => c.training_module_id);
  const earnedCerts = certifications.filter(c => c.status === 'earned');
  const inProgressCerts = certifications.filter(c => c.status === 'in_progress');

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto pb-20 sm:pb-6 w-full max-w-full overflow-x-hidden min-w-0">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 sm:gap-4 mb-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-lg flex-shrink-0">
            <GraduationCap className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 truncate">Provider Training Hub</h1>
            <p className="text-xs sm:text-sm text-gray-600 truncate">Master advanced features and earn certifications</p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{completions.length}</p>
              <p className="text-sm text-gray-600 mt-1">Modules Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{badges.length}</p>
              <p className="text-sm text-gray-600 mt-1">Badges Earned</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">{earnedCerts.length}</p>
              <p className="text-sm text-gray-600 mt-1">Certifications</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{inProgressCerts.length}</p>
              <p className="text-sm text-gray-600 mt-1">In Progress</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs defaultValue="learning-path" className="space-y-4 sm:space-y-6">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto p-1">
          <TabsTrigger value="learning-path">Learning Path</TabsTrigger>
          <TabsTrigger value="modules">Modules</TabsTrigger>
          <TabsTrigger value="badges">Badges</TabsTrigger>
          <TabsTrigger value="progress">Progress</TabsTrigger>
        </TabsList>

        {/* Learning Path Tab */}
        <TabsContent value="learning-path" className="space-y-4">
          {currentUser && (
            <PersonalizedLearningPathPlanner 
              providerEmail={currentUser.email}
              providerType={currentUser.provider_type}
            />
          )}
        </TabsContent>

        {/* Modules Tab */}
        <TabsContent value="modules" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {((currentUser && ALL_MODULES[currentUser.provider_type]) || ALL_MODULES.RN).map((module) => {
              const isCompleted = completedModuleIds.includes(module.id);
              
              return (
                <Card key={module.id} className={isCompleted ? "border-green-300 bg-green-50" : ""}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <CardTitle className="text-lg">{module.title}</CardTitle>
                        <Badge className="mt-2 bg-blue-100 text-blue-800">
                          {module.category}
                        </Badge>
                      </div>
                      {isCompleted && (
                        <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                      )}
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
                      variant={isCompleted ? "outline" : "default"}
                    >
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
            certifications={certifications}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}