import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";


import {
  Route,
  Zap,
  DollarSign,
  FileText,
  ClipboardList,
  Target,
  TrendingUp,
  Loader2,
  ListChecks,
  Activity
} from "lucide-react";

export default function ClinicalPathwayTrigger({ pdgmData, _analysisResults, patientId, onTasksCreated, onPathwaysTriggered }) {
  const [triggeredPathways, setTriggeredPathways] = useState([]);
  const [_isAnalyzing, _setIsAnalyzing] = useState(false);
  const queryClient = useQueryClient();

  // Current user — assigned_to is required on Task; without it the pathway task
  // creates are rejected and nothing is generated.
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Fetch all active clinical pathways
  const { data: pathways = [] } = useQuery({
    queryKey: ['clinicalPathways'],
    queryFn: async () => {
      const result = await base44.entities.ClinicalPathway.filter({ is_active: true });
      return result;
    }
  });

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: (taskData) => base44.entities.Task.create(taskData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  const evaluateCondition = useCallback((condition, data) => {
    const { type, value, operator } = condition;
    const valueLower = (value || '').toLowerCase();

    switch (type) {
      case 'diagnosis_code':
        const primaryCode = (data.primary_diagnosis_code || '').toLowerCase();
        const allCodes = (data.comorbidities || []).map(c => c.toLowerCase());
        
        if (operator === 'equals') {
          return primaryCode === valueLower || allCodes.some(c => c.includes(valueLower));
        } else if (operator === 'starts_with') {
          return primaryCode.startsWith(valueLower) || allCodes.some(c => c.startsWith(valueLower));
        } else if (operator === 'contains') {
          return primaryCode.includes(valueLower) || allCodes.some(c => c.includes(valueLower));
        }
        break;

      case 'diagnosis_keyword':
        const primaryDx = (data.primary_diagnosis || data.primary_diagnosis_description || '').toLowerCase();
        const comorbidityText = (data.comorbidities || []).join(' ').toLowerCase();
        const searchText = primaryDx + ' ' + comorbidityText;
        
        return searchText.includes(valueLower);

      case 'clinical_condition':
        const clinicalItems = JSON.stringify(data.clinical_items || {}).toLowerCase();
        return clinicalItems.includes(valueLower);

      case 'functional_score':
        const functionalScores = data.functional_scores || {};
        const totalScore = Object.values(functionalScores).reduce((sum, val) => sum + (parseInt(val) || 0), 0);
        
        if (operator === 'greater_than') {
          return totalScore > parseInt(value);
        } else if (operator === 'less_than') {
          return totalScore < parseInt(value);
        }
        break;

      case 'comorbidity':
        const comorbidities = (data.comorbidities || []).map(c => c.toLowerCase());
        return comorbidities.some(c => c.includes(valueLower));

      default:
        return false;
    }

    return false;
  }, []);

  const checkPathwayTriggers = useCallback(() => {
    const triggered = [];

    pathways.forEach(pathway => {
      let isTriggered = false;

      pathway.trigger_conditions?.forEach(condition => {
        if (evaluateCondition(condition, pdgmData)) {
          isTriggered = true;
        }
      });

      if (isTriggered) {
        triggered.push(pathway);
      }
    });

    setTriggeredPathways(triggered);

    // Notify parent component
    if (onPathwaysTriggered) {
      onPathwaysTriggered(triggered);
    }
  }, [pathways, pdgmData, onPathwaysTriggered, evaluateCondition]);

  // Check for pathway triggers when data changes
  useEffect(() => {
    if (pdgmData && pathways.length > 0) {
      checkPathwayTriggers();
    }
  }, [pdgmData, pathways, checkPathwayTriggers]);

  const createPathwayTasks = async (pathway) => {
    if (!pathway.recommended_tasks || pathway.recommended_tasks.length === 0) return;
    // assigned_to is required on Task; abort if the current user isn't resolved yet.
    if (!currentUser?.email) {
      toast.error('Could not determine the current user. Please refresh and try again.');
      return;
    }

    const taskPromises = pathway.recommended_tasks.map(task => {
      const taskData = {
        patient_id: patientId || null,
        assigned_to: currentUser?.email,
        title: task.task_title,
        description: `[Clinical Pathway: ${pathway.pathway_name}] ${task.task_description}`,
        type: task.task_type || 'other',
        priority: task.priority || 'medium',
        due_timeframe: task.due_timeframe || 'this_week',
        source: 'ai_generated',
        ai_reason: `Auto-generated from clinical pathway: ${pathway.pathway_name}`
      };

      return createTaskMutation.mutateAsync(taskData);
    });

    await Promise.all(taskPromises);
    
    if (onTasksCreated) {
      onTasksCreated(pathway.recommended_tasks.length);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  if (!pdgmData || triggeredPathways.length === 0) {
    return null;
  }

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Route className="w-5 h-5 text-indigo-600" />
            Clinical Pathways Triggered
          </div>
          <Badge className="bg-indigo-600 text-white">
            {triggeredPathways.length} pathway{triggeredPathways.length !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <Alert className="bg-indigo-50 border-indigo-200">
          <Zap className="w-4 h-4 text-indigo-600" />
          <AlertDescription className="text-indigo-800 text-sm">
            Based on this patient's diagnosis, we've activated specialized clinical pathways to guide documentation and optimize care.
          </AlertDescription>
        </Alert>

        {triggeredPathways.map((pathway, idx) => (
          <div key={idx} className="border-2 border-indigo-300 rounded-lg overflow-hidden">
            {/* Pathway Header */}
            <div className="bg-gradient-to-r from-indigo-100 to-navy-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-indigo-900 text-lg">{pathway.pathway_name}</h3>
                <Badge className={getPriorityColor(pathway.priority_level)}>
                  {pathway.priority_level} priority
                </Badge>
              </div>
              <p className="text-sm text-indigo-700">{pathway.description}</p>
              {pathway.pdgm_clinical_group && (
                <div className="mt-2">
                  <Badge variant="outline" className="bg-white text-indigo-700">
                    Expected PDGM Group: {pathway.pdgm_clinical_group.replace('MMTA_', '')}
                  </Badge>
                </div>
              )}
            </div>

            <div className="p-4 space-y-4">
              {/* Documentation Prompts */}
              {pathway.documentation_prompts && pathway.documentation_prompts.length > 0 && (
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="w-4 h-4 text-blue-600" />
                    <h4 className="font-semibold text-blue-900">Documentation Checklist</h4>
                  </div>
                  <div className="space-y-2">
                    {pathway.documentation_prompts.map((prompt, pIdx) => (
                      <div key={pIdx} className="bg-white p-2 rounded border">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-slate-800">{prompt.category}</span>
                          <Badge className={`text-xs ${getPriorityColor(prompt.priority)}`}>
                            {prompt.priority}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-700">{prompt.prompt}</p>
                        {prompt.m_items_affected && prompt.m_items_affected.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {prompt.m_items_affected.map((item, mIdx) => (
                              <Badge key={mIdx} variant="outline" className="text-xs font-mono">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rescore Opportunities */}
              {pathway.rescore_opportunities && pathway.rescore_opportunities.length > 0 && (
                <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                    <h4 className="font-semibold text-green-900">Rescore Opportunities</h4>
                  </div>
                  <div className="space-y-2">
                    {pathway.rescore_opportunities.map((opp, oIdx) => (
                      <div key={oIdx} className="bg-white p-2 rounded border border-green-200">
                        <div className="flex items-center justify-between mb-1">
                          <Badge className="bg-green-700 text-white font-mono">{opp.m_item}</Badge>
                          {opp.revenue_impact && (
                            <Badge className="bg-emerald-600 text-white">
                              <DollarSign className="w-3 h-3 mr-1" />
                              {opp.revenue_impact}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mb-1">
                          Typical Range: <span className="font-medium">{opp.typical_score_range}</span>
                        </p>
                        <p className="text-sm text-slate-800">{opp.documentation_to_support}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Comorbidity Checklist */}
              {pathway.comorbidity_checklist && pathway.comorbidity_checklist.length > 0 && (
                <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                  <div className="flex items-center gap-2 mb-3">
                    <ListChecks className="w-4 h-4 text-yellow-600" />
                    <h4 className="font-semibold text-yellow-900">Comorbidity Checklist</h4>
                  </div>
                  <p className="text-xs text-yellow-700 mb-2">Verify if patient has any of these conditions:</p>
                  <div className="flex flex-wrap gap-2">
                    {pathway.comorbidity_checklist.map((comorbidity, cIdx) => (
                      <Badge key={cIdx} variant="outline" className="bg-white">
                        {comorbidity}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Functional Focus Areas */}
              {pathway.functional_focus_areas && pathway.functional_focus_areas.length > 0 && (
                <div className="bg-navy-50 p-3 rounded-lg border border-navy-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-navy-600" />
                    <h4 className="font-semibold text-navy-900">Functional Assessment Focus</h4>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pathway.functional_focus_areas.map((area, fIdx) => (
                      <Badge key={fIdx} className="bg-navy-200 text-navy-800">
                        {area}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Auto-Generate Tasks */}
              {pathway.recommended_tasks && pathway.recommended_tasks.length > 0 && (
                <div className="bg-gradient-to-r from-navy-50 to-blue-50 p-3 rounded-lg border border-navy-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-navy-600" />
                      <h4 className="font-semibold text-navy-900">Recommended Tasks</h4>
                    </div>
                    <Button
                      onClick={() => createPathwayTasks(pathway)}
                      disabled={!patientId || createTaskMutation.isPending}
                      size="sm"
                      className="bg-navy-600 hover:bg-navy-700"
                    >
                      {createTaskMutation.isPending ? (
                        <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Creating...</>
                      ) : (
                        <>Create {pathway.recommended_tasks.length} Tasks</>
                      )}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {pathway.recommended_tasks.map((task, tIdx) => (
                      <div key={tIdx} className="bg-white p-2 rounded border">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-slate-800">{task.task_title}</span>
                          <div className="flex gap-1">
                            <Badge className={`text-xs ${getPriorityColor(task.priority)}`}>
                              {task.priority}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {task.due_timeframe?.replace('_', ' ')}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600">{task.task_description}</p>
                      </div>
                    ))}
                  </div>
                  {!patientId && (
                    <p className="text-xs text-orange-600 mt-2">
                      ⚠ Link to a patient record to create tasks
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Summary */}
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-3 rounded-lg border border-green-200">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-green-600" />
            <span className="font-semibold text-green-900">Pathway Impact</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-white p-2 rounded">
              <p className="text-slate-500">Documentation Items</p>
              <p className="text-lg font-bold text-blue-700">
                {triggeredPathways.reduce((sum, p) => sum + (p.documentation_prompts?.length || 0), 0)}
              </p>
            </div>
            <div className="bg-white p-2 rounded">
              <p className="text-slate-500">Rescore Opportunities</p>
              <p className="text-lg font-bold text-green-700">
                {triggeredPathways.reduce((sum, p) => sum + (p.rescore_opportunities?.length || 0), 0)}
              </p>
            </div>
            <div className="bg-white p-2 rounded">
              <p className="text-slate-500">Recommended Tasks</p>
              <p className="text-lg font-bold text-navy-700">
                {triggeredPathways.reduce((sum, p) => sum + (p.recommended_tasks?.length || 0), 0)}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const _getPriorityColor = (priority) => {
  switch (priority) {
    case 'critical': return 'bg-red-600 text-white';
    case 'high': return 'bg-orange-500 text-white';
    case 'medium': return 'bg-yellow-500 text-white';
    case 'low': return 'bg-blue-500 text-white';
    default: return 'bg-slate-500 text-white';
  }
};