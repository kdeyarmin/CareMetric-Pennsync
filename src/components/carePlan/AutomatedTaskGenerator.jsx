import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ClipboardList,
  Loader2,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Zap,
  Target
} from "lucide-react";
import { format, addDays } from "date-fns";
import { toast } from 'sonner';

export default function AutomatedTaskGenerator({
  patient,
  carePlans = [],
  onTasksGenerated
}) {
  const ai = useAICall();
  const [generatedTasks, setGeneratedTasks] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState({});
  const [isCreating, setIsCreating] = useState(false);

  const generateTasks = async () => {
    if (!patient || carePlans.length === 0) return;

    try {
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a nurse task automation system. Generate specific, actionable tasks for nurses based on active care plans.

PATIENT: ${patient.first_name} ${patient.last_name}
DIAGNOSIS: ${patient.primary_diagnosis || 'Not specified'}

ACTIVE CARE PLANS (${activeCarePlans.length}):
${activeCarePlans.map(cp => `
Problem: ${cp.problem}
Goal: ${cp.goal}
Interventions: ${cp.interventions?.join('; ') || 'None'}
Frequency: ${cp.frequency || 'Not specified'}
`).join('\n---\n')}

For each care plan, generate 2-3 specific nurse tasks that:

1. DIRECTLY SUPPORT THE CARE PLAN GOAL
2. ARE ACTIONABLE: Clear, specific actions nurses can take
3. ARE PRIORITIZED: Based on clinical urgency and care plan priority
4. INCLUDE TIMING: When the task should be completed
5. ARE MEASURABLE: Clear completion criteria

Task types to consider:
- Assessment tasks (evaluate patient progress toward goal)
- Intervention tasks (perform specific nursing interventions)
- Education tasks (teach patient/caregiver about care plan)
- Coordination tasks (communicate with physician, coordinate services)
- Documentation tasks (document progress, update care plan)
- Follow-up tasks (schedule next assessment, order supplies)

Return JSON:`,
        response_json_schema: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  care_plan_problem: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  type: { 
                    type: "string", 
                    enum: ["call", "notify", "schedule", "order", "coordinate", "document", "followup", "other"]
                  },
                  priority: { 
                    type: "string",
                    enum: ["high", "medium", "low"]
                  },
                  due_timeframe: {
                    type: "string",
                    enum: ["today", "24_hours", "48_hours", "this_week", "next_visit"]
                  },
                  rationale: { type: "string" },
                  completion_criteria: { type: "string" },
                  suggested_due_days: { type: "number" }
                }
              }
            }
          }
        }
      });

      setGeneratedTasks(result.tasks || []);
      
      // Auto-select high priority tasks
      const autoSelected = {};
      result.tasks?.forEach((task, idx) => {
        if (task.priority === 'high') {
          autoSelected[idx] = true;
        }
      });
      setSelectedTasks(autoSelected);

    } catch (error) {
      console.error("Task generation error:", error);
      toast.error("Failed to generate tasks. Please try again.");
    }
  };

  const toggleTaskSelection = (idx) => {
    setSelectedTasks(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const selectAllTasks = () => {
    const allSelected = {};
    generatedTasks.forEach((_, idx) => {
      allSelected[idx] = true;
    });
    setSelectedTasks(allSelected);
  };

  const createSelectedTasks = async () => {
    if (!patient) return;

    const selected = generatedTasks.filter((_, idx) => selectedTasks[idx]);
    if (selected.length === 0) {
      toast.error("Please select at least one task to create.");
      return;
    }

    setIsCreating(true);
    try {
      // Get current user
      const currentUser = await base44.auth.me();
      
      const createdTasks = [];
      for (const task of selected) {
        const dueDate = format(addDays(new Date(), task.suggested_due_days || 7), 'yyyy-MM-dd');
        
        const newTask = await base44.entities.Task.create({
          patient_id: patient.id,
          title: task.title,
          description: task.description,
          type: task.type,
          priority: task.priority,
          status: 'pending',
          due_date: dueDate,
          due_timeframe: task.due_timeframe,
          source: 'care_plan',
          ai_reason: task.rationale,
          assigned_to: currentUser?.email
        });
        createdTasks.push(newTask);
      }

      if (onTasksGenerated) {
        onTasksGenerated(createdTasks);
      }

      toast.success(`Successfully created ${createdTasks.length} task(s)!`);
      setGeneratedTasks([]);
      setSelectedTasks({});

    } catch (error) {
      console.error("Task creation error:", error);
      toast.error("Failed to create tasks. Please try again.");
    }
    setIsCreating(false);
  };

  const getPriorityColor = (priority) => {
    const colors = {
      high: "bg-red-100 text-red-800 border-red-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      low: "bg-blue-100 text-blue-800 border-blue-300"
    };
    return colors[priority] || "bg-slate-100 text-slate-800";
  };

  const getTypeIcon = (type) => {
    const icons = {
      followup: Target,
      document: ClipboardList,
      call: AlertCircle,
      schedule: Calendar,
      coordinate: Zap,
      default: ClipboardList
    };
    return icons[type] || icons.default;
  };

  const activeCarePlansCount = carePlans.filter(cp => cp.status === 'active').length;
  const selectedCount = Object.values(selectedTasks).filter(Boolean).length;

  return (
    <Card className="border-2 border-indigo-300">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-blue-50">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-indigo-600" />
          Automated Task Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {generatedTasks.length === 0 ? (
          <div className="space-y-3">
            <Alert className="bg-indigo-50 border-indigo-200">
              <AlertDescription className="text-sm text-indigo-900">
                Automatically generate nurse tasks based on {activeCarePlansCount} active care plan(s). 
                Tasks will be prioritized and scheduled based on care plan goals.
              </AlertDescription>
            </Alert>
            <Button
              onClick={generateTasks}
              disabled={ai.loading || activeCarePlansCount === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Tasks...</>
              ) : (
                <><Zap className="w-4 h-4 mr-2" /> Generate Tasks from Care Plans</>
              )}
            </Button>
            {activeCarePlansCount === 0 && (
              <p className="text-xs text-orange-600 text-center">
                No active care plans found. Add care plans first to generate tasks.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Selection Controls */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {generatedTasks.length} task(s) generated from {activeCarePlansCount} care plan(s)
              </span>
              <Button size="sm" variant="outline" onClick={selectAllTasks}>
                Select All
              </Button>
            </div>

            {/* Generated Tasks */}
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {generatedTasks.map((task, idx) => {
                  const TypeIcon = getTypeIcon(task.type);
                  
                  return (
                    <Card 
                      key={idx}
                      className={`border transition-all ${
                        selectedTasks[idx] 
                          ? 'border-indigo-400 bg-indigo-50' 
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={selectedTasks[idx] || false}
                            onCheckedChange={() => toggleTaskSelection(idx)}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0 space-y-2">
                            {/* Header */}
                            <div className="flex items-start gap-2">
                              <TypeIcon className="w-4 h-4 text-slate-500 mt-1 flex-shrink-0" />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <Badge className={getPriorityColor(task.priority)}>
                                    {task.priority}
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    {task.type}
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    <Calendar className="w-3 h-3 mr-1" />
                                    {task.due_timeframe?.replace('_', ' ')}
                                  </Badge>
                                </div>
                                <h4 className="font-semibold text-slate-900">{task.title}</h4>
                              </div>
                            </div>

                            {/* Care Plan Reference */}
                            <div className="bg-navy-50 p-2 rounded border border-navy-200">
                              <p className="text-xs text-navy-800">
                                <strong>Care Plan:</strong> {task.care_plan_problem}
                              </p>
                            </div>

                            {/* Description */}
                            <p className="text-sm text-slate-700">{task.description}</p>

                            {/* Rationale */}
                            {task.rationale && (
                              <div className="bg-blue-50 p-2 rounded border border-blue-200">
                                <p className="text-xs text-blue-900">
                                  <strong>Why:</strong> {task.rationale}
                                </p>
                              </div>
                            )}

                            {/* Completion Criteria */}
                            {task.completion_criteria && (
                              <div className="bg-green-50 p-2 rounded border border-green-200">
                                <p className="text-xs text-green-900">
                                  <strong>Complete when:</strong> {task.completion_criteria}
                                </p>
                              </div>
                            )}

                            {/* Timing */}
                            <p className="text-xs text-slate-500">
                              <strong>Due:</strong> {task.suggested_due_days} day(s) from now
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                onClick={createSelectedTasks}
                disabled={selectedCount === 0 || isCreating}
              >
                {isCreating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Create {selectedCount} Task(s)</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setGeneratedTasks([]);
                  setSelectedTasks({});
                }}
              >
                Reset
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}