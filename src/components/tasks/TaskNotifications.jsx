import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Bell, BellOff, Clock, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatEastern, todayEastern } from "../utils/timezone";
import { format, parseISO, differenceInHours, isPast, isToday } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function TaskNotifications({ userEmail, compact = false }) {
  const [dismissedTasks, setDismissedTasks] = useState([]);
  const queryClient = useQueryClient();

  const { data: tasks = [] } = useQuery({
    queryKey: ['userTasks', userEmail],
    queryFn: () => base44.entities.Task.filter({ 
      assigned_to: userEmail,
      status: 'pending'
    }),
    enabled: !!userEmail,
    refetchInterval: 60000, // Refresh every minute
  });

  const completeTaskMutation = useMutation({
    mutationFn: ({ taskId, notes }) => 
      base44.entities.Task.update(taskId, { 
        status: 'completed',
        completion_notes: notes || 'Completed via notification'
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userTasks'] });
    },
  });

  // Categorize tasks
  const categorizedTasks = React.useMemo(() => {
    const now = new Date();
    const today = todayEastern();
    
    return {
      overdue: tasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = parseISO(t.due_date);
        return isPast(dueDate) && !isToday(dueDate);
      }).filter(t => !dismissedTasks.includes(t.id)),
      
      dueToday: tasks.filter(t => {
        if (!t.due_date) return false;
        return t.due_date === today;
      }).filter(t => !dismissedTasks.includes(t.id)),
      
      upcoming: tasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = parseISO(t.due_date);
        const hoursUntilDue = differenceInHours(dueDate, now);
        return hoursUntilDue > 0 && hoursUntilDue <= 48 && !isToday(dueDate);
      }).filter(t => !dismissedTasks.includes(t.id)),
      
      critical: tasks.filter(t => t.priority === 'critical' && !dismissedTasks.includes(t.id)),
    };
  }, [tasks, dismissedTasks]);

  const getPriorityColor = (priority) => {
    const colors = {
      critical: "bg-red-600 text-white",
      high: "bg-orange-500 text-white",
      medium: "bg-yellow-500 text-white",
      low: "bg-blue-500 text-white"
    };
    return colors[priority] || colors.medium;
  };

  const handleDismiss = (taskId) => {
    setDismissedTasks(prev => [...prev, taskId]);
  };

  const handleComplete = (task) => {
    completeTaskMutation.mutate({ taskId: task.id, notes: 'Quick completed' });
  };

  const totalNotifications = 
    categorizedTasks.overdue.length + 
    categorizedTasks.dueToday.length + 
    categorizedTasks.critical.length;

  if (totalNotifications === 0 && compact) {
    return null;
  }

  if (compact) {
    return (
      <Card className="border-orange-200 bg-orange-50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-orange-600" />
              <div>
                <p className="font-semibold text-gray-900">Task Notifications</p>
                <p className="text-sm text-gray-600">
                  {categorizedTasks.overdue.length} overdue, {categorizedTasks.dueToday.length} due today
                </p>
              </div>
            </div>
            <Link to={createPageUrl("Tasks")}>
              <Button size="sm" variant="outline">View All</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-yellow-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-orange-600" />
          Task Notifications
          {totalNotifications > 0 && (
            <Badge className="bg-red-600 text-white">{totalNotifications}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overdue Tasks */}
        {categorizedTasks.overdue.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <h3 className="font-semibold text-red-900">Overdue Tasks ({categorizedTasks.overdue.length})</h3>
            </div>
            {categorizedTasks.overdue.map(task => (
              <Alert key={task.id} className="bg-red-50 border-red-300">
                <AlertDescription>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getPriorityColor(task.priority)}>
                          {task.priority}
                        </Badge>
                        <p className="font-semibold text-gray-900 truncate">{task.title}</p>
                      </div>
                      <p className="text-sm text-gray-600 mb-1">
                        Due: {task.due_date && format(parseISO(task.due_date), 'MMM d, yyyy')}
                        {task.due_time && ` at ${task.due_time}`}
                      </p>
                      {task.patient_id && (
                        <p className="text-xs text-gray-500">Patient Task</p>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleComplete(task)}
                        className="h-8 w-8 p-0"
                        title="Mark Complete"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDismiss(task.id)}
                        className="h-8 w-8 p-0"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Due Today */}
        {categorizedTasks.dueToday.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-orange-600" />
              <h3 className="font-semibold text-orange-900">Due Today ({categorizedTasks.dueToday.length})</h3>
            </div>
            {categorizedTasks.dueToday.map(task => (
              <Alert key={task.id} className="bg-orange-50 border-orange-300">
                <AlertDescription>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getPriorityColor(task.priority)}>
                          {task.priority}
                        </Badge>
                        <p className="font-semibold text-gray-900 truncate">{task.title}</p>
                      </div>
                      {task.due_time && (
                        <p className="text-sm text-gray-600 mb-1">Due at {task.due_time}</p>
                      )}
                      {task.description && (
                        <p className="text-sm text-gray-600 truncate">{task.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleComplete(task)}
                        className="h-8 w-8 p-0"
                        title="Mark Complete"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDismiss(task.id)}
                        className="h-8 w-8 p-0"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Critical Priority */}
        {categorizedTasks.critical.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <h3 className="font-semibold text-red-900">Critical Priority ({categorizedTasks.critical.length})</h3>
            </div>
            {categorizedTasks.critical.slice(0, 3).map(task => (
              <Alert key={task.id} className="bg-red-50 border-red-300">
                <AlertDescription>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 mb-1 truncate">{task.title}</p>
                      {task.due_date && (
                        <p className="text-sm text-gray-600">
                          Due: {format(parseISO(task.due_date), 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDismiss(task.id)}
                      className="h-8 w-8 p-0 flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Upcoming (next 48 hours) */}
        {categorizedTasks.upcoming.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Bell className="w-4 h-4 text-blue-600" />
              <h3 className="font-semibold text-blue-900">Upcoming ({categorizedTasks.upcoming.length})</h3>
            </div>
            {categorizedTasks.upcoming.slice(0, 3).map(task => (
              <Alert key={task.id} className="bg-blue-50 border-blue-300">
                <AlertDescription>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getPriorityColor(task.priority)} className="text-xs">
                          {task.priority}
                        </Badge>
                        <p className="font-medium text-gray-900 truncate text-sm">{task.title}</p>
                      </div>
                      <p className="text-xs text-gray-600">
                        Due: {format(parseISO(task.due_date), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDismiss(task.id)}
                      className="h-6 w-6 p-0 flex-shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {totalNotifications === 0 && (
          <div className="text-center py-6 text-gray-500">
            <BellOff className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>No urgent task notifications</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}