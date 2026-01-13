import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, AlertCircle, Clock, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { formatEastern } from "../utils/timezone";

export default function MobileTaskList({ userEmail }) {
  const queryClient = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['mobileTasks', userEmail],
    queryFn: async () => {
      return base44.entities.Task.filter({
        assigned_to: userEmail,
        status: { $in: ['pending', 'in_progress'] }
      }, '-priority', 20);
    },
    enabled: !!userEmail
  });

  const completeTaskMutation = useMutation({
    mutationFn: async (taskId) => {
      return base44.entities.Task.update(taskId, {
        status: 'completed',
        completion_notes: 'Completed via mobile'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mobileTasks'] });
      toast.success('Task completed!');
      if (navigator.vibrate) navigator.vibrate(50);
    }
  });

  const priorityColors = {
    critical: 'bg-red-100 text-red-800 border-red-300',
    high: 'bg-orange-100 text-orange-800 border-orange-300',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    low: 'bg-green-100 text-green-800 border-green-300'
  };

  const priorityIcons = {
    critical: <AlertCircle className="w-3 h-3" />,
    high: <Clock className="w-3 h-3" />,
    medium: <Clock className="w-3 h-3" />,
    low: <Circle className="w-3 h-3" />
  };

  const urgentTasks = tasks.filter(t => t.priority === 'critical' || t.priority === 'high');
  const normalTasks = tasks.filter(t => t.priority === 'medium' || t.priority === 'low');

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="animate-pulse space-y-2">
            <div className="h-12 bg-gray-200 rounded"></div>
            <div className="h-12 bg-gray-200 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-600" />
          <p className="text-sm text-gray-600">All caught up! No pending tasks.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Urgent Tasks */}
      {urgentTasks.length > 0 && (
        <Card className="border-2 border-red-300 bg-red-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              Urgent ({urgentTasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {urgentTasks.map(task => (
              <div
                key={task.id}
                className="bg-white rounded-lg p-3 border border-red-200 active:bg-red-50 mobile-card"
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => completeTaskMutation.mutate(task.id)}
                    className="mt-1 touch-target"
                  >
                    <Circle className="w-5 h-5 text-red-600" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-gray-600 mt-1">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge className={priorityColors[task.priority]}>
                        {priorityIcons[task.priority]}
                        {task.priority}
                      </Badge>
                      {task.due_date && (
                        <span className="text-xs text-gray-500">
                          Due: {formatEastern(task.due_date, 'MMM d')}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Normal Tasks */}
      {normalTasks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Other Tasks ({normalTasks.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {normalTasks.map(task => (
              <div
                key={task.id}
                className="bg-white hover:bg-gray-50 rounded-lg p-3 border border-gray-200 active:bg-gray-100 mobile-card"
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => completeTaskMutation.mutate(task.id)}
                    className="mt-1 touch-target"
                  >
                    <Circle className="w-5 h-5 text-gray-400" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">
                        {task.priority}
                      </Badge>
                      {task.due_date && (
                        <span className="text-xs text-gray-500">
                          {formatEastern(task.due_date, 'MMM d')}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}