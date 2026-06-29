import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Brain,
  BookOpen,
  Award,
  Clock,
  Play,
  CheckCircle2,
  TrendingUp,
  Zap,
  RotateCcw,
  FileText
} from "lucide-react";
import { format, parseISO } from "date-fns";
import MicroLearningModule from "./MicroLearningModule";

export default function SkillGapLearningHub({ nurseEmail }) {
  const queryClient = useQueryClient();
  const [activeSkillGap, setActiveSkillGap] = useState(null);
  const [showModule, setShowModule] = useState(false);

  const { data: progressRecords = [] } = useQuery({
    queryKey: ['microLearningProgress', nurseEmail],
    queryFn: () => base44.entities.MicroLearningProgress.filter({ nurse_email: nurseEmail }, '-created_date'),
    enabled: !!nurseEmail
  });

  // Get stored skill gaps from localStorage (set by NoteReviewEngine)
  const [storedGaps, setStoredGaps] = useState(() => {
    try {
      const stored = localStorage.getItem(`skill_gaps_${nurseEmail}`);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const completedModules = progressRecords.filter(p => p.status === 'completed');
  const inProgressModules = progressRecords.filter(p => p.status === 'in_progress');
  const needsReviewModules = progressRecords.filter(p => p.status === 'needs_review');

  const totalTimeSpent = progressRecords.reduce((acc, p) => acc + (p.time_spent_minutes || 0), 0);
  const averageScore = completedModules.length > 0 
    ? Math.round(completedModules.reduce((acc, p) => acc + (p.score || 0), 0) / completedModules.length)
    : 0;

  const handleStartLearning = (gap) => {
    setActiveSkillGap(gap);
    setShowModule(true);
  };

  const handleModuleComplete = (result) => {
    setShowModule(false);
    setActiveSkillGap(null);
    queryClient.invalidateQueries({ queryKey: ['microLearningProgress'] });
    
    // Update stored gaps
    const updatedGaps = storedGaps.filter(g => g.area !== result.skill_area);
    setStoredGaps(updatedGaps);
    try { localStorage.setItem(`skill_gaps_${nurseEmail}`, JSON.stringify(updatedGaps)); } catch {}
  };

  const _getStatusColor = (status) => {
    const colors = {
      completed: 'bg-green-100 text-green-800',
      in_progress: 'bg-blue-100 text-blue-800',
      needs_review: 'bg-yellow-100 text-yellow-800',
      not_started: 'bg-slate-100 text-slate-800'
    };
    return colors[status] || 'bg-slate-100 text-slate-800';
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-navy-100 rounded-full flex items-center justify-center">
              <Brain className="w-5 h-5 text-navy-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{storedGaps.length}</p>
              <p className="text-sm text-slate-500">Active Gaps</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{completedModules.length}</p>
              <p className="text-sm text-slate-500">Completed</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalTimeSpent}</p>
              <p className="text-sm text-slate-500">Minutes Learned</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
              <Award className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{averageScore}%</p>
              <p className="text-sm text-slate-500">Avg Score</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="gaps" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="gaps" className="gap-2">
            <Zap className="w-4 h-4" />
            Skill Gaps ({storedGaps.length})
          </TabsTrigger>
          <TabsTrigger value="progress" className="gap-2">
            <TrendingUp className="w-4 h-4" />
            In Progress ({inProgressModules.length})
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Completed ({completedModules.length})
          </TabsTrigger>
        </TabsList>

        {/* Active Skill Gaps */}
        <TabsContent value="gaps" className="mt-4">
          {storedGaps.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-300 mx-auto mb-3" />
                <h4 className="font-semibold text-slate-700 mb-1">No Active Skill Gaps!</h4>
                <p className="text-slate-500 text-sm">
                  Skill gaps are identified when you use the AI Note Review feature.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {storedGaps.map((gap, idx) => (
                <Card key={idx} className="border-navy-200 hover:border-navy-400 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Brain className="w-4 h-4 text-navy-600" />
                          <h4 className="font-semibold text-slate-900">{gap.area}</h4>
                        </div>
                        <p className="text-sm text-slate-600 mb-2">{gap.evidence}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            <BookOpen className="w-3 h-3 mr-1" />
                            {gap.recommended_training}
                          </Badge>
                        </div>
                      </div>
                      <Button 
                        onClick={() => handleStartLearning(gap)}
                        className="bg-navy-600 hover:bg-navy-700"
                      >
                        <Play className="w-4 h-4 mr-2" /> Start Learning
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* In Progress */}
        <TabsContent value="progress" className="mt-4">
          {inProgressModules.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <BookOpen className="w-12 h-12 text-blue-300 mx-auto mb-3" />
                <h4 className="font-semibold text-slate-700 mb-1">No Modules In Progress</h4>
                <p className="text-slate-500 text-sm">Start a micro-learning module from your skill gaps.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {inProgressModules.map((module, idx) => (
                <Card key={idx} className="border-blue-200">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold text-slate-900">{module.skill_area}</h4>
                        <p className="text-sm text-slate-500">
                          Started: {module.created_date ? format(parseISO(module.created_date), 'MMM d, yyyy') : 'Unknown'}
                        </p>
                      </div>
                      <Button 
                        variant="outline"
                        onClick={() => handleStartLearning({ area: module.skill_area, evidence: '', recommended_training: module.skill_area })}
                      >
                        <RotateCcw className="w-4 h-4 mr-2" /> Continue
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Completed */}
        <TabsContent value="completed" className="mt-4">
          {completedModules.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Award className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h4 className="font-semibold text-slate-700 mb-1">No Completed Modules Yet</h4>
                <p className="text-slate-500 text-sm">Complete micro-learning modules to build your skills.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {completedModules.map((module, idx) => (
                <Card key={idx} className="border-green-200 bg-green-50">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-6 h-6 text-green-600" />
                        <div>
                          <h4 className="font-semibold text-slate-900">{module.skill_area}</h4>
                          <div className="flex items-center gap-3 text-sm text-slate-500">
                            <span>Score: {module.score}%</span>
                            <span>Time: {module.time_spent_minutes} min</span>
                            {module.updated_date && (
                              <span>Completed: {format(parseISO(module.updated_date), 'MMM d')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <Badge className="bg-green-100 text-green-800">
                        <Award className="w-3 h-3 mr-1" /> Completed
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Needs Review Section */}
      {needsReviewModules.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-yellow-600" />
              Needs Review ({needsReviewModules.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-yellow-800 mb-3">
              These modules scored below 70% and may need another attempt.
            </p>
            <div className="space-y-2">
              {needsReviewModules.map((module, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 bg-white rounded border border-yellow-200">
                  <span className="text-sm font-medium">{module.skill_area}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{module.score}%</Badge>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleStartLearning({ area: module.skill_area, evidence: '', recommended_training: module.skill_area })}
                    >
                      Retry
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Micro Learning Module Dialog */}
      {showModule && activeSkillGap && (
        <MicroLearningModule
          skillGap={activeSkillGap}
          nurseEmail={nurseEmail}
          onComplete={handleModuleComplete}
          onClose={() => {
            setShowModule(false);
            setActiveSkillGap(null);
          }}
        />
      )}
    </div>
  );
}