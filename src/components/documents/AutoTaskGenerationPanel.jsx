import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function AutoTaskGenerationPanel({
  documentContent,
  patientId,
  patientName,
  carePlanId,
}) {
  const [generatedTasks, setGeneratedTasks] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  const generateTasksMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('autoGenerateFollowUpTasks', {
        documentContent,
        patientId,
        patientName,
        carePlanId,
      });
      return response?.data?.tasks || [];
    },
    onSuccess: (tasks) => {
      setGeneratedTasks(tasks);
      setShowPreview(true);
      toast.success(`Created ${tasks.length} follow-up tasks`);
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const handleGenerateTasks = () => {
    generateTasksMutation.mutate();
  };

  const priorityColors = {
    high: 'bg-red-100 text-red-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-green-100 text-green-800',
  };

  const taskTypeIcons = {
    follow_up: '📋',
    medication: '💊',
    education: '📚',
    referral: '🔗',
    assessment: '📊',
    other: '📌',
  };

  return (
    <div className="space-y-4">
      {!showPreview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Generate Follow-Up Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600 mb-4">
              Automatically extract action items and create follow-up tasks from the generated document.
            </p>
            <Button
              onClick={handleGenerateTasks}
              disabled={generateTasksMutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {generateTasksMutation.isPending && (
                <Loader className="w-4 h-4 mr-2 animate-spin" />
              )}
              {generateTasksMutation.isPending ? 'Generating Tasks...' : 'Generate Tasks'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                Tasks Generated ({generatedTasks.length})
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(false)}
              >
                ✕
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            {generatedTasks.map((task, idx) => (
              <div
                key={idx}
                className="bg-white border rounded-lg p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {taskTypeIcons[task.task_type] || '📌'}
                      </span>
                      <h4 className="font-medium text-sm">{task.title}</h4>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      {task.description}
                    </p>
                  </div>
                  <Badge className={priorityColors[task.priority]}>
                    {task.priority}
                  </Badge>
                </div>

                {task.due_date && (
                  <div className="text-xs text-slate-500">
                    Due: {new Date(task.due_date).toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}

            <Button className="w-full bg-green-600 hover:bg-green-700">
              Confirm and Create Tasks
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}