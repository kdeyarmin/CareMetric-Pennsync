import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Zap, 
  CheckCircle,
  Calendar,
  User,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function AutoTaskGenerator({ carePlan, patientId }) {
  const [selectedTasks, setSelectedTasks] = React.useState([]);
  const queryClient = useQueryClient();

  const suggestedTasks = React.useMemo(() => {
    if (!carePlan) return [];
    
    const tasks = [];
    
    // Generate tasks from interventions
    carePlan.interventions?.forEach((intervention, idx) => {
      tasks.push({
        title: intervention.intervention,
        description: intervention.rationale || '',
        task_type: 'intervention',
        discipline: intervention.discipline,
        frequency: intervention.frequency,
        priority: 'medium',
        auto_generated: true,
        source: `Care Plan Intervention ${idx + 1}`
      });
    });

    // Generate tasks from goals
    carePlan.goals?.forEach((goal, idx) => {
      tasks.push({
        title: `Review Progress: ${goal.goal}`,
        description: `Assess patient progress toward goal: ${goal.goal}`,
        task_type: 'assessment',
        frequency: 'weekly',
        priority: 'medium',
        auto_generated: true,
        source: `Care Plan Goal ${idx + 1}`
      });
    });

    return tasks;
  }, [carePlan]);

  React.useEffect(() => {
    // Auto-select all tasks initially
    setSelectedTasks(suggestedTasks.map((_, idx) => idx));
  }, [suggestedTasks]);

  const createTasksMutation = useMutation({
    mutationFn: async () => {
      const tasksToCreate = suggestedTasks.filter((_, idx) => 
        selectedTasks.includes(idx)
      ).map(task => ({
        ...task,
        patient_id: patientId,
        care_plan_id: carePlan.id,
        status: 'pending',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        recurring: task.frequency ? true : false,
        recurrence_pattern: task.frequency
      }));

      return await base44.entities.Task.bulkCreate(tasksToCreate);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['tasks']);
      toast.success(`${selectedTasks.length} tasks created automatically`);
    },
    onError: (error) => {
      toast.error('Failed to create tasks: ' + error.message);
    }
  });

  if (!carePlan || suggestedTasks.length === 0) return null;

  return (
    <Card className="border-2 border-green-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-green-600" />
          Auto-Generated Tasks ({selectedTasks.length} selected)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          Tasks automatically generated from care plan interventions and goals
        </p>

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {suggestedTasks.map((task, idx) => (
            <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
              <Checkbox
                checked={selectedTasks.includes(idx)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedTasks([...selectedTasks, idx]);
                  } else {
                    setSelectedTasks(selectedTasks.filter(i => i !== idx));
                  }
                }}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="font-medium text-sm">{task.title}</p>
                <p className="text-xs text-slate-600 mt-1">{task.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="text-xs">
                    {task.task_type}
                  </Badge>
                  {task.discipline && (
                    <Badge variant="outline" className="text-xs">
                      <User className="h-3 w-3 mr-1" />
                      {task.discipline}
                    </Badge>
                  )}
                  {task.frequency && (
                    <Badge variant="outline" className="text-xs">
                      <Calendar className="h-3 w-3 mr-1" />
                      {task.frequency}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button
          onClick={() => createTasksMutation.mutate()}
          disabled={createTasksMutation.isPending || selectedTasks.length === 0}
          className="w-full bg-green-600 hover:bg-green-700"
        >
          {createTasksMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Creating Tasks...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 mr-2" />
              Create {selectedTasks.length} Task{selectedTasks.length !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}