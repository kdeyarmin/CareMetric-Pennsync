import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Zap, Clock, Shield, Loader2, Copy, Plus, CheckCircle2,
  AlertCircle, AlertTriangle, ChevronDown, ChevronUp, RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

function ICD10Section({ codes, loading, onRefresh, onCodesSelected }) {
  const [selected, setSelected] = useState([]);

  const toggle = (code) => {
    setSelected((prev) =>
      prev.find((c) => c.code === code.code)
        ? prev.filter((c) => c.code !== code.code)
        : [...prev, code]
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-blue-600" /> ICD-10 Code Suggestions
        </h4>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading} className="h-6 text-[10px] px-2">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3 justify-center text-xs text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> Analyzing for codes...
        </div>
      ) : codes.length === 0 ? (
        <p className="text-[10px] text-slate-400 text-center py-2">No additional codes found</p>
      ) : (
        <>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {codes.map((code) => (
              <div
                key={code.code}
                onClick={() => toggle(code)}
                className={`p-2 rounded border cursor-pointer transition-all text-xs ${
                  selected.find((c) => c.code === code.code)
                    ? "bg-blue-50 border-blue-300"
                    : "bg-white border-slate-200 hover:border-blue-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge className="bg-blue-600 text-white font-mono text-[10px] px-1.5 py-0">{code.code}</Badge>
                      <span className="font-medium text-slate-800 text-[11px]">{code.description}</span>
                    </div>
                    {code.relevance && (
                      <span className="text-[9px] text-blue-600 mt-0.5 block">Relevance: {code.relevance}%</span>
                    )}
                    {code.justification && (
                      <p className="text-[10px] text-slate-500 mt-0.5">{code.justification}</p>
                    )}
                  </div>
                  <Button
                    size="sm" variant="ghost" className="h-5 w-5 p-0 flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${code.code} - ${code.description}`); toast.success("Copied"); }}
                  >
                    <Copy className="w-2.5 h-2.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {selected.length > 0 && (
            <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 text-xs h-8"
              onClick={() => { onCodesSelected?.(selected); setSelected([]); toast.success(`${selected.length} code(s) added`); }}
            >
              <Plus className="w-3 h-3 mr-1" /> Add {selected.length} Code{selected.length > 1 ? "s" : ""}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function TasksSection({ tasks, loading, onRefresh, patientId, currentUserEmail }) {
  const [selected, setSelected] = useState([]);
  const queryClient = useQueryClient();

  const toggle = (task) => {
    setSelected((prev) =>
      prev.find((t) => t.title === task.title)
        ? prev.filter((t) => t.title !== task.title)
        : [...prev, task]
    );
  };

  const createMutation = useMutation({
    mutationFn: async (tasks) => {
      return Promise.all(
        tasks.map((t) =>
          base44.entities.Task.create({
            title: t.title,
            description: t.description,
            due_date: t.due_date,
            priority: t.priority || "medium",
            patient_id: patientId,
            assigned_to: currentUserEmail,
            status: "pending",
            source: "ai_generated",
            ai_reason: t.reason,
          })
        )
      );
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["allTasks"] });
      toast.success(`Created ${created.length} task(s)`);
      setSelected([]);
    },
  });

  const PRIO_COLORS = {
    critical: "bg-red-100 text-red-800", high: "bg-orange-100 text-orange-800",
    medium: "bg-amber-100 text-amber-800", low: "bg-green-100 text-green-800",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-purple-600" /> Follow-Up Tasks
        </h4>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading} className="h-6 text-[10px] px-2">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3 justify-center text-xs text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500" /> Generating tasks...
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-[10px] text-slate-400 text-center py-2">No follow-up tasks identified</p>
      ) : (
        <>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {tasks.map((task, idx) => (
              <div
                key={idx}
                onClick={() => toggle(task)}
                className={`p-2 rounded border cursor-pointer transition-all text-xs ${
                  selected.find((t) => t.title === task.title)
                    ? "bg-purple-50 border-purple-300"
                    : "bg-white border-slate-200 hover:border-purple-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-[11px]">{task.title}</p>
                    {task.description && <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{task.description}</p>}
                    {task.reason && (
                      <p className="text-[10px] text-purple-600 mt-0.5 italic">Why: {task.reason}</p>
                    )}
                  </div>
                  <Badge className={`${PRIO_COLORS[task.priority] || PRIO_COLORS.medium} text-[9px] px-1.5 py-0 flex-shrink-0`}>
                    {task.priority || "medium"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
          {selected.length > 0 && (
            <Button size="sm" className="w-full bg-purple-600 hover:bg-purple-700 text-xs h-8"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate(selected)}
            >
              {createMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
              Create {selected.length} Task{selected.length > 1 ? "s" : ""}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function ComplianceSection({ result, loading, onRefresh }) {
  const SEV_COLORS = {
    critical: "bg-red-50 border-red-300 text-red-800",
    high: "bg-orange-50 border-orange-300 text-orange-800",
    medium: "bg-amber-50 border-amber-300 text-amber-800",
    low: "bg-blue-50 border-blue-300 text-blue-800",
  };
  const SEV_ICONS = {
    critical: <AlertCircle className="w-3.5 h-3.5" />,
    high: <AlertCircle className="w-3.5 h-3.5" />,
    medium: <AlertTriangle className="w-3.5 h-3.5" />,
    low: <Shield className="w-3.5 h-3.5" />,
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-green-600" /> Real-Time Compliance
        </h4>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading} className="h-6 text-[10px] px-2">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3 justify-center text-xs text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-green-500" /> Checking compliance...
        </div>
      ) : !result ? (
        <p className="text-[10px] text-slate-400 text-center py-2">No compliance data</p>
      ) : (
        <>
          {/* Score bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-500">Score</span>
              <Badge className={`text-[10px] px-1.5 py-0 ${
                result.score >= 85 ? "bg-green-600" : result.score >= 70 ? "bg-amber-600" : "bg-red-600"
              } text-white`}>
                {result.score}%
              </Badge>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <motion.div
                className={`h-full rounded-full ${result.score >= 85 ? "bg-green-500" : result.score >= 70 ? "bg-amber-500" : "bg-red-500"}`}
                initial={{ width: 0 }}
                animate={{ width: `${result.score}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>

          {/* Issues */}
          {result.issues?.length > 0 ? (
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              <AnimatePresence>
                {result.issues.map((issue, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-2 rounded border flex items-start gap-1.5 text-[10px] ${SEV_COLORS[issue.severity] || SEV_COLORS.medium}`}
                  >
                    <div className="flex-shrink-0 mt-0.5">{SEV_ICONS[issue.severity] || SEV_ICONS.medium}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{issue.title || issue.description}</p>
                      {issue.recommendation && <p className="opacity-80 mt-0.5">{issue.recommendation}</p>}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] text-green-700 bg-green-50 p-2 rounded border border-green-200">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Note appears compliant. No issues detected.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PostEnhancementInsights({
  enhancedNote,
  diagnosis,
  visitType,
  providerType,
  careSetting,
  patientId,
  patientData,
  currentUserEmail,
  onCodesSelected,
}) {
  const [codes, setCodes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [compliance, setCompliance] = useState(null);
  const [loadingCodes, setLoadingCodes] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingCompliance, setLoadingCompliance] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const hasRun = useRef(false);

  // Auto-run all three analyses when enhanced note arrives
  useEffect(() => {
    if (enhancedNote && enhancedNote.length > 50 && !hasRun.current) {
      hasRun.current = true;
      fetchCodes();
      fetchTasks();
      fetchCompliance();
    }
  }, [enhancedNote]);

  // Reset when note changes significantly
  useEffect(() => {
    hasRun.current = false;
  }, [diagnosis, visitType]);

  const fetchCodes = async () => {
    if (!enhancedNote || enhancedNote.length < 50) return;
    setLoadingCodes(true);
    try {
      const res = await base44.functions.invoke("suggestICD10CodesFromNote", {
        note_content: enhancedNote,
        primary_diagnosis: diagnosis,
        visit_type: visitType,
      });
      setCodes(res.data?.suggested_codes || res.suggested_codes || []);
    } catch (e) {
      console.error("ICD-10 error:", e);
    } finally {
      setLoadingCodes(false);
    }
  };

  const fetchTasks = async () => {
    if (!enhancedNote || enhancedNote.length < 50) return;
    setLoadingTasks(true);
    try {
      const res = await base44.functions.invoke("generateFollowUpTasksFromNote", {
        note_content: enhancedNote,
        diagnosis,
        patient_id: patientId !== "no_patient" ? patientId : null,
      });
      setTasks(res.data?.suggested_tasks || res.suggested_tasks || []);
    } catch (e) {
      console.error("Tasks error:", e);
    } finally {
      setLoadingTasks(false);
    }
  };

  const fetchCompliance = async () => {
    if (!enhancedNote || enhancedNote.length < 50) return;
    setLoadingCompliance(true);
    try {
      const res = await base44.functions.invoke("checkRealtimeCompliance", {
        note_content: enhancedNote,
        provider_type: providerType,
        visit_type: visitType,
        check_type: "full",
      });
      const result = res.data || res;
      setCompliance({ score: result.compliance_score, issues: result.issues || [] });
    } catch (e) {
      console.error("Compliance error:", e);
    } finally {
      setLoadingCompliance(false);
    }
  };

  if (!enhancedNote) return null;

  const anyLoading = loadingCodes || loadingTasks || loadingCompliance;
  const totalIssues = (compliance?.issues?.length || 0);
  const totalCodes = codes.length;
  const totalTasks = tasks.length;

  return (
    <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/40 via-white to-purple-50/40">
      <CardHeader className="p-3 sm:p-4 pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-indigo-600" />
            AI Insights
            {anyLoading && <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />}
          </CardTitle>
          <div className="flex items-center gap-2">
            {totalCodes > 0 && <Badge className="bg-blue-100 text-blue-700 text-[9px]">{totalCodes} codes</Badge>}
            {totalTasks > 0 && <Badge className="bg-purple-100 text-purple-700 text-[9px]">{totalTasks} tasks</Badge>}
            {compliance && (
              <Badge className={`text-[9px] ${compliance.score >= 85 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                {compliance.score}%
              </Badge>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-3 sm:p-4 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
            {/* ICD-10 Codes */}
            <Card className="border-blue-100">
              <CardContent className="p-3">
                <ICD10Section codes={codes} loading={loadingCodes} onRefresh={fetchCodes} onCodesSelected={onCodesSelected} />
              </CardContent>
            </Card>

            {/* Follow-Up Tasks */}
            <Card className="border-purple-100">
              <CardContent className="p-3">
                <TasksSection
                  tasks={tasks}
                  loading={loadingTasks}
                  onRefresh={fetchTasks}
                  patientId={patientId !== "no_patient" ? patientId : null}
                  currentUserEmail={currentUserEmail}
                />
              </CardContent>
            </Card>

            {/* Compliance */}
            <Card className="border-green-100">
              <CardContent className="p-3">
                <ComplianceSection result={compliance} loading={loadingCompliance} onRefresh={fetchCompliance} />
              </CardContent>
            </Card>
          </div>
        </CardContent>
      )}
    </Card>
  );
}