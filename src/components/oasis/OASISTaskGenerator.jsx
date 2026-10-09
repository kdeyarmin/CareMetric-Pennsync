import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { manageOASISRecords, oasisClientKey } from "@/functions/manageOASISRecords";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ClipboardList,
  AlertTriangle,
  Bell,
  Target,
  Shield,
  CheckCircle2,
  Loader2
} from "lucide-react";

/**
 * Suggests follow-up tasks from an OASIS analysis and, on the clinician's click,
 * creates the selected ones on the patient's chart. Creation goes through the
 * OASIS record broker, which first confirms this clinician may open the chart
 * (agency lead, recorded creator, or an active care-team seat), assigns each
 * task to the clinician, and keys every task per finding so a repeat click or a
 * retry after a dropped response files nothing twice.
 */
export default function OASISTaskGenerator({
  analysisResults,
  _pdgmData,
  patientId,
  patientName,
  analysisId,
  onTasksCreated,
}) {
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createdIds, setCreatedIds] = useState([]);
  const queryClient = useQueryClient();

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
        ai_reason: 'Critical OASIS validation errors require clinician review',
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
    setCreatedIds([]);
  }, [analysisResults, patientName]);

  const createSelectedTasks = async () => {
    if (!patientId || selectedTasks.length === 0) return;
    const chosen = suggestedTasks.filter((task) => selectedTasks.includes(task.id) && !createdIds.includes(task.id));
    if (chosen.length === 0) return;
    setCreating(true);
    try {
      const { results = [] } = await manageOASISRecords('create_tasks', {
        patient_id: patientId,
        tasks: chosen.map((task) => ({
          key: oasisClientKey('oasis-task', patientId, analysisId, task.id),
          title: task.title,
          description: task.description,
          type: task.type,
          priority: task.priority,
          due_date: task.due_date,
          ai_reason: task.ai_reason,
        })),
      });
      const done = chosen.filter((task, index) => ['created', 'existing'].includes(results[index]?.status));
      setCreatedIds((prev) => [...new Set([...prev, ...done.map((task) => task.id)])]);
      if (done.length) {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        onTasksCreated?.(done.length);
      }
      if (done.length === chosen.length) {
        toast.success(`${done.length} task${done.length === 1 ? '' : 's'} added to this patient.`);
      } else {
        toast.error(`${done.length} of ${chosen.length} tasks were added. Try the rest again.`);
      }
    } catch (error) {
      toast.error(error?.message || "The tasks could not be created. Please try again.");
    } finally {
      setCreating(false);
    }
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
        {!patientId && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-900">
              Link this analysis to a patient to add these tasks to their chart.
            </AlertDescription>
          </Alert>
        )}
            <p className="text-sm text-slate-600">
              Based on the OASIS analysis, select the follow-up tasks to add for this patient:
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
                        disabled={createdIds.includes(task.id)}
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
                        {createdIds.includes(task.id) && (
                          <p className="text-xs text-green-700 flex items-center gap-1 mt-1">
                            <CheckCircle2 className="w-3 h-3" /> Added to tasks
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Button
              onClick={createSelectedTasks}
              disabled={creating || !patientId || selectedTasks.every((id) => createdIds.includes(id))}
              className="w-full"
            >
              {creating
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding tasks…</>
                : <><ClipboardList className="mr-2 h-4 w-4" /> Add {selectedTasks.filter((id) => !createdIds.includes(id)).length} selected task(s)</>}
            </Button>
      </CardContent>
    </Card>
  );
}
