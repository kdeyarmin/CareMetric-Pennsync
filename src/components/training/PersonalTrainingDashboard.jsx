import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Play, 
  BookOpen,
  Award,
  TrendingUp,
  Calendar,
  Star
} from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { toast } from 'sonner';
import InteractiveTrainingViewer from './InteractiveTrainingViewer';

export default function PersonalTrainingDashboard({ userEmail, completions, trainingModules }) {
  const [selectedTraining, setSelectedTraining] = useState(null);
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TrainingCompletion.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['myCompletions', userEmail]);
      toast.success('Training progress updated');
    }
  });

  const getModule = (moduleId) => trainingModules.find(m => m.id === moduleId);

  // Categorize training
  const categorizedTraining = useMemo(() => {
    const assigned = completions.filter(c => c.status === 'assigned');
    const inProgress = completions.filter(c => c.status === 'in_progress');
    const completed = completions.filter(c => c.status === 'completed');
    const overdue = completions.filter(c => 
      c.status !== 'completed' && 
      c.due_date && 
      new Date(c.due_date) < new Date()
    );

    // Required training
    const required = [...assigned, ...inProgress].filter(c => {
      const module = getModule(c.training_module_id);
      return module?.is_required;
    });

    return { assigned, inProgress, completed, overdue, required };
  }, [completions, trainingModules]);

  // Stats
  const stats = useMemo(() => {
    const total = completions.length;
    const completedCount = categorizedTraining.completed.length;
    const completionRate = total > 0 ? Math.round((completedCount / total) * 100) : 0;
    
    const avgScore = categorizedTraining.completed.length > 0
      ? Math.round(
          categorizedTraining.completed.reduce((sum, c) => sum + (c.score || 0), 0) / 
          categorizedTraining.completed.length
        )
      : 0;

    const totalMinutes = categorizedTraining.completed.reduce((sum, c) => {
      const module = getModule(c.training_module_id);
      return sum + (module?.duration_minutes || 0);
    }, 0);

    return { total, completedCount, completionRate, avgScore, totalMinutes };
  }, [completions, categorizedTraining]);

  const startTraining = (completion) => {
    updateMutation.mutate({ id: completion.id, data: { status: 'in_progress' } });
  };

  const completeTraining = (completion) => {
    updateMutation.mutate({ 
      id: completion.id, 
      data: { 
        status: 'completed', 
        completion_date: format(new Date(), 'yyyy-MM-dd'),
        score: Math.floor(Math.random() * 20) + 80 // Simulated score
      } 
    });
  };

  if (selectedTraining) {
    const module = getModule(selectedTraining.training_module_id);
    if (!module) return null;

    return (
      <div className="space-y-4">
        <Button 
          variant="outline" 
          onClick={() => setSelectedTraining(null)}
        >
          ← Back to Dashboard
        </Button>
        <InteractiveTrainingViewer 
          module={module}
          completion={selectedTraining}
          onComplete={() => {
            completeTraining(selectedTraining);
            setSelectedTraining(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-blue-600 dark:text-blue-400">Completion Rate</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{stats.completionRate}%</p>
              </div>
              <div className="w-10 h-10 bg-blue-200 dark:bg-blue-800 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-300" />
              </div>
            </div>
            <Progress value={stats.completionRate} className="h-1 mt-2" />
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-green-600 dark:text-green-400">Avg Score</p>
                <p className="text-2xl font-bold text-green-700 dark:text-green-300">{stats.avgScore}%</p>
              </div>
              <div className="w-10 h-10 bg-green-200 dark:bg-green-800 rounded-lg flex items-center justify-center">
                <Award className="w-5 h-5 text-green-600 dark:text-green-300" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-purple-600 dark:text-purple-400">Hours Learned</p>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">
                  {Math.round(stats.totalMinutes / 60)}h
                </p>
              </div>
              <div className="w-10 h-10 bg-purple-200 dark:bg-purple-800 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-purple-600 dark:text-purple-300" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900 border-amber-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-amber-600 dark:text-amber-400">Completed</p>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{stats.completedCount}</p>
              </div>
              <div className="w-10 h-10 bg-amber-200 dark:bg-amber-800 rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-amber-600 dark:text-amber-300" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Overdue Alert */}
      {categorizedTraining.overdue.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600" />
            <div className="flex-1">
              <p className="font-semibold text-red-800 dark:text-red-200">
                You have {categorizedTraining.overdue.length} overdue training{categorizedTraining.overdue.length > 1 ? 's' : ''}
              </p>
              <p className="text-sm text-red-600 dark:text-red-400">Please complete them as soon as possible</p>
            </div>
            <Button 
              size="sm" 
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                const firstOverdue = categorizedTraining.overdue[0];
                if (firstOverdue) setSelectedTraining(firstOverdue);
              }}
            >
              Start Now
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Training Tabs */}
      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending" className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Pending ({categorizedTraining.assigned.length + categorizedTraining.inProgress.length})
          </TabsTrigger>
          <TabsTrigger value="completed" className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Completed ({categorizedTraining.completed.length})
          </TabsTrigger>
        </TabsList>

        {/* Pending Tab */}
        <TabsContent value="pending" className="space-y-4">
          {[...categorizedTraining.inProgress, ...categorizedTraining.assigned].length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <h3 className="font-semibold text-lg mb-2">All Caught Up!</h3>
                <p className="text-slate-600 dark:text-slate-400">
                  You have no pending training assignments.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {[...categorizedTraining.inProgress, ...categorizedTraining.assigned].map((training) => {
                const module = getModule(training.training_module_id);
                if (!module) return null;

                const isOverdue = training.due_date && new Date(training.due_date) < new Date();
                const daysLeft = training.due_date 
                  ? differenceInDays(parseISO(training.due_date), new Date())
                  : null;

                return (
                  <Card 
                    key={training.id} 
                    className={`transition-all hover:shadow-md ${
                      isOverdue ? 'border-red-300 bg-red-50/50 dark:bg-red-950/30' : ''
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                              {module.title}
                            </h4>
                            {module.is_required && (
                              <Badge className="bg-red-100 text-red-800 text-xs">Required</Badge>
                            )}
                            {training.status === 'in_progress' && (
                              <Badge className="bg-blue-100 text-blue-800 text-xs">In Progress</Badge>
                            )}
                            {isOverdue && (
                              <Badge className="bg-red-100 text-red-800 text-xs">Overdue</Badge>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-1">
                            {module.description}
                          </p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {module.duration_minutes || 15} min
                            </span>
                            <span className="flex items-center gap-1">
                              <BookOpen className="w-3 h-3" />
                              {module.category}
                            </span>
                            {training.due_date && (
                              <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
                                <Calendar className="w-3 h-3" />
                                {isOverdue ? `${Math.abs(daysLeft)} days overdue` : 
                                 daysLeft === 0 ? 'Due today' :
                                 daysLeft === 1 ? 'Due tomorrow' :
                                 `Due in ${daysLeft} days`}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          {training.status === 'assigned' ? (
                            <Button 
                              onClick={() => {
                                startTraining(training);
                                setSelectedTraining(training);
                              }}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Start
                            </Button>
                          ) : (
                            <Button 
                              onClick={() => setSelectedTraining(training)}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Continue
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Completed Tab */}
        <TabsContent value="completed" className="space-y-4">
          {categorizedTraining.completed.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="font-semibold text-lg mb-2">No Completed Training Yet</h3>
                <p className="text-slate-600 dark:text-slate-400">
                  Start your learning journey by completing your first module.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {categorizedTraining.completed.map((training) => {
                const module = getModule(training.training_module_id);
                if (!module) return null;

                return (
                  <Card key={training.id} className="bg-green-50/50 dark:bg-green-950/30 border-green-200">
                    <CardContent className="p-4">
                      <div className="flex flex-col md:flex-row md:items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                            <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                              {module.title}
                            </h4>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-slate-500">
                            <span>
                              Completed: {training.completion_date ? format(parseISO(training.completion_date), 'MMM d, yyyy') : 'N/A'}
                            </span>
                            {training.score && (
                              <span className="flex items-center gap-1 text-green-600 font-medium">
                                <Star className="w-4 h-4" />
                                Score: {training.score}%
                              </span>
                            )}
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setSelectedTraining(training)}>
                          Review
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}