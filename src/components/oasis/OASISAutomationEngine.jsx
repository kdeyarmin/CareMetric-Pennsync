import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  Users,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp
} from "lucide-react";

export default function OASISAutomationEngine({ 
  analysisResults, 
  patientId, 
  onTasksCreated,
  autoExecute = true 
}) {
  const ai = useAICall();
  const [suggestedActions, setSuggestedActions] = useState([]);
  const [selectedActions, setSelectedActions] = useState([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const queryClient = useQueryClient();

  // Current user — assigned_to is required on Task; without it the bulkCreate
  // below is rejected and the generated tasks are silently never created.
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Fetch active automation rules
  const { data: automationRules = [] } = useQuery({
    queryKey: ['automationRules'],
    queryFn: () => base44.entities.OASISAutomationRule.filter({ is_active: true }, '-priority'),
  });

  // Task creation mutation
  const createTasksMutation = useMutation({
    mutationFn: (tasks) => base44.entities.Task.bulkCreate(tasks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (onTasksCreated) onTasksCreated();
    },
  });

  const analyzeAndGenerateActions = useCallback(async () => {
    
    try {
      // Simplified analysis - extract key issues only
      const issuesSummary = {
        compliance: analysisResults.compliance_concerns?.slice(0, 3) || [],
        revenue: analysisResults.revenue_tips?.slice(0, 3) || [],
        accuracy: analysisResults.accuracy_issues?.slice(0, 3) || [],
        scores: {
          overall: analysisResults.overall_score,
          compliance: analysisResults.compliance_score,
          accuracy: analysisResults.accuracy_score,
          revenue: analysisResults.revenue_optimization_score
        }
      };

      const prompt = `Analyze OASIS results and generate 3-5 specific follow-up tasks.

ISSUES FOUND:
${JSON.stringify(issuesSummary, null, 2)}

AUTOMATION RULES:
${JSON.stringify(automationRules.slice(0, 5), null, 2)}

Generate actionable tasks. Each task must have: title, description, priority (high/medium/low), type, due_in_days (number), reason, impact_category.`;

      const aiSuggestions = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            suggested_actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  priority: { type: "string" },
                  type: { type: "string" },
                  due_in_days: { type: "number" },
                  assign_to_role: { type: "string" },
                  reason: { type: "string" },
                  impact_category: { type: "string" },
                  estimated_revenue_impact: { type: "string" },
                  compliance_risk_if_ignored: { type: "string" },
                  source_finding: { type: "string" },
                  auto_recommended: { type: "boolean" }
                }
              }
            }
          }
        }
      });

      const actions = aiSuggestions.suggested_actions || [];
      setSuggestedActions(actions);
      
      // Auto-select high priority items
      const autoSelect = actions
        .filter(a => a.auto_recommended || a.priority === 'high')
        .map((_, idx) => idx);
      setSelectedActions(autoSelect);

    } catch (error) {
      console.error("Automation analysis error:", error);
      setSuggestedActions([]);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [analysisResults, automationRules]);

  // Analyze results and generate actions
  useEffect(() => {
    if (analysisResults && automationRules.length > 0 && autoExecute) {
      analyzeAndGenerateActions();
    }
  }, [analysisResults, automationRules, autoExecute, analyzeAndGenerateActions]);

  const handleToggleAction = (index) => {
    setSelectedActions(prev => 
      prev.includes(index) 
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  const handleCreateTasks = async () => {
    // assigned_to is required on Task; abort if the current user isn't resolved yet
    // rather than attempting a bulkCreate with assigned_to undefined (which the
    // backend rejects).
    if (!currentUser?.email) {
      toast.error('Could not determine the current user. Please refresh and try again.');
      return;
    }
    const tasksToCreate = selectedActions.map(idx => {
      const action = suggestedActions[idx];
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (action.due_in_days || 7));

      return {
        patient_id: patientId,
        assigned_to: currentUser?.email,
        title: action.title,
        description: `${action.description}\n\n📋 Reason: ${action.reason}\n\n⚠️ Impact: ${action.compliance_risk_if_ignored || action.estimated_revenue_impact || 'Important for quality care'}`,
        type: action.type || 'followup',
        priority: action.priority,
        status: 'pending',
        due_date: dueDate.toISOString().split('T')[0],
        source: 'ai_generated',
        ai_reason: action.source_finding
      };
    });

    try {
      await createTasksMutation.mutateAsync(tasksToCreate);
      setSuggestedActions([]);
      setSelectedActions([]);
      toast.success(`Created ${tasksToCreate.length} task${tasksToCreate.length === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error('Failed to create tasks:', err);
      toast.error('Failed to create tasks. Please try again.');
    }
  };

  const getPriorityColor = (priority) => {
    const colors = {
      high: "bg-red-100 text-red-800 border-red-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      low: "bg-blue-100 text-blue-800 border-blue-300"
    };
    return colors[priority] || colors.low;
  };

  const getImpactIcon = (category) => {
    const icons = {
      compliance: <AlertTriangle className="w-4 h-4 text-orange-600" />,
      revenue: <Sparkles className="w-4 h-4 text-green-600" />,
      clinical: <Users className="w-4 h-4 text-blue-600" />,
      documentation: <FileText className="w-4 h-4 text-navy-600" />
    };
    return icons[category] || icons.documentation;
  };

  if (!analysisResults) return null;

  if (ai.loading) {
    return (
      <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-indigo-50">
        <CardContent className="p-6 text-center">
          <Loader2 className="w-8 h-8 text-navy-600 mx-auto mb-3 animate-spin" />
          <p className="text-sm font-medium text-navy-900">
            AI is analyzing results and generating follow-up actions...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (suggestedActions.length === 0) return null;

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-indigo-50">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="w-5 h-5 text-navy-600" />
            AI-Suggested Follow-Up Actions
            <Badge className="bg-navy-600 text-white ml-2">
              {suggestedActions.length} suggested
            </Badge>
          </CardTitle>
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          <Alert className="bg-blue-50 border-blue-300">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <AlertDescription>
              <p className="text-sm text-blue-900 mb-2">
                Based on the OASIS analysis, I've identified <strong>{suggestedActions.length}</strong> recommended actions.
                Review and select which tasks to create automatically.
              </p>
              <div className="flex gap-4 text-xs text-blue-700 mt-2">
                <span>🔴 {suggestedActions.filter(a => a.priority === 'high').length} High Priority</span>
                <span>🟡 {suggestedActions.filter(a => a.priority === 'medium').length} Medium</span>
                <span>🔵 {suggestedActions.filter(a => a.priority === 'low').length} Low</span>
              </div>
            </AlertDescription>
          </Alert>

          <ScrollArea className="h-96">
            <div className="space-y-3 pr-4">
              {suggestedActions.map((action, idx) => (
                <div
                  key={idx}
                  className={`border-2 rounded-lg p-4 transition-all ${
                    selectedActions.includes(idx)
                      ? 'bg-white border-navy-400 shadow-md'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedActions.includes(idx)}
                      onCheckedChange={() => handleToggleAction(idx)}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {getImpactIcon(action.impact_category)}
                          <h4 className="font-semibold text-slate-900">{action.title}</h4>
                        </div>
                        <Badge className={getPriorityColor(action.priority)}>
                          {action.priority}
                        </Badge>
                      </div>

                      <p className="text-sm text-slate-700">{action.description}</p>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-1 text-slate-600">
                          <Clock className="w-3 h-3" />
                          Due in {action.due_in_days} days
                        </div>
                        <div className="flex items-center gap-1 text-slate-600">
                          <Users className="w-3 h-3" />
                          {action.assign_to_role || 'Clinician'}
                        </div>
                      </div>

                      <div className="bg-navy-50 p-2 rounded text-xs border border-navy-200">
                        <p className="text-navy-900">
                          <strong>Why:</strong> {action.reason}
                        </p>
                      </div>

                      {action.estimated_revenue_impact && (
                        <div className="bg-green-50 p-2 rounded text-xs border border-green-200">
                          <p className="text-green-900">
                            <strong>💰 Revenue Impact:</strong> {action.estimated_revenue_impact}
                          </p>
                        </div>
                      )}

                      {action.compliance_risk_if_ignored && (
                        <div className="bg-orange-50 p-2 rounded text-xs border border-orange-200">
                          <p className="text-orange-900">
                            <strong>⚠️ Risk if Ignored:</strong> {action.compliance_risk_if_ignored}
                          </p>
                        </div>
                      )}

                      <p className="text-xs text-slate-500 italic">
                        Source: {action.source_finding}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-slate-600">
              <span className="font-medium">{selectedActions.length}</span> action{selectedActions.length !== 1 ? 's' : ''} selected
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedActions([])}
                disabled={selectedActions.length === 0}
              >
                Clear Selection
              </Button>
              <Button
                size="sm"
                onClick={handleCreateTasks}
                disabled={selectedActions.length === 0 || createTasksMutation.isPending}
                className="bg-navy-600 hover:bg-navy-700"
              >
                {createTasksMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating Tasks...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Create {selectedActions.length} Task{selectedActions.length !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}