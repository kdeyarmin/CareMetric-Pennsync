import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Play,
  Award,
  MessageSquare
} from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";
import TrainingFeedbackDialog from "./TrainingFeedbackDialog";

export default function MyTrainingDashboard({ nurseEmail }) {
  const queryClient = useQueryClient();

  const { data: completions = [] } = useQuery({
    queryKey: ['myCompletions', nurseEmail],
    queryFn: () => base44.entities.TrainingCompletion.filter({ nurse_email: nurseEmail }).catch(() => []),
    enabled: !!nurseEmail
  });

  const { data: modules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.list().catch(() => [])
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TrainingCompletion.update(id, data),
    onSuccess: () => queryClient.invalidateQueries(['myCompletions'])
  });

  const getModule = (moduleId) => modules.find(m => m.id === moduleId);

  const assignedTraining = completions.filter(c => c.status === 'assigned' || c.status === 'in_progress');
  const completedTraining = completions.filter(c => c.status === 'completed');
  
  const overdueTraining = assignedTraining.filter(c => {
    if (!c.due_date) return false;
    return differenceInDays(new Date(), parseISO(c.due_date)) > 0;
  });

  const startTraining = (completion) => {
    updateMutation.mutate({ id: completion.id, data: { status: 'in_progress' } });
  };

  const completeTraining = (completion) => {
    updateMutation.mutate({ 
      id: completion.id, 
      data: { 
        status: 'completed', 
        completion_date: format(new Date(), 'yyyy-MM-dd')
      } 
    });
  };

  const getStatusColor = (status, dueDate) => {
    if (status === 'completed') return 'bg-green-100 text-green-800';
    if (status === 'in_progress') return 'bg-blue-100 text-blue-800';
    if (dueDate && differenceInDays(new Date(), parseISO(dueDate)) > 0) return 'bg-red-100 text-red-800';
    return 'bg-yellow-100 text-yellow-800';
  };

  const completionRate = completions.length > 0 
    ? Math.round((completedTraining.length / completions.length) * 100) 
    : 0;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{assignedTraining.length}</p>
              <p className="text-sm text-gray-500">Pending</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{completedTraining.length}</p>
              <p className="text-sm text-gray-500">Completed</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{overdueTraining.length}</p>
              <p className="text-sm text-gray-500">Overdue</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
              <Award className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{completionRate}%</p>
              <p className="text-sm text-gray-500">Complete</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Overdue Alert */}
      {overdueTraining.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-semibold">You have {overdueTraining.length} overdue training(s)</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Training */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-600" />
            Assigned Training
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assignedTraining.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No pending training assignments</p>
          ) : (
            <div className="space-y-3">
              {assignedTraining.map(completion => {
                const module = getModule(completion.training_module_id);
                const isOverdue = completion.due_date && differenceInDays(new Date(), parseISO(completion.due_date)) > 0;
                
                return (
                  <div key={completion.id} className={`p-4 border rounded-lg ${isOverdue ? 'border-red-300 bg-red-50' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold">{module?.title || 'Unknown Module'}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge className={getStatusColor(completion.status, completion.due_date)}>
                            {isOverdue ? 'Overdue' : completion.status.replace('_', ' ')}
                          </Badge>
                          {module?.duration_minutes && (
                            <span className="text-xs text-gray-500">{module.duration_minutes} min</span>
                          )}
                          {completion.due_date && (
                            <span className="text-xs text-gray-500">
                              Due: {format(parseISO(completion.due_date), 'MMM d, yyyy')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {completion.status === 'assigned' && (
                          <Button size="sm" onClick={() => startTraining(completion)}>
                            <Play className="w-4 h-4 mr-1" /> Start
                          </Button>
                        )}
                        {completion.status === 'in_progress' && (
                          <>
                            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => completeTraining(completion)}>
                              <CheckCircle2 className="w-4 h-4 mr-1" /> Complete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {/* Show feedback option for in-progress or completed */}
                    {(completion.status === 'in_progress' || completion.status === 'completed') && (
                      <div className="mt-3 pt-3 border-t">
                        <TrainingFeedbackDialog 
                          completion={completion}
                          moduleTitle={module?.title}
                          trigger={
                            <Button variant="outline" size="sm" className="w-full">
                              <MessageSquare className="w-4 h-4 mr-2" />
                              {completion.relevance_rating ? 'Update Feedback' : 'Rate This Training'}
                            </Button>
                          }
                        />
                      </div>
                    )}
                    {module?.description && (
                      <p className="text-sm text-gray-600 mt-2">{module.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completed Training */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Completed Training
          </CardTitle>
        </CardHeader>
        <CardContent>
          {completedTraining.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No completed training yet</p>
          ) : (
            <div className="space-y-2">
              {completedTraining.slice(0, 10).map(completion => {
                const module = getModule(completion.training_module_id);
                return (
                  <div key={completion.id} className="p-3 bg-green-50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                        <div>
                          <p className="font-medium">{module?.title || 'Unknown Module'}</p>
                          <p className="text-xs text-gray-500">
                            Completed: {completion.completion_date ? format(parseISO(completion.completion_date), 'MMM d, yyyy') : 'N/A'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {completion.score && (
                          <Badge className="bg-green-100 text-green-800">Score: {completion.score}%</Badge>
                        )}
                        {completion.relevance_rating && (
                          <Badge variant="outline">{completion.relevance_rating}/5 ⭐</Badge>
                        )}
                      </div>
                    </div>
                    
                    {/* Feedback prompt */}
                    {!completion.relevance_rating && (
                      <TrainingFeedbackDialog 
                        completion={completion}
                        moduleTitle={module?.title}
                        trigger={
                          <Button variant="ghost" size="sm" className="w-full text-blue-600 hover:text-blue-700">
                            <MessageSquare className="w-4 h-4 mr-2" />
                            Rate this training to improve recommendations
                          </Button>
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}