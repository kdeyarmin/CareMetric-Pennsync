import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Zap, CheckCircle2, XCircle, AlertTriangle, Play, Info } from "lucide-react";
import { manageOASISRecords } from "@/functions/manageOASISRecords";

const ACTION_LABELS = {
  create_task: "Create task",
  create_alert: "Create alert",
  notify_clinician: "Notify clinician",
  flag_for_review: "Flag for review"
};

// Released by the owner on 2026-10-08 ("turn everything on"). Automation runs
// on the SERVER, inside the OASIS record broker, against the saved analysis:
// the broker confirms the caller may open the chart before any task, alert or
// notification is written, evaluates the active rules from the analysis it
// stored (not from anything this browser sends), and claims each (upload, rule)
// run once — a reload, a second tab or a retry re-reports the first run instead
// of acting twice. This flag is the deployment's switch-off, pinned off.
const OASIS_AUTOMATION_EXECUTION_PAUSED = false;

/**
 * Shows the automation rules that fire for a saved OASIS analysis and runs them
 * through the server broker.
 *
 * @param {Object} props
 * @param {Object} props.analysisResults - The analysis on screen; required to render.
 * @param {string} [props.patientId] - The chart the saved analysis is linked to.
 * @param {string} [props.oasisUploadId] - The saved OASISUpload the run is anchored to.
 * @param {boolean} [props.autoExecute=true] - Run once automatically when the
 *   analysis is saved, linked to a chart, and at least one rule is active.
 */
export default function WorkflowExecutionEngine({
  analysisResults,
  patientId,
  oasisUploadId,
  autoExecute = true
}) {
  const queryClient = useQueryClient();
  const [executionResults, setExecutionResults] = useState(null);
  const [lastRunAt, setLastRunAt] = useState(null);
  const autoRanForRef = useRef(null);

  const { data: automationRules, isLoading: isLoadingRules, error: rulesError } = useQuery({
    // Active-only: this list is what a run evaluates, so it must not share the
    // settings page's every-rule entry. Prefix-invalidated by the settings writes.
    queryKey: ['oasisAutomationRules', 'active'],
    queryFn: async () => ((await manageOASISRecords('list_rules'))?.rules || []).filter((rule) => rule.is_active === true),
    enabled: !OASIS_AUTOMATION_EXECUTION_PAUSED,
  });

  const runMutation = useMutation({
    mutationFn: () => manageOASISRecords('execute_workflows', { upload_id: oasisUploadId }),
    onSuccess: (data) => {
      setExecutionResults(Array.isArray(data?.results) ? data.results : []);
      setLastRunAt(new Date().toISOString());
      queryClient.invalidateQueries({ queryKey: ['oasisWorkflowExecutions'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['patientAlerts'] });
      queryClient.invalidateQueries({ queryKey: ['oasisAudits'] });
    },
  });

  const ready = !!oasisUploadId && !!patientId;
  const activeCount = automationRules?.length || 0;

  // Auto-run once per saved upload. The server claims each (upload, rule) run,
  // so this is idempotent even across reloads and tabs.
  useEffect(() => {
    if (OASIS_AUTOMATION_EXECUTION_PAUSED || !autoExecute || !ready || activeCount === 0) return;
    if (autoRanForRef.current === oasisUploadId || runMutation.isPending) return;
    autoRanForRef.current = oasisUploadId;
    runMutation.mutate();
  }, [autoExecute, ready, activeCount, oasisUploadId, runMutation]);

  if (!analysisResults) return null;

  if (OASIS_AUTOMATION_EXECUTION_PAUSED) {
    return (
      <Card className="border-2 border-amber-300">
        <CardHeader className="bg-amber-50">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
            Automated Workflow Execution Paused
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm text-amber-900">
          Automation is switched off for this deployment.
        </CardContent>
      </Card>
    );
  }

  const executing = runMutation.isPending;

  return (
    <Card className="border-2 border-navy-300">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-indigo-50">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-navy-600" />
            Automated Workflow Execution
          </CardTitle>
          <Button
            onClick={() => runMutation.mutate()}
            disabled={executing || !ready || activeCount === 0}
            size="sm"
            className="bg-navy-600 hover:bg-navy-700"
          >
            {executing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running...</>
            ) : (
              <><Play className="w-4 h-4 mr-2" /> Run Workflows</>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {isLoadingRules && (
          <Alert className="bg-blue-50 border-blue-200">
            <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
            <AlertDescription className="text-blue-800">Loading automation rules...</AlertDescription>
          </Alert>
        )}

        {rulesError && (
          <Alert className="bg-red-50 border-red-200">
            <XCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">
              Failed to load automation rules: {rulesError.message}
            </AlertDescription>
          </Alert>
        )}

        {!ready && (
          <Alert className="bg-blue-50 border-blue-200">
            <Info className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              Save this OASIS analysis to a patient's record in the Analyze tab to run automation on it.
            </AlertDescription>
          </Alert>
        )}

        {runMutation.error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">{runMutation.error.message}</AlertDescription>
          </Alert>
        )}

        {automationRules && activeCount === 0 && (
          <Alert className="bg-blue-50 border-blue-200">
            <Info className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              No active automation rules are configured yet.
            </AlertDescription>
          </Alert>
        )}

        {lastRunAt && executionResults && (
          <Alert className="bg-navy-50 border-navy-200">
            <Info className="w-4 h-4 text-navy-700" />
            <AlertDescription className="text-navy-900 text-xs">
              Last run at {new Date(lastRunAt).toLocaleString()}: {executionResults.length} rule
              {executionResults.length === 1 ? "" : "s"} triggered
              {executionResults.some((result) => result.already_executed) && " (rules already run for this analysis were not repeated)"}.
            </AlertDescription>
          </Alert>
        )}

        {executionResults && executionResults.length > 0 && (
          <div className="space-y-3">
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
                      <p className="text-xs text-slate-600">
                        {result.already_executed ? "Already run for this analysis" : result.trigger_reason || result.reason}
                      </p>
                    </div>
                    {result.status === "completed" && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                    {result.status === "failed" && <XCircle className="w-5 h-5 text-red-600" />}
                    {result.status === "partially_completed" && <AlertTriangle className="w-5 h-5 text-yellow-600" />}
                  </div>

                  {Array.isArray(result.actions) && result.actions.length > 0 && (
                    <div className="space-y-1 mt-2">
                      {result.actions.map((action, actionIndex) => (
                        <div key={`${action.action_type}-${actionIndex}`} className="flex items-center gap-2 text-sm">
                          {action.status === "completed" && <CheckCircle2 className="w-3 h-3 text-green-600" />}
                          {(action.status === "failed" || action.status === "skipped") && <XCircle className="w-3 h-3 text-red-600" />}
                          <span className="text-slate-700">
                            {ACTION_LABELS[action.action_type] || String(action.action_type || "").replace(/_/g, " ")}
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

        {executionResults && executionResults.length === 0 && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">No automation rule fired for this analysis.</AlertDescription>
          </Alert>
        )}

        {!executing && !executionResults && ready && activeCount > 0 && (
          <Alert className="bg-blue-50 border-blue-200">
            <Zap className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              {activeCount} active automation rules ready. Click "Run Workflows" to execute.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
