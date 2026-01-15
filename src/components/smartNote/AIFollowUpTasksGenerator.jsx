import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Brain, Loader2, CheckCircle2, ListTodo, AlertTriangle, Clock } from "lucide-react";
import { motion } from "framer-motion";

export default function AIFollowUpTasksGenerator({ 
  visitId,
  patientId, 
  patientName,
  visitNotes,
  vitalSigns,
  compact = false 
}) {
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState(new Set());
  const [creating, setCreating] = useState(false);

  const handleGenerateTasks = async () => {
    setGenerating(true);
    setSuggestedTasks([]);
    setSelectedTasks(new Set());

    try {
      const { generateFollowUpTasksFromVisit } = await import('@/functions/generateFollowUpTasksFromVisit');
      const response = await generateFollowUpTasksFromVisit({
        visit_id: visitId,
        patient_id: patientId,
        visit_notes: visitNotes,
        vital_signs: vitalSigns,
        auto_create: false
      });

      setSuggestedTasks(response.data.suggested_tasks || []);
      // Auto-select critical and high priority tasks
      const autoSelect = new Set(
        response.data.suggested_tasks
          .filter(t => t.priority === 'critical' || t.priority === 'high')
          .map((_, idx) => idx)
      );
      setSelectedTasks(autoSelect);
    } catch (error) {
      console.error('Failed to generate tasks:', error);
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateSelectedTasks = async () => {
    setCreating(true);

    try {
      const tasksToCreate = Array.from(selectedTasks).map(idx => suggestedTasks[idx]);
      
      for (const task of tasksToCreate) {
        let dueDate = new Date();
        switch (task.due_timeframe) {
          case 'today':
            break;
          case '24_hours':
            dueDate.setDate(dueDate.getDate() + 1);
            break;
          case '48_hours':
            dueDate.setDate(dueDate.getDate() + 2);
            break;
          case 'this_week':
            dueDate.setDate(dueDate.getDate() + 7);
            break;
          case 'next_visit':
            dueDate.setDate(dueDate.getDate() + 7);
            break;
        }

        await base44.entities.Task.create({
          patient_id: patientId,
          title: task.title,
          description: task.description,
          type: task.type,
          priority: task.priority,
          due_date: dueDate.toISOString().split('T')[0],
          due_timeframe: task.due_timeframe,
          source: 'ai_generated',
          ai_reason: task.ai_reason,
          related_visit_id: visitId,
          status: 'pending'
        });
      }

      queryClient.invalidateQueries({ queryKey: ['nurseTasks'] });
      queryClient.invalidateQueries({ queryKey: ['patientTasks', patientId] });
      
      setSuggestedTasks([]);
      setSelectedTasks(new Set());
    } catch (error) {
      console.error('Failed to create tasks:', error);
    } finally {
      setCreating(false);
    }
  };

  const toggleTaskSelection = (index) => {
    const newSelected = new Set(selectedTasks);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedTasks(newSelected);
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getTimeframeIcon = (timeframe) => {
    if (timeframe === 'today' || timeframe === '24_hours') {
      return <AlertTriangle className="w-3 h-3 text-orange-600" />;
    }
    return <Clock className="w-3 h-3 text-gray-600" />;
  };

  return (
    <Card className="border-l-4 border-l-blue-600">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="w-5 h-5 text-blue-600" />
            AI Follow-Up Tasks
          </CardTitle>
          <Button
            size="sm"
            onClick={handleGenerateTasks}
            disabled={generating || !visitNotes}
            variant="outline"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 mr-2" />
                Generate Tasks
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {suggestedTasks.length === 0 && !generating ? (
          <div className="text-center py-6">
            <ListTodo className="w-12 h-12 text-blue-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              AI will analyze the visit and suggest follow-up tasks
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {visitNotes ? 'Click "Generate Tasks" to begin' : 'Complete visit notes first'}
            </p>
          </div>
        ) : suggestedTasks.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {suggestedTasks.length} tasks recommended
              </p>
              <p className="text-xs text-gray-500">
                {selectedTasks.size} selected
              </p>
            </div>

            <div className="space-y-2">
              {suggestedTasks.map((task, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`border-2 rounded-lg p-3 transition-colors ${
                    selectedTasks.has(idx) 
                      ? 'border-blue-400 bg-blue-50 dark:bg-blue-950' 
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedTasks.has(idx)}
                      onCheckedChange={() => toggleTaskSelection(idx)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge className={getPriorityColor(task.priority)}>
                          {task.priority}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {task.type}
                        </Badge>
                        <div className="flex items-center gap-1">
                          {getTimeframeIcon(task.due_timeframe)}
                          <span className="text-xs text-gray-600 dark:text-gray-400">
                            {task.due_timeframe.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                      <p className="font-semibold text-gray-900 dark:text-white mb-1">
                        {task.title}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        {task.description}
                      </p>
                      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-2">
                        <p className="text-xs text-blue-900 dark:text-blue-100">
                          <strong>Why:</strong> {task.ai_reason}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="flex gap-2 pt-3 border-t">
              <Button
                onClick={handleCreateSelectedTasks}
                disabled={selectedTasks.size === 0 || creating}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Create {selectedTasks.size} Task{selectedTasks.size !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSuggestedTasks([]);
                  setSelectedTasks(new Set());
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}