import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, GraduationCap, TrendingUp, Award, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

import ComplianceErrorAnalyzer from "../components/training/ComplianceErrorAnalyzer";
import PersonalizedComplianceTraining from "../components/training/PersonalizedComplianceTraining";
import ComplianceQuizSimulator from "../components/training/ComplianceQuizSimulator";

export default function ComplianceTraining() {
  const [selectedErrorPatterns, setSelectedErrorPatterns] = useState(null);
  const [trainingContent, setTrainingContent] = useState(null);
  const [activeTab, setActiveTab] = useState("analysis");

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: trainingProgress = [] } = useQuery({
    queryKey: ['complianceTrainingProgress', currentUser?.email],
    queryFn: () => base44.entities.ComplianceTrainingProgress.filter({ user_email: currentUser.email }),
    enabled: !!currentUser?.email
  });

  const completedModules = trainingProgress.filter(p => p.status === 'completed' || p.status === 'mastered');
  const avgScore = trainingProgress.length > 0
    ? Math.round(trainingProgress.reduce((sum, p) => sum + (p.quiz_score || 0), 0) / trainingProgress.length)
    : 0;

  const handleGenerateTraining = (patterns) => {
    setSelectedErrorPatterns(patterns);
    setActiveTab("training");
  };

  const handleTrainingGenerated = (data) => {
    setTrainingContent(data.training_module);
    setActiveTab("quiz");
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <GraduationCap className="w-8 h-8 text-purple-600" />
          Compliance Training Center
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          AI-powered personalized compliance training based on your performance
        </p>
      </div>

      {/* Progress Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-4">
            <Award className="w-8 h-8 text-purple-600 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{completedModules.length}</p>
            <p className="text-xs text-gray-600">Modules Completed</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <TrendingUp className="w-8 h-8 text-blue-600 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{avgScore}%</p>
            <p className="text-xs text-gray-600">Average Quiz Score</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-4">
            <Brain className="w-8 h-8 text-green-600 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{trainingProgress.length}</p>
            <p className="text-xs text-gray-600">Total Training Sessions</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="analysis">Error Analysis</TabsTrigger>
          <TabsTrigger value="training" disabled={!selectedErrorPatterns}>Training Content</TabsTrigger>
          <TabsTrigger value="quiz" disabled={!trainingContent}>Quiz</TabsTrigger>
        </TabsList>

        <TabsContent value="analysis" className="space-y-4 mt-6">
          <ComplianceErrorAnalyzer
            userEmail={currentUser?.email}
            onGenerateTraining={handleGenerateTraining}
          />

          {/* Training History */}
          {trainingProgress.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-blue-600" />
                  Your Training History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {trainingProgress.map((progress, idx) => (
                    <div key={idx} className="p-3 bg-gray-50 rounded-lg border flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{progress.module_title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge className={
                            progress.status === 'completed' ? 'bg-green-600' :
                            progress.status === 'mastered' ? 'bg-purple-600' :
                            progress.status === 'in_progress' ? 'bg-blue-600' :
                            'bg-gray-600'
                          }>
                            {progress.status}
                          </Badge>
                          {progress.quiz_score && (
                            <span className="text-xs text-gray-600">Score: {progress.quiz_score}%</span>
                          )}
                        </div>
                      </div>
                      {progress.completion_date && (
                        <Badge variant="outline" className="text-xs">
                          {new Date(progress.completion_date).toLocaleDateString()}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="training" className="mt-6">
          {selectedErrorPatterns && (
            <PersonalizedComplianceTraining
              errorPatterns={selectedErrorPatterns}
              userEmail={currentUser?.email}
              onTrainingGenerated={handleTrainingGenerated}
            />
          )}
        </TabsContent>

        <TabsContent value="quiz" className="mt-6">
          {trainingContent?.quiz_questions && (
            <ComplianceQuizSimulator
              quizQuestions={trainingContent.quiz_questions}
              moduleId={trainingContent.module_id}
              moduleTitle={trainingContent.module_title}
              userEmail={currentUser?.email}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Quick Links */}
      <Card className="mt-6 border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <p className="text-sm font-semibold text-blue-900 mb-3">Related Resources</p>
          <div className="flex flex-wrap gap-2">
            <Link to={createPageUrl("ComplianceDashboard")}>
              <Button size="sm" variant="outline">
                View Compliance Dashboard
              </Button>
            </Link>
            <Link to={createPageUrl("MyTraining")}>
              <Button size="sm" variant="outline">
                All Training Modules
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}