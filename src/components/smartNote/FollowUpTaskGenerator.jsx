import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { Loader2, CheckCircle2, Clock, AlertCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function FollowUpTaskGenerator({ noteContent, diagnosis, patientId, currentUserEmail, onTasksCreated }) {
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (noteContent && diagnosis && noteContent.length > 50) {
      generateTasks();
    }
  }, [noteContent, diagnosis]);

  const generateTasks = async () => {
    if (!noteContent || noteContent.length < 50) return;
    
    setLoading(true);
    try {
      const response = await base44.functions.invoke('generateFollowUpTasksFromNote', {
        note_content: noteContent,
        diagnosis: diagnosis,
        patient_id: patientId
      });

      const tasks = response.data?.suggested_tasks || response.suggested_tasks || [];
      setSuggestedTasks(tasks);
      
      if (tasks.length === 0) {
        toast.info('No follow-up tasks identified');
      }
    } catch (error) {
      console.error('Error generating tasks:', error);
      toast.error('Failed to generate follow-up tasks');
    } finally {
      setLoading(false);
    }
  };

  const createTasksMutation = useMutation({
    mutationFn: async (tasks) => {
      const taskData = tasks.map(task => ({
        title: task.title,
        description: task.description,
        due_date: task.due_date,
        priority: task.priority || 'medium',
        patient_id: patientId,
        assigned_to: currentUserEmail,
        status: 'open',
        created_from_note: true
      }));

      return await Promise.all(
        taskData.map(task => base44.entities.Task.create(task))
      );
    },
    onSuccess: (createdTasks) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(`Created ${createdTasks.length} follow-up task(s)`);
      onTasksCreated?.(createdTasks);
      setSelectedTasks([]);
      setSuggestedTasks([]);
    },
    onError: (error) => {
      toast.error('Failed to create tasks');
      console.error(error);
    }
  });

  const toggleTaskSelection = (task) => {
    setSelectedTasks(prev => 
      prev.find(t => t.title === task.title) 
        ? prev.filter(t => t.title !== task.title)
        : [...prev, task]
    );
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'low':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Card className="border-purple-200 bg-purple-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-600" />
            Follow-Up Task Generator
          </CardTitle>
          <Button
            onClick={generateTasks}
            disabled={loading || !noteContent || noteContent.length < 50}
            size="sm"
            variant="outline"
            className="h-8"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-4 gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
            <span className="text-sm text-gray-600">Analyzing note for follow-up tasks...</span>
          </div>
        ) : suggestedTasks.length > 0 ? (
          <>
            <div className="space-y-2">
              {suggestedTasks.map((task, idx) => (
                <div
                  key={idx}
                  className={`p-3 border rounded-lg cursor-pointer transition-all ${
                    selectedTasks.find(t => t.title === task.title)
                      ? 'bg-purple-100 border-purple-400'
                      : 'bg-white border-gray-200 hover:border-purple-300'
                  }`}
                  onClick={() => toggleTaskSelection(task)}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <h4 className="text-sm font-semibold text-gray-900">{task.title}</h4>
                        <p className="text-xs text-gray-600 mt-1">{task.description}</p>
                      </div>
                      <Badge className={`whitespace-nowrap text-xs ${getPriorityColor(task.priority)}`}>
                        {task.priority || 'medium'}
                      </Badge>
                    </div>
                    
                    {task.due_date && (
                      <div className="flex items-center gap-1 text-xs text-gray-600">
                        <AlertCircle className="w-3 h-3" />
                        Due: {new Date(task.due_date).toLocaleDateString()}
                      </div>
                    )}

                    {task.reason && (
                      <div className="bg-gray-50 p-2 rounded text-xs text-gray-700 border-l-2 border-purple-300">
                        <strong>Why:</strong> {task.reason}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {selectedTasks.length > 0 && (
              <div className="pt-3 border-t space-y-3">
                <div className="bg-purple-100 p-2 rounded text-sm text-purple-900">
                  <strong>{selectedTasks.length}</strong> task(s) selected
                </div>
                <Button
                  onClick={() => createTasksMutation.mutate(selectedTasks)}
                  disabled={createTasksMutation.isPending}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                  size="sm"
                >
                  {createTasksMutation.isPending ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                      Creating Tasks...
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3 mr-1" />
                      Create Selected Tasks
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-600 text-center py-4">
            No follow-up tasks identified in note
          </div>
        )}
      </CardContent>
    </Card>
  );
}