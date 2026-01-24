import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GraduationCap, Clock, CheckCircle, AlertCircle, PlayCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import InteractiveTrainingViewer from "../components/training/InteractiveTrainingViewer";

export default function MyTraining() {
  const [selectedTraining, setSelectedTraining] = useState(null);

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

  const { data: myTraining = [], isLoading } = useQuery({
    queryKey: ['myTraining', currentUser?.email],
    queryFn: () => base44.entities.TrainingCompletion.filter({ nurse_email: currentUser.email }),
    enabled: !!currentUser?.email
  });

  const { data: allModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.list()
  });

  if (userLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (selectedTraining) {
    const module = allModules.find(m => m.id === selectedTraining.training_module_id);
    if (!module) return null;

    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Button 
          variant="outline" 
          onClick={() => setSelectedTraining(null)}
          className="mb-4"
        >
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

  const assigned = myTraining.filter(t => t.status === 'assigned');
  const inProgress = myTraining.filter(t => t.status === 'in_progress');
  const completed = myTraining.filter(t => t.status === 'completed');
  const overdue = myTraining.filter(t => 
    t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date()
  );

  const completionRate = myTraining.length > 0 
    ? Math.round((completed.length / myTraining.length) * 100) 
    : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
          <GraduationCap className="w-8 h-8 text-blue-600" />
          My Training
        </h1>
        <p className="text-slate-600 mt-1">
          Complete assigned training to improve your skills
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-slate-500">Completion Rate</p>
              <p className="text-3xl font-bold text-blue-600">{completionRate}%</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-slate-500">Assigned</p>
              <p className="text-3xl font-bold text-slate-900">{assigned.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-slate-500">Completed</p>
              <p className="text-3xl font-bold text-green-600">{completed.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-slate-500">Overdue</p>
              <p className="text-3xl font-bold text-red-600">{overdue.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Training Tabs */}
      <Tabs defaultValue="assigned">
        <TabsList>
          <TabsTrigger value="assigned">
            Assigned ({assigned.length + inProgress.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({completed.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assigned" className="space-y-4 mt-4">
          {[...assigned, ...inProgress].map(training => {
            const module = allModules.find(m => m.id === training.training_module_id);
            if (!module) return null;

            const isOverdue = training.due_date && new Date(training.due_date) < new Date();

            return (
              <Card key={training.id} className={isOverdue ? "border-red-200" : ""}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <CardTitle className="text-lg">{module.title}</CardTitle>
                        {training.status === 'in_progress' && (
                          <Badge className="bg-blue-100 text-blue-800">In Progress</Badge>
                        )}
                        {isOverdue && (
                          <Badge className="bg-red-100 text-red-800">Overdue</Badge>
                        )}
                      </div>
                      <CardDescription>{module.description}</CardDescription>
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {module.duration_minutes} min
                        </span>
                        {training.due_date && (
                          <span className={isOverdue ? "text-red-600 font-medium" : ""}>
                            Due: {format(new Date(training.due_date), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button 
                      onClick={() => setSelectedTraining(training)}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
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
                <p className="text-slate-600">All caught up! No pending training.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-4 mt-4">
          {completed.map(training => {
            const module = allModules.find(m => m.id === training.training_module_id);
            if (!module) return null;

            return (
              <Card key={training.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <CardTitle className="text-lg">{module.title}</CardTitle>
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Completed
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span>
                          Completed: {format(new Date(training.completion_date), 'MMM d, yyyy')}
                        </span>
                        {training.score && (
                          <span className="font-medium text-green-600">
                            Score: {training.score}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            );
          })}

          {completed.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                <p className="text-slate-600">No completed training yet.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}