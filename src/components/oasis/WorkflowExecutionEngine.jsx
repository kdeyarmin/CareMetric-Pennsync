import { useState, useEffect, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Zap, CheckCircle2, XCircle, AlertTriangle, Play, Info } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { format, addDays } from "date-fns";
import { deriveActionTypes, evaluateRuleTrigger } from "@/components/oasis/workflowEngineUtils";
import { sendInAppNotification } from "@/lib/notify";
import { ALL_ROWS, PATIENT_HISTORY_ROWS } from '@/lib/queryLimits';

const ACTION_LABELS = {
  create_task: "Create task",
  create_alert: "Create alert",
  notify_clinician: "Notify clinician",
  flag_for_review: "Flag for review"
};

/**
 * Renders UI for evaluating and executing automation rules against the provided analysis and PDGM data.
 *
 * Evaluates active automation rules, runs configured actions (tasks, alerts, notifications, flags),
 * persists workflow execution records, and displays execution controls, progress, errors, and results.
 *
 * @param {Object} props - Component props.
 * @param {Object} props.analysisResults - Analysis results used to evaluate automation rule triggers; required for execution.
 * @param {Object} [props.pdgmData] - Optional PDGM-related data that can be used by rule evaluations.
 * @param {string} [props.patientId] - Optional patient identifier used when creating tasks/alerts and for execution context.
 * @param {string} [props.patientName] - Optional patient name included in persisted workflow records.
 * @param {string} [props.oasisUploadId] - Optional upload identifier used to derive an execution key for auto-execution deduplication.
 * @param {boolean} [props.autoExecute=true] - If true, automatically triggers workflow execution when the execution context changes and no prior results exist.
 * @returns {JSX.Element|null} A card-based UI that provides controls to run workflows, shows execution progress/status, and lists per-rule execution results; returns null when `analysisResults` is not provided.
 */
export default function WorkflowExecutionEngine({
  analysisResults,
  pdgmData,
  patientId,
  patientName,
  oasisUploadId,
  autoExecute = true
}) {
  const [executing, setExecuting] = useState(false);
  const executingRef = useRef(false);
  const [executionResults, setExecutionResults] = useState([]);
  const [progress, setProgress] = useState(0);
  const [lastExecutionError, setLastExecutionError] = useState("");
  const [lastRunSummary, setLastRunSummary] = useState(null);
  const [currentRunId, setCurrentRunId] = useState("");
  const queryClient = useQueryClient();

  // Generate deterministic idempotency key. Keyed on the upload/patient rather
  // than the full analysis JSON so a re-run of the LLM analysis for the same
  // upload maps to the same key instead of minting a fresh one.
  const generateIdempotencyKey = useCallback(() => {
    if (!analysisResults && !pdgmData) return null;

    const parts = [];
    if (oasisUploadId) parts.push(`upload:${oasisUploadId}`);
    if (patientId) parts.push(`patient:${patientId}`);

    // Without an upload/patient anchor, fall back to a compact analysis
    // fingerprint so ad-hoc analyses still get a key.
    if (parts.length === 0 && analysisResults) {
      parts.push(`analysis:${JSON.stringify({
        overall_score: analysisResults.overall_score ?? null,
        accuracy_score: analysisResults.accuracy_score ?? null,
        compliance_score: analysisResults.compliance_score ?? null
      })}`);
    }

    return parts.join('|');
  }, [oasisUploadId, patientId, analysisResults, pdgmData]);

  const { data: automationRules, isLoading: isLoadingRules, error: rulesError } = useQuery({
    // Active-only, and it must NOT share the bare ['automationRules'] entry
    // that OASISAutomationSettings / WorkflowMonitoringDashboard fill with
    // EVERY rule: this list is what executeWorkflows() iterates and runs, so a
    // shared cache let deactivated rules execute (and rendered them as
    // "N active automation rules ready") whenever an admin had opened the
    // settings page first. Prefix-invalidated by the settings page's writes.
    queryKey: ['automationRules', 'active'],
    queryFn: () => base44.entities.OASISAutomationRule.filter({ is_active: true }, undefined, ALL_ROWS)
  });

  const { data: currentUser, isLoading: isLoadingUser, error: userError } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const createWorkflowMutation = useMutation({
    mutationFn: (data) => base44.entities.OASISWorkflowExecution.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflowExecutions"] });
    }
  });

  const createTaskMutation = useMutation({
    mutationFn: (data) => base44.entities.Task.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }
  });

  const createAlertMutation = useMutation({
    mutationFn: (data) => base44.entities.PatientAlert.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patientAlerts"] });
    }
  });

  const evaluateRule = useCallback((rule, analysis, pdgm) => evaluateRuleTrigger(rule, analysis, pdgm), []);

  const executeSingleAction = useCallback(async (actionType, rule, triggerContext) => {
    const config = rule.action_config || {};

    switch (actionType) {
      case "create_task": {
        try {
          const task = await createTaskMutation.mutateAsync({
            patient_id: patientId,
            // assigned_to is required on Task; without it the create is rejected.
            assigned_to: config.assignee_email || currentUser?.email,
            title: config.task_title_template || `${rule.rule_name} - Action Required`,
            description: `${config.task_description_template || `Automated workflow triggered: ${rule.description}`}\n\nTrigger context: ${JSON.stringify(triggerContext)}`,
            type: config.task_type || "other",
            priority: config.task_priority || "medium",
            due_date: config.due_in_days
              // Local calendar date: toISOString() would give the UTC date,
              // which is already "tomorrow" for evening users in US timezones.
              ? format(addDays(new Date(), config.due_in_days), "yyyy-MM-dd")
              : null,
            source: "ai_generated",
            ai_reason: triggerContext.reason || "Automation rule triggered"
          });

          return {
            action_type: "create_task",
            status: "completed",
            result: task,
            executed_at: new Date().toISOString()
          };
        } catch (error) {
          return {
            action_type: "create_task",
            status: "failed",
            error: error.message,
            executed_at: new Date().toISOString()
          };
        }
      }

      case "create_alert": {
        if (!patientId) {
          return {
            action_type: "create_alert",
            status: "skipped",
            error: "Patient ID is required to create alerts",
            executed_at: new Date().toISOString()
          };
        }

        try {
          const alert = await createAlertMutation.mutateAsync({
            patient_id: patientId,
            alert_type: "documentation_risk",
            severity: config.task_priority || "medium",
            title: rule.rule_name,
            message: config.notification_message || rule.description,
            contributing_factors: [triggerContext.reason || "Automated rule trigger"],
            recommended_actions: [config.task_description_template || "Review OASIS assessment"],
            status: "active"
          });

          return {
            action_type: "create_alert",
            status: "completed",
            result: alert,
            executed_at: new Date().toISOString()
          };
        } catch (error) {
          return {
            action_type: "create_alert",
            status: "failed",
            error: error.message,
            executed_at: new Date().toISOString()
          };
        }
      }

      case "notify_clinician": {
        // Don't mark as sent until currentUser.email is actually available
        const recipientEmail = currentUser?.email;
        if (!recipientEmail) {
          return {
            action_type: "notify_clinician",
            status: "failed",
            error: "Recipient email not available",
            executed_at: new Date().toISOString()
          };
        }
        // Actually create the in-app notification (this was previously a no-op that
        // still reported "completed", so no clinician was ever notified).
        try {
          const message = config.notification_message || "OASIS workflow triggered";
          await sendInAppNotification({
            user_email: recipientEmail,
            title: rule.rule_name || "OASIS workflow",
            message,
            type: "compliance_alert",
            priority: config.task_priority || "medium",
          });
          return {
            action_type: "notify_clinician",
            status: "completed",
            result: {
              recipient: recipientEmail,
              message,
              sent_at: new Date().toISOString()
            },
            executed_at: new Date().toISOString()
          };
        } catch (error) {
          return {
            action_type: "notify_clinician",
            status: "failed",
            error: error.message,
            executed_at: new Date().toISOString()
          };
        }
      }

      case "flag_for_review":
        return {
          action_type: "flag_for_review",
          status: "completed",
          result: { flagged: true },
          executed_at: new Date().toISOString()
        };

      default:
        return {
          action_type: actionType || "unknown_action",
          status: "failed",
          error: "Unsupported action type",
          executed_at: new Date().toISOString()
        };
    }
  }, [createAlertMutation, createTaskMutation, currentUser?.email, patientId]);

  const executeActions = useCallback(async (rule, triggerContext) => {
    const actionTypes = deriveActionTypes(rule);

    if (actionTypes.length === 0) {
      return [{
        action_type: "unknown_action",
        status: "skipped",
        error: "No actions configured for rule",
        executed_at: new Date().toISOString()
      }];
    }

    const results = [];
    for (const actionType of actionTypes) {
      const actionResult = await executeSingleAction(actionType, rule, triggerContext);
      results.push(actionResult);
    }
    return results;
  }, [executeSingleAction]);

  const executeWorkflows = useCallback(async () => {
    if (executingRef.current || !analysisResults || !automationRules || automationRules.length === 0) {
      return;
    }

    // Check idempotency before executing
    const idempotencyKey = generateIdempotencyKey();
    if (!idempotencyKey) return;

    // Fast path: skip if this session already ran this key. The query cache is
    // in-memory only, so the persisted OASISWorkflowExecution records below are
    // the real cross-reload dedupe.
    const executedWorkflows = queryClient.getQueryData(['executedWorkflows']) || {};
    if (executedWorkflows[idempotencyKey]) {
      return;
    }

    executingRef.current = true;
    setExecuting(true);
    setProgress(10);
    setLastExecutionError("");
    const startTime = Date.now();
    const runId = `wf-${startTime}`;
    setCurrentRunId(runId);
    const results = [];

    try {
      // Server-side dedupe: skip rules that already have a persisted execution
      // for this upload, so reloads/re-analyses don't create duplicate
      // Tasks/PatientAlerts/executions.
      let executedRuleIds = new Set();
      if (oasisUploadId) {
        try {
          const previousExecutions = await base44.entities.OASISWorkflowExecution.filter({
            oasis_upload_id: oasisUploadId
          }, undefined, PATIENT_HISTORY_ROWS);
          executedRuleIds = new Set(
            previousExecutions.map((execution) => execution.automation_rule_id).filter(Boolean)
          );
        } catch (error) {
          console.error("Failed to load previous workflow executions:", error);
        }
      }

      const totalRules = automationRules.length;
      let processedRules = 0;

      for (const rule of automationRules) {
        const triggerResult = evaluateRule(rule, analysisResults, pdgmData);

        if (triggerResult.triggered && !executedRuleIds.has(rule.id)) {
          const workflowResult = {
            rule_id: rule.id,
            rule_name: rule.rule_name,
            triggered: true,
            trigger_reason: triggerResult.reason,
            actions: [],
            status: "running"
          };

          try {
            const actionResults = await executeActions(rule, triggerResult);
            const completedActions = actionResults.filter((action) => action.status === "completed").length;
            const failedActions = actionResults.filter((action) => action.status === "failed").length;

            workflowResult.actions = actionResults;
            workflowResult.status = failedActions === 0 && completedActions === actionResults.length
              ? "completed"
              : failedActions > 0
                ? "failed"
                : "partially_completed";

            await createWorkflowMutation.mutateAsync({
              oasis_upload_id: oasisUploadId,
              patient_id: patientId,
              patient_name: patientName,
              automation_rule_id: rule.id,
              rule_name: rule.rule_name,
              trigger_reason: triggerResult.reason,
              trigger_data: triggerResult.context,
              actions_executed: actionResults,
              tasks_created: actionResults
                .filter((action) => action.action_type === "create_task")
                .map((action) => action.result?.id)
                .filter(Boolean),
              alerts_created: actionResults
                .filter((action) => action.action_type === "create_alert")
                .map((action) => action.result?.id)
                .filter(Boolean),
              notifications_sent: actionResults
                .filter((action) => action.action_type === "notify_clinician")
                .map((action) => action.result)
                .filter(Boolean),
              status: workflowResult.status,
              completion_percentage: actionResults.length > 0 ? (completedActions / actionResults.length) * 100 : 0,
              execution_time_ms: Date.now() - startTime,
              outcome_summary: `Executed ${completedActions} of ${actionResults.length} actions`,
              run_id: runId
            });
          } catch (error) {
            workflowResult.status = "failed";
            workflowResult.error = error.message;
          }

          results.push(workflowResult);
        }

        processedRules += 1;
        const percent = Math.min(95, Math.round((processedRules / totalRules) * 100));
        setProgress(percent);
      }

      setExecutionResults(results);
      const completedRules = results.filter((result) => result.status === "completed").length;
      const failedRules = results.filter((result) => result.status === "failed").length;
      const partiallyCompletedRules = results.filter((result) => result.status === "partially_completed").length;

      setLastRunSummary({
        runAt: new Date().toISOString(),
        triggeredRules: results.length,
        completedRules,
        failedRules,
        partiallyCompletedRules,
        runId
      });
      setProgress(100);

      // Remember this run in-session; cross-reload dedupe relies on the
      // persisted OASISWorkflowExecution records checked above.
      const updatedExecutedWorkflows = { ...executedWorkflows, [idempotencyKey]: true };
      queryClient.setQueryData(['executedWorkflows'], updatedExecutedWorkflows);
    } catch (error) {
      console.error("Workflow execution error:", error);
      setLastExecutionError(error.message || "Workflow execution failed");
      setProgress(0);
    } finally {
      executingRef.current = false;
      setExecuting(false);
    }
  }, [
    analysisResults,
    automationRules,
    createWorkflowMutation,
    evaluateRule,
    executeActions,
    oasisUploadId,
    patientId,
    patientName,
    pdgmData,
    generateIdempotencyKey,
    queryClient
  ]);

  useEffect(() => {
    // Wait for user data to load before auto-executing (needed for notify_clinician)
    if (isLoadingUser || !currentUser?.email) {
      return;
    }

    if (!autoExecute || !analysisResults || executing || isLoadingRules) {
      return;
    }

    // Don't auto-execute if rules haven't loaded or if there are no rules
    if (!automationRules || automationRules.length === 0) {
      return;
    }

    // Check idempotency before auto-executing
    const idempotencyKey = generateIdempotencyKey();
    if (!idempotencyKey) return;

    const executedWorkflows = queryClient.getQueryData(['executedWorkflows']) || {};
    if (executedWorkflows[idempotencyKey]) {
      return;
    }

    executeWorkflows();
  }, [autoExecute, executeWorkflows, analysisResults, executing, automationRules, isLoadingRules, isLoadingUser, currentUser?.email, generateIdempotencyKey, queryClient]);

  if (!analysisResults) return null;

  // Show loading state while rules are loading
  if (isLoadingRules || isLoadingUser) {
    return (
      <Card className="border-2 border-navy-300">
        <CardHeader className="bg-gradient-to-r from-navy-50 to-indigo-50">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-navy-600" />
            Automated Workflow Execution
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <Alert className="bg-blue-50 border-blue-200">
            <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
            <AlertDescription className="text-blue-800">
              Loading automation rules and user data...
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Show error state if rules or user data failed to load
  if (rulesError || userError) {
    return (
      <Card className="border-2 border-navy-300">
        <CardHeader className="bg-gradient-to-r from-navy-50 to-indigo-50">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-navy-600" />
            Automated Workflow Execution
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <Alert className="bg-red-50 border-red-200">
            <XCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">
              {rulesError ? `Failed to load automation rules: ${rulesError.message}` : `Failed to load user data: ${userError.message}`}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-300">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-indigo-50">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-navy-600" />
            Automated Workflow Execution
          </CardTitle>
          <Button
            onClick={executeWorkflows}
            disabled={executing || !automationRules || automationRules.length === 0}
            size="sm"
            className="bg-navy-600 hover:bg-navy-700"
          >
            {executing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Executing...</>
            ) : (
              <><Play className="w-4 h-4 mr-2" /> Run Workflows</>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {executing && (
          <div className="mb-4">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-slate-500 mt-2">Evaluating rules and executing actions... {currentRunId}</p>
          </div>
        )}

        {!!lastExecutionError && (
          <Alert className="mb-4 bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">
              {lastExecutionError}
            </AlertDescription>
          </Alert>
        )}

        {lastRunSummary && (
          <Alert className="mb-4 bg-navy-50 border-navy-200">
            <Info className="w-4 h-4 text-navy-700" />
            <AlertDescription className="text-navy-900 text-xs">
              Last run at {new Date(lastRunSummary.runAt).toLocaleString()} ({lastRunSummary.runId}): {lastRunSummary.triggeredRules} triggered,
              {" "}{lastRunSummary.completedRules} completed, {lastRunSummary.failedRules} failed
              {lastRunSummary.partiallyCompletedRules > 0 && `, ${lastRunSummary.partiallyCompletedRules} partially completed`}.
            </AlertDescription>
          </Alert>
        )}

        {automationRules && automationRules.length === 0 && !executing && (
          <Alert className="mb-4 bg-blue-50 border-blue-200">
            <Info className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              No active automation rules are configured yet.
            </AlertDescription>
          </Alert>
        )}

        {executionResults.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">
              Workflows Triggered: {executionResults.length}
            </p>
            {executionResults.map((result, idx) => (
              <Card
                key={`${result.rule_id}-${idx}`}
                className={`border-l-4 ${
                  result.status === "completed"
                    ? "border-l-green-500 bg-green-50"
                    : result.status === "failed"
                      ? "border-l-red-500 bg-red-50"
                      : "border-l-yellow-500 bg-yellow-50"
                }`}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-slate-900">{result.rule_name}</p>
                      <p className="text-xs text-slate-600">{result.trigger_reason}</p>
                    </div>
                    {result.status === "completed" && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                    {result.status === "failed" && <XCircle className="w-5 h-5 text-red-600" />}
                    {result.status === "partially_completed" && <AlertTriangle className="w-5 h-5 text-yellow-600" />}
                  </div>

                  {result.actions.length > 0 && (
                    <div className="space-y-1 mt-2">
                      {result.actions.map((action, actionIndex) => (
                        <div key={`${action.action_type}-${actionIndex}`} className="flex items-center gap-2 text-sm">
                          {action.status === "completed" && <CheckCircle2 className="w-3 h-3 text-green-600" />}
                          {(action.status === "failed" || action.status === "skipped") && <XCircle className="w-3 h-3 text-red-600" />}
                          <span className="text-slate-700">
                            {ACTION_LABELS[action.action_type] || action.action_type.replace(/_/g, " ")}
                          </span>
                          {(action.status === "failed" || action.status === "skipped") && action.error && (
                            <span className="text-xs text-red-600">({action.error})</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!executing && executionResults.length === 0 && automationRules && automationRules.length > 0 && (
          <Alert className="bg-blue-50 border-blue-200">
            <Zap className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              {automationRules.length} active automation rules ready. Click "Run Workflows" to execute.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
