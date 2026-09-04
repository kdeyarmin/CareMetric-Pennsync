import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  X,
  Loader2,
  AlertTriangle,
  TrendingUp,
  Sparkles,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { toast } from 'sonner';

const TASK_CREATION_BLOCKER =
  'AI clinical task creation is paused pending an atomic, idempotent, patient-authorized broker. Suggestions are review-only.';

export default function ProactiveClinicalTaskGenerator({ 
  patientId,
  _patientName,
  autoAnalyze = false
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  // Keyed by task OBJECT identity, not array index: the rendered list is a
  // filtered subset of suggestedTasks, so index-based keys desynced after the
  // first dismissal and approve/dismiss/expand then hit the wrong task.
  const [expandedTasks, setExpandedTasks] = useState(() => new Set());
  const [dismissedTasks, setDismissedTasks] = useState(() => new Set());
  const analysisRequestRef = useRef(0);
  const autoAnalysisPatientRef = useRef(null);

  // Clear sticky AI task suggestions when the chart switches patients — otherwise
  // Approve can write Patient A's suggestions onto Patient B.
  React.useEffect(() => {
    analysisRequestRef.current += 1;
    autoAnalysisPatientRef.current = null;
    setSuggestedTasks([]);
    setExpandedTasks(new Set());
    setDismissedTasks(new Set());
    setAnalyzing(false);
    return () => {
      analysisRequestRef.current += 1;
    };
  }, [patientId]);

  const handleAnalyze = React.useCallback(async () => {
    if (!patientId) return;

    const requestId = ++analysisRequestRef.current;
    setAnalyzing(true);
    try {
      const response = await base44.functions.invoke('analyzeAndGenerateClinicalTasks', {
        patientId
      });

      if (analysisRequestRef.current !== requestId) return;
      // Tag each task with a stable id so list rendering can key by identity
      // (not array index) — visibleTasks is a filtered subset that shrinks on
      // dismiss/approve, and index keys would attach card UI to the wrong task.
      const tasks = (response.data?.tasks || []).map((t, i) => ({ ...t, __id: `task-${i}` }));
      setSuggestedTasks(tasks);
      setDismissedTasks(new Set());

      // Auto-expand high priority tasks (keyed by task object).
      const highPriorityExpanded = new Set();
      tasks.forEach((task) => {
        if (task.priority === 'high' || task.risk_level === 'critical') {
          highPriorityExpanded.add(task);
        }
      });
      setExpandedTasks(highPriorityExpanded);
    } catch (error) {
      if (analysisRequestRef.current !== requestId) return;
      console.error('Failed to analyze patient:', error);
      toast.error('Failed to analyze patient data. Please try again.');
    }
    if (analysisRequestRef.current === requestId) {
      setAnalyzing(false);
    }
  }, [patientId]);

  React.useEffect(() => {
    if (!autoAnalyze) {
      autoAnalysisPatientRef.current = null;
      return;
    }
    if (
      patientId
      && suggestedTasks.length === 0
      && !analyzing
      && autoAnalysisPatientRef.current !== patientId
    ) {
      // Mark the attempt before dispatch so a zero-result response or failure
      // cannot create an automatic retry loop.
      autoAnalysisPatientRef.current = patientId;
      handleAnalyze();
    }
  }, [autoAnalyze, patientId, suggestedTasks.length, analyzing, handleAnalyze]);

  const handleDismissTask = (task) => {
    setDismissedTasks(prev => new Set(prev).add(task));
    setTimeout(() => {
      setSuggestedTasks(prev => prev.filter(t => t !== task));
    }, 300);
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-700 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-700 border-blue-300';
      default: return 'bg-slate-100 text-slate-700 border-slate-300';
    }
  };

  const getRiskIcon = (riskLevel) => {
    switch (riskLevel) {
      case 'critical':
      case 'high':
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case 'moderate':
        return <TrendingUp className="w-4 h-4 text-yellow-600" />;
      default:
        return <Brain className="w-4 h-4 text-blue-600" />;
    }
  };

  const toggleExpand = (task) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(task)) next.delete(task);
      else next.add(task);
      return next;
    });
  };

  const visibleTasks = suggestedTasks.filter(task => !dismissedTasks.has(task));

  return (
    <Card className="border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 to-navy-50">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            AI Clinical Task Assistant
            <Badge className="bg-indigo-600 text-white">Proactive</Badge>
          </div>
          {visibleTasks.length > 0 && (
            <Badge variant="outline" className="text-indigo-700">
              {visibleTasks.length} suggested
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {visibleTasks.length === 0 && !analyzing && (
          <div className="text-center py-6">
            <Brain className="w-12 h-12 text-indigo-400 mx-auto mb-3" />
            <p className="text-slate-600 mb-4">
              AI will analyze visit notes, care plans, and alerts to suggest follow-up tasks
            </p>
            <Button
              onClick={handleAnalyze}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Analyze Patient
            </Button>
          </div>
        )}

        {analyzing && (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 text-indigo-600 mx-auto mb-3 animate-spin" />
            <p className="text-indigo-900 font-medium">Analyzing patient data...</p>
            <p className="text-sm text-indigo-700 mt-1">Reviewing visits, care plans, and alerts</p>
          </div>
        )}

        {visibleTasks.length > 0 && (
          <>
            <Alert className="bg-indigo-50 border-indigo-300">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <AlertDescription className="text-indigo-900 text-sm">
                AI identified <strong>{visibleTasks.length} task recommendations</strong> based on clinical analysis.
                {` ${TASK_CREATION_BLOCKER}`}
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              {visibleTasks.map((task) => (
                <Card
                  key={task.__id}
                  className={`border-2 transition-all ${
                    task.risk_level === 'critical' ? 'border-red-400 bg-red-50' :
                    task.priority === 'high' ? 'border-orange-300 bg-orange-50' :
                    'border-slate-300 bg-white'
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-start gap-2 flex-1">
                        {getRiskIcon(task.risk_level)}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-slate-900 text-sm">{task.title}</h4>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <Badge className={getPriorityColor(task.priority)} size="sm">
                              {task.priority}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {task.type}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              Due: {task.due_timeframe?.replace('_', ' ')}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleExpand(task)}
                      >
                        {expandedTasks.has(task) ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                    </div>

                    {expandedTasks.has(task) && (
                      <div className="mt-3 space-y-2 text-sm">
                        <div>
                          <p className="text-slate-700">{task.description}</p>
                        </div>
                        
                        {task.clinical_rationale && (
                          <div className="bg-blue-50 border border-blue-200 rounded p-2">
                            <p className="text-xs font-semibold text-blue-700">Clinical Rationale:</p>
                            <p className="text-xs text-blue-900 mt-1">{task.clinical_rationale}</p>
                          </div>
                        )}

                        {task.suggested_actions?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-slate-700">Suggested Actions:</p>
                            <ul className="list-disc list-inside text-xs text-slate-600 mt-1">
                              {task.suggested_actions.map((action, i) => (
                                <li key={i}>{action}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        disabled
                        className="flex-1"
                      >
                        Creation paused
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDismissTask(task)}
                      >
                        <X className="w-3 h-3 mr-1" />
                        Dismiss
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t">
              <Button
                disabled
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              >
                Task creation paused ({visibleTasks.length})
              </Button>
              <Button
                onClick={handleAnalyze}
                variant="outline"
                disabled={analyzing}
              >
                <Sparkles className="w-4 h-4 mr-1" />
                Re-analyze
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
