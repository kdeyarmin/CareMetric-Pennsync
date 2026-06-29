import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Bell,
  Target,
  DollarSign,
  Shield
} from "lucide-react";

export default function OASISTaskGenerator({ 
  analysisResults, 
  _pdgmData, 
  patientId,
  patientName,
  onTasksCreated 
}) {
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [tasksCreated, setTasksCreated] = useState(false);

  const queryClient = useQueryClient();

  const createTaskMutation = useMutation({
    mutationFn: (taskData) => base44.entities.Task.create(taskData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // Generate suggested tasks based on analysis
  useEffect(() => {
    if (!analysisResults) return;

    const tasks = [];
    // setDate() mutates the receiver, so chaining off the same `now` made
    // nextWeek = today+7 (the +6 was applied on top of the already-advanced
    // tomorrow). Compute each offset from a fresh date.
    // Local calendar date — toISOString() converts to UTC and would roll the due
    // date a day late when generated in the evening in any US timezone.
    const addDaysLocal = (n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const tomorrow = addDaysLocal(1);
    const nextWeek = addDaysLocal(6);

    // Critical accuracy issues
    if (analysisResults.accuracy_score < 70) {
      tasks.push({
        id: 'accuracy_review',
        title: `OASIS Accuracy Review Required - ${patientName}`,
        description: `OASIS accuracy score is ${analysisResults.accuracy_score}%. Review and correct documentation issues identified in analysis.`,
        type: 'document',
        priority: 'high',
        due_date: tomorrow,
        source: 'ai_generated',
        ai_reason: `Low accuracy score (${analysisResults.accuracy_score}%) detected in OASIS analysis`,
        category: 'accuracy',
        icon: AlertTriangle
      });
    }

    // Critical compliance concerns
    const criticalCompliance = analysisResults.compliance_concerns?.filter(c => c.severity === 'high') || [];
    if (criticalCompliance.length > 0) {
      tasks.push({
        id: 'compliance_fix',
        title: `Address ${criticalCompliance.length} Compliance Issue(s) - ${patientName}`,
        description: `Critical compliance concerns identified: ${criticalCompliance.map(c => c.area).join(', ')}. Immediate review required.`,
        type: 'document',
        priority: 'high',
        due_date: tomorrow,
        source: 'ai_generated',
        ai_reason: `${criticalCompliance.length} high-severity compliance issue(s) detected`,
        category: 'compliance',
        icon: Shield
      });
    }

    // High revenue optimization opportunities
    const highRevenueTips = analysisResults.revenue_tips?.filter(t => t.potential_impact === 'high') || [];
    if (highRevenueTips.length > 0) {
      tasks.push({
        id: 'revenue_optimize',
        title: `Revenue Optimization Opportunity - ${patientName}`,
        description: `${highRevenueTips.length} high-impact revenue optimization opportunities identified. Review functional scores and documentation.`,
        type: 'document',
        priority: 'medium',
        due_date: nextWeek,
        source: 'ai_generated',
        ai_reason: `Potential revenue increase: ${highRevenueTips.map(t => t.estimated_revenue_impact || 'significant').join(', ')}`,
        category: 'revenue',
        icon: DollarSign
      });
    }

    // Audit risk areas
    const highAuditRisks = analysisResults.audit_risk_areas?.filter(r => r.risk_level === 'high') || [];
    if (highAuditRisks.length > 0) {
      tasks.push({
        id: 'audit_mitigation',
        title: `Audit Risk Mitigation - ${patientName}`,
        description: `High audit risk areas identified: ${highAuditRisks.map(r => r.area).join(', ')}. Review documentation for compliance.`,
        type: 'document',
        priority: 'high',
        due_date: tomorrow,
        source: 'ai_generated',
        ai_reason: `${highAuditRisks.length} high audit risk area(s) require attention`,
        category: 'audit',
        icon: Target
      });
    }

    // Validation critical issues
    const criticalValidation = analysisResults.validation_summary?.issues?.filter(i => i.severity === 'critical') || [];
    if (criticalValidation.length > 0) {
      tasks.push({
        id: 'validation_fix',
        title: `OASIS Validation Errors - ${patientName}`,
        description: `${criticalValidation.length} critical validation issue(s) found. Items: ${criticalValidation.map(i => i.item).join(', ')}`,
        type: 'document',
        priority: 'high',
        due_date: tomorrow,
        source: 'ai_generated',
        ai_reason: 'Critical OASIS validation errors detected that may affect payment',
        category: 'validation',
        icon: AlertTriangle
      });
    }

    // Low overall score
    if (analysisResults.overall_score < 60) {
      tasks.push({
        id: 'overall_review',
        title: `Comprehensive OASIS Review - ${patientName}`,
        description: `Overall OASIS score is ${analysisResults.overall_score}%. Comprehensive review recommended to improve documentation quality.`,
        type: 'document',
        priority: 'high',
        due_date: tomorrow,
        source: 'ai_generated',
        ai_reason: `Low overall score indicates significant documentation quality issues`,
        category: 'quality',
        icon: ClipboardList
      });
    }

    setSuggestedTasks(tasks);
    setSelectedTasks(tasks.filter(t => t.priority === 'high').map(t => t.id));
  }, [analysisResults, patientName]);

  const handleCreateTasks = async () => {
    // assigned_to is required on Task; resolve the user up front and abort if we
    // can't, so we never attempt a create with assigned_to undefined (which the
    // backend rejects). Done before setIsCreating(true) so the button isn't stuck.
    const currentUser = await base44.auth.me().catch(() => null);
    if (!currentUser?.email) {
      toast.error('Could not determine the current user. Please refresh and try again.');
      return;
    }
    setIsCreating(true);

    try {
      const tasksToCreate = suggestedTasks.filter(t => selectedTasks.includes(t.id));

      for (const task of tasksToCreate) {
        await createTaskMutation.mutateAsync({
          patient_id: patientId || null,
          assigned_to: currentUser?.email,
          title: task.title,
          description: task.description,
          type: task.type,
          priority: task.priority,
          due_date: task.due_date,
          source: task.source,
          ai_reason: task.ai_reason,
          status: 'pending'
        });
      }

      setTasksCreated(true);
      onTasksCreated?.(tasksToCreate.length);
      toast.success(`Created ${tasksToCreate.length} task${tasksToCreate.length === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error("Error creating tasks:", err);
      toast.error("Some tasks couldn't be created. Please try again.");
    }
    
    setIsCreating(false);
  };

  const toggleTask = (taskId) => {
    setSelectedTasks(prev => 
      prev.includes(taskId) 
        ? prev.filter(id => id !== taskId)
        : [...prev, taskId]
    );
  };

  if (!analysisResults || suggestedTasks.length === 0) return null;

  const getCategoryColor = (category) => {
    const colors = {
      accuracy: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      compliance: 'bg-red-100 text-red-800 border-red-300',
      revenue: 'bg-green-100 text-green-800 border-green-300',
      audit: 'bg-orange-100 text-orange-800 border-orange-300',
      validation: 'bg-navy-100 text-navy-800 border-navy-300',
      quality: 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[category] || 'bg-slate-100 text-slate-800';
  };

  return (
    <Card className="border-2 border-amber-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-600" />
            Auto-Generated Tasks
          </div>
          <Badge variant="outline">{suggestedTasks.length} suggested</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {tasksCreated ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">
              {selectedTasks.length} task(s) created successfully and assigned to your task list.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Based on the OASIS analysis, the following tasks are recommended:
            </p>

            <div className="space-y-3">
              {suggestedTasks.map((task) => {
                const Icon = task.icon;
                return (
                  <div 
                    key={task.id}
                    className={`p-3 rounded-lg border-2 transition-colors ${
                      selectedTasks.includes(task.id) 
                        ? 'bg-amber-50 border-amber-300' 
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedTasks.includes(task.id)}
                        onCheckedChange={() => toggleTask(task.id)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Icon className="w-4 h-4 text-slate-600" />
                          <span className="font-medium text-sm">{task.title}</span>
                          <Badge className={`text-xs ${getCategoryColor(task.category)}`}>
                            {task.category}
                          </Badge>
                          <Badge className={task.priority === 'high' ? 'bg-red-600 text-white' : 'bg-yellow-500 text-white'}>
                            {task.priority}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-600 mb-1">{task.description}</p>
                        <p className="text-xs text-blue-600">Due: {task.due_date}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Button
              onClick={handleCreateTasks}
              disabled={isCreating || selectedTasks.length === 0}
              className="w-full bg-amber-600 hover:bg-amber-700"
            >
              {isCreating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating Tasks...</>
              ) : (
                <><ClipboardList className="w-4 h-4 mr-2" /> Create {selectedTasks.length} Task(s)</>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}