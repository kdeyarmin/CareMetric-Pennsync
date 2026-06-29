import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  ListTodo,
  Clock,
  AlertTriangle,
  CheckCircle2,
  User,
  RefreshCw,
  Zap,
  Target,
  UserPlus,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function IntelligentTaskPrioritization({ 
  nurseEmail,
  patients = [],
  onTaskCompleted 
}) {
  const queryClient = useQueryClient();
  const ai = useAICall();
  const [prioritizedTasks, setPrioritizedTasks] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const { data: tasks = [] } = useQuery({
    queryKey: ['nurseTasks', nurseEmail],
    queryFn: () => base44.entities.Task.filter({ 
      assigned_to: nurseEmail,
      status: { $in: ['pending', 'in_progress'] }
    }),
    enabled: !!nurseEmail
  });

  const { data: patientAlerts = [] } = useQuery({
    queryKey: ['patientAlerts'],
    queryFn: () => base44.entities.PatientAlert.filter({ status: 'active' }),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Task.update(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['nurseTasks'] });
      // Only drop the task from the local prioritized list once the server
      // confirms — otherwise a failed update made it look completed.
      setPrioritizedTasks((prev) =>
        prev
          ? { ...prev, prioritized_tasks: (prev.prioritized_tasks || []).filter((t) => t.task_id !== variables.id) }
          : prev
      );
      onTaskCompleted && onTaskCompleted();
    },
    onError: () => {
      toast.error('Could not complete the task. Please try again.');
    }
  });

  const prioritizeTasks = async () => {
    if (tasks.length === 0) return;


    try {
      // Enrich tasks with patient context
      const enrichedTasks = (tasks || []).map(task => {
        const patient = (patients || []).find(p => p.id === task.patient_id);
        const relatedAlerts = (patientAlerts || []).filter(a => a.patient_id === task.patient_id);
        
        return {
          id: task.id,
          title: task.title,
          description: task.description,
          type: task.type,
          priority: task.priority,
          due_date: task.due_date,
          due_timeframe: task.due_timeframe,
          patient_name: patient ? `${patient.first_name} ${patient.last_name}` : null,
          patient_diagnosis: patient?.primary_diagnosis,
          patient_care_type: patient?.care_type,
          has_active_alerts: relatedAlerts.length > 0,
          alert_severities: relatedAlerts.map(a => a.severity),
          source: task.source
        };
      });

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an intelligent task prioritization AI for home health nurses. Analyze these tasks and prioritize them for maximum patient safety and compliance.

TASKS TO PRIORITIZE:
${JSON.stringify(enrichedTasks, null, 2)}

CURRENT DATE: ${format(new Date(), 'yyyy-MM-dd')}

PRIORITIZATION CRITERIA (in order of importance):
1. PATIENT SAFETY: Tasks related to patients with active critical/high alerts
2. COMPLIANCE: Tasks with regulatory/documentation deadlines
3. CLINICAL URGENCY: Medication issues, symptom changes, care coordination
4. DUE DATE: Overdue > Today > Tomorrow > This Week
5. PATIENT ACUITY: Hospice patients, complex diagnoses
6. TASK TYPE: Urgent interventions > Notifications > Documentation > Routine

DELEGATION ANALYSIS:
- Identify tasks that could be delegated to office staff
- Flag tasks requiring RN-level clinical judgment

Return JSON:
{
  "prioritized_tasks": [
    {
      "task_id": "id",
      "title": "title",
      "patient_name": "name or null",
      "original_priority": "high/medium/low",
      "ai_priority_score": 1-100,
      "ai_priority_level": "critical" | "high" | "medium" | "low",
      "priority_reason": "why this priority",
      "suggested_action": "what to do first",
      "can_delegate": true/false,
      "delegate_to": "office_staff" | "rn_only" | null,
      "time_sensitivity": "overdue" | "urgent" | "today" | "soon" | "flexible",
      "compliance_impact": "high" | "medium" | "low" | "none"
    }
  ],
  "summary": {
    "critical_count": number,
    "high_count": number,
    "delegatable_count": number,
    "overdue_count": number
  },
  "immediate_actions": ["top 3 things to do right now"],
  "delegation_recommendations": ["tasks to delegate and to whom"],
  "time_management_tips": ["efficiency suggestions"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            prioritized_tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  task_id: { type: "string" },
                  title: { type: "string" },
                  patient_name: { type: "string" },
                  original_priority: { type: "string" },
                  ai_priority_score: { type: "number" },
                  ai_priority_level: { type: "string" },
                  priority_reason: { type: "string" },
                  suggested_action: { type: "string" },
                  can_delegate: { type: "boolean" },
                  delegate_to: { type: "string" },
                  time_sensitivity: { type: "string" },
                  compliance_impact: { type: "string" }
                }
              }
            },
            summary: { type: "object" },
            immediate_actions: { type: "array", items: { type: "string" } },
            delegation_recommendations: { type: "array", items: { type: "string" } },
            time_management_tips: { type: "array", items: { type: "string" } }
          }
        }
      });

      setPrioritizedTasks(result);

    } catch (error) {
      console.error("Error prioritizing tasks:", error);
    }

  };

  const completeTask = (taskId) => {
    updateTaskMutation.mutate({
      id: taskId,
      data: { status: 'completed', completion_notes: 'Completed via Smart Task Manager' }
    });
  };

  const getPriorityColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  const getTimeSensitivityIcon = (sensitivity) => {
    switch (sensitivity) {
      case 'overdue': return <AlertTriangle className="w-3 h-3 text-red-600" />;
      case 'urgent': return <Zap className="w-3 h-3 text-orange-600" />;
      case 'today': return <Clock className="w-3 h-3 text-yellow-600" />;
      default: return <Clock className="w-3 h-3 text-slate-400" />;
    }
  };

  if (tasks.length === 0) {
    return (
      <Card className="border-green-200">
        <CardContent className="p-4 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
          <p className="text-sm text-slate-600">No pending tasks - great job!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-navy-200">
      <CardHeader 
        className="py-3 bg-gradient-to-r from-navy-50 to-indigo-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-4 h-4 text-navy-600" />
            Smart Task Prioritization
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{tasks.length} tasks</Badge>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 space-y-4">
          {!prioritizedTasks ? (
            <div className="text-center py-4">
              <ListTodo className="w-12 h-12 mx-auto mb-3 text-navy-300" />
              <p className="text-sm text-slate-600 mb-3">
                Let AI prioritize your {tasks.length} tasks for maximum efficiency
              </p>
              <Button
                onClick={prioritizeTasks}
                disabled={ai.loading}
                className="bg-navy-600 hover:bg-navy-700"
              >
                {ai.loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing Tasks...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4 mr-2" />
                    Prioritize My Tasks
                  </>
                )}
              </Button>
            </div>
          ) : (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-2">
                <div className="text-center p-2 bg-red-50 rounded">
                  <p className="text-xl font-bold text-red-600">{prioritizedTasks.summary?.critical_count || 0}</p>
                  <p className="text-xs text-slate-600">Critical</p>
                </div>
                <div className="text-center p-2 bg-orange-50 rounded">
                  <p className="text-xl font-bold text-orange-600">{prioritizedTasks.summary?.high_count || 0}</p>
                  <p className="text-xs text-slate-600">High</p>
                </div>
                <div className="text-center p-2 bg-yellow-50 rounded">
                  <p className="text-xl font-bold text-yellow-600">{prioritizedTasks.summary?.overdue_count || 0}</p>
                  <p className="text-xs text-slate-600">Overdue</p>
                </div>
                <div className="text-center p-2 bg-blue-50 rounded">
                  <p className="text-xl font-bold text-blue-600">{prioritizedTasks.summary?.delegatable_count || 0}</p>
                  <p className="text-xs text-slate-600">Delegatable</p>
                </div>
              </div>

              {/* Immediate Actions */}
              {prioritizedTasks.immediate_actions?.length > 0 && (
                <Alert className="bg-navy-50 border-navy-200">
                  <Target className="w-4 h-4 text-navy-600" />
                  <AlertDescription className="text-navy-900">
                    <p className="font-semibold text-sm mb-1">Do These First:</p>
                    <ol className="text-xs space-y-1 list-decimal list-inside">
                      {prioritizedTasks.immediate_actions.map((action, idx) => (
                        <li key={idx}>{action}</li>
                      ))}
                    </ol>
                  </AlertDescription>
                </Alert>
              )}

              {/* Prioritized Task List */}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {prioritizedTasks.prioritized_tasks?.map((task, idx) => (
                  <div 
                    key={task.task_id}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                      task.ai_priority_level === 'critical' ? 'bg-red-50 border-red-200' :
                      task.ai_priority_level === 'high' ? 'bg-orange-50 border-orange-200' :
                      'bg-white border-slate-200'
                    }`}
                  >
                    <Checkbox
                      onCheckedChange={() => completeTask(task.task_id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-slate-500 font-mono">#{idx + 1}</span>
                        <Badge className={getPriorityColor(task.ai_priority_level)}>
                          {task.ai_priority_level}
                        </Badge>
                        {getTimeSensitivityIcon(task.time_sensitivity)}
                        {task.can_delegate && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <UserPlus className="w-3 h-3" />
                            Delegatable
                          </Badge>
                        )}
                      </div>
                      <p className="font-medium text-sm mt-1">{task.title}</p>
                      {task.patient_name && (
                        <p className="text-xs text-slate-600 flex items-center gap-1 mt-0.5">
                          <User className="w-3 h-3" />
                          {task.patient_name}
                        </p>
                      )}
                      <p className="text-xs text-slate-500 mt-1 italic">{task.priority_reason}</p>
                      <p className="text-xs text-navy-700 mt-1">
                        💡 {task.suggested_action}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Delegation Recommendations */}
              {prioritizedTasks.delegation_recommendations?.length > 0 && (
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-blue-900 mb-1 flex items-center gap-1">
                    <UserPlus className="w-3 h-3" />
                    Delegation Suggestions:
                  </p>
                  <ul className="text-xs text-blue-800 space-y-1">
                    {prioritizedTasks.delegation_recommendations.map((rec, idx) => (
                      <li key={idx}>• {rec}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Re-prioritize Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={prioritizeTasks}
                disabled={ai.loading}
                className="w-full"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${ai.loading ? 'animate-spin' : ''}`} />
                Re-prioritize Tasks
              </Button>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}