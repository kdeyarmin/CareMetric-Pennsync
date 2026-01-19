import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  ListTodo, 
  Plus, 
  Clock, 
  AlertCircle,
  CheckCircle2,
  Loader2,
  Zap
} from 'lucide-react';
import { toast } from 'sonner';

export default function RealTimeTaskGenerator({ 
  clinicalContext, 
  patientId, 
  visitId,
  autoGenerate = true 
}) {
  const [generatedTasks, setGeneratedTasks] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [lastContext, setLastContext] = useState('');

  useEffect(() => {
    if (autoGenerate && clinicalContext && clinicalContext !== lastContext && clinicalContext.length > 100) {
      generateTasksFromContext();
      setLastContext(clinicalContext);
    }
  }, [clinicalContext, autoGenerate]);

  const generateTasksFromContext = async () => {
    setGenerating(true);
    try {
      const prompt = `Based on this clinical context, identify necessary follow-up tasks:

${clinicalContext}

Generate specific, actionable follow-up tasks that should be completed. Include:
- Task description
- Priority level (critical/high/medium/low)
- Suggested timeframe (today/24_hours/48_hours/this_week/next_visit)
- Reason why this task is needed

Only suggest tasks that are clinically necessary based on the context.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                  due_timeframe: { type: 'string', enum: ['today', '24_hours', '48_hours', 'this_week', 'next_visit'] },
                  ai_reason: { type: 'string' },
                  type: { type: 'string' }
                }
              }
            }
          }
        }
      });

      const newTasks = response.tasks || [];
      setGeneratedTasks(prev => {
        const merged = [...prev];
        newTasks.forEach(task => {
          if (!merged.some(t => t.title === task.title)) {
            merged.push(task);
          }
        });
        return merged;
      });

      if (newTasks.length > 0) {
        toast.success(`${newTasks.length} new task(s) suggested`);
      }
    } catch (error) {
      console.error('Error generating tasks:', error);
    } finally {
      setGenerating(false);
    }
  };

  const toggleTask = (index) => {
    setSelectedTasks(prev => 
      prev.includes(index) 
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  const createSelectedTasks = async () => {
    const tasksToCreate = generatedTasks.filter((_, idx) => selectedTasks.includes(idx));
    
    try {
      for (const task of tasksToCreate) {
        await base44.entities.Task.create({
          patient_id: patientId,
          related_visit_id: visitId,
          title: task.title,
          description: task.description,
          priority: task.priority,
          due_timeframe: task.due_timeframe,
          type: task.type || 'followup',
          source: 'ai_generated',
          ai_reason: task.ai_reason,
          status: 'pending'
        });
      }

      toast.success(`Created ${tasksToCreate.length} task(s)`);
      
      // Remove created tasks from list
      setGeneratedTasks(prev => prev.filter((_, idx) => !selectedTasks.includes(idx)));
      setSelectedTasks([]);
    } catch (error) {
      console.error('Error creating tasks:', error);
      toast.error('Failed to create some tasks');
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200';
      case 'low': return 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-200';
    }
  };

  const getTimeframeLabel = (timeframe) => {
    const labels = {
      today: 'Today',
      '24_hours': 'Within 24h',
      '48_hours': 'Within 48h',
      this_week: 'This Week',
      next_visit: 'Next Visit'
    };
    return labels[timeframe] || timeframe;
  };

  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardHeader className="bg-blue-50 dark:bg-blue-950">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            AI Task Suggestions
            {generating && <Loader2 className="w-4 h-4 animate-spin" />}
          </CardTitle>
          <Badge variant="secondary">{generatedTasks.length} suggested</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {generatedTasks.length > 0 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {generatedTasks.map((task, idx) => (
                <div 
                  key={idx}
                  className="p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`task-${idx}`}
                      checked={selectedTasks.includes(idx)}
                      onCheckedChange={() => toggleTask(idx)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="font-semibold text-sm">{task.title}</p>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Badge className={getPriorityColor(task.priority)} variant="secondary">
                            {task.priority}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            <Clock className="w-3 h-3 mr-1" />
                            {getTimeframeLabel(task.due_timeframe)}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                        {task.description}
                      </p>
                      <div className="flex items-start gap-1 text-xs text-gray-600 dark:text-gray-400">
                        <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>{task.ai_reason}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={() => setSelectedTasks(generatedTasks.map((_, i) => i))}
                variant="outline"
                size="sm"
                disabled={selectedTasks.length === generatedTasks.length}
              >
                Select All
              </Button>
              <Button 
                onClick={() => setSelectedTasks([])}
                variant="outline"
                size="sm"
                disabled={selectedTasks.length === 0}
              >
                Deselect All
              </Button>
              <Button 
                onClick={createSelectedTasks}
                disabled={selectedTasks.length === 0}
                className="ml-auto"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create {selectedTasks.length} Task{selectedTasks.length !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <ListTodo className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {generating 
                ? 'Analyzing clinical context for tasks...'
                : 'AI will suggest tasks as you document the visit'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}