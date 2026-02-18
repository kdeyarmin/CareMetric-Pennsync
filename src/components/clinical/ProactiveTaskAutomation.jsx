import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Brain, Loader2, ListChecks, UserCheck, ArrowRightLeft, AlertTriangle,
  ChevronDown, ChevronUp, CheckCircle2, Sparkles, RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import TaskResultList from "./TaskResultList";

export default function ProactiveTaskAutomation({ patientId, patientName }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState({});
  const [results, setResults] = useState({});
  const [expanded, setExpanded] = useState(true);
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepResult, setSweepResult] = useState(null);

  const runAction = async (action) => {
    setLoading(prev => ({ ...prev, [action]: true }));
    const { data } = await base44.functions.invoke("aiClinicalWorkflowAutomation", {
      action,
      patient_id: patientId,
    });
    setResults(prev => ({ ...prev, [action]: data.data }));
    setLoading(prev => ({ ...prev, [action]: false }));
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["patientTasks", patientId] });
    toast.success(`${data.data.tasks_created} task(s) created`);
  };

  const runFullSweep = async () => {
    setSweepLoading(true);
    const { data } = await base44.functions.invoke("aiClinicalWorkflowAutomation", {
      action: "proactive_task_sweep",
      patient_id: patientId,
    });
    setSweepResult(data.data);
    setResults({
      create_followup_tasks: data.data.followup_tasks,
      create_referral_tasks: data.data.referral_tasks,
      create_alert_tasks: data.data.alert_tasks,
    });
    setSweepLoading(false);
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["patientTasks", patientId] });
    toast.success(`${data.data.total_tasks_created} total task(s) created`);
  };

  const SECTIONS = [
    {
      key: "create_followup_tasks",
      label: "Follow-Up Tasks",
      desc: "Auto-create tasks for patients needing attention based on vitals, compliance, and care gaps",
      icon: UserCheck,
      color: "text-blue-600",
    },
    {
      key: "create_referral_tasks",
      label: "Referral Tasks",
      desc: "Generate referral and care plan adjustment tasks from AI-detected clinical needs",
      icon: ArrowRightLeft,
      color: "text-indigo-600",
    },
    {
      key: "create_alert_tasks",
      label: "Alert Response Tasks",
      desc: "Create tasks from critical alerts, risk predictions, and patient deterioration signals",
      icon: AlertTriangle,
      color: "text-amber-600",
    },
  ];

  return (
    <Card>
      <CardHeader className="p-3 sm:p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-blue-500" />
            Proactive Task Automation
            {patientName && (
              <Badge variant="outline" className="text-[10px] font-normal">{patientName}</Badge>
            )}
          </CardTitle>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-7 text-[10px] bg-blue-600 hover:bg-blue-700"
              onClick={runFullSweep}
              disabled={sweepLoading || Object.values(loading).some(Boolean)}
            >
              {sweepLoading ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3 mr-1" />
              )}
              Run All
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
          {/* Sweep summary */}
          {sweepResult && (
            <div className="p-2.5 rounded-lg bg-gradient-to-br from-blue-100/40 to-slate-100/60 border border-blue-200/30 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
              <p className="text-[11px] text-slate-700">
                <strong>{sweepResult.total_tasks_created} tasks</strong> created across all categories
              </p>
            </div>
          )}

          {/* Three task categories */}
          <div className="grid grid-cols-1 gap-2">
            {SECTIONS.map(({ key, label, desc, icon: Icon, color }) => {
              const isLoading = loading[key];
              const result = results[key];

              return (
                <div key={key} className="rounded-lg border border-slate-200/60 bg-white/40 dark:bg-slate-900/30 p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800">{label}</p>
                        <p className="text-[10px] text-slate-500">{desc}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={result ? "ghost" : "outline"}
                      className="h-6 text-[10px] shrink-0"
                      onClick={() => runAction(key)}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : result ? (
                        <><RefreshCw className="w-3 h-3 mr-1" /> Re-run</>
                      ) : (
                        <><Brain className="w-3 h-3 mr-1" /> Generate</>
                      )}
                    </Button>
                  </div>

                  {isLoading && (
                    <div className="py-3 text-center">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500 mx-auto mb-1" />
                      <p className="text-[10px] text-slate-400">Analyzing patient data...</p>
                    </div>
                  )}

                  {result && !isLoading && <TaskResultList result={result} />}
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}