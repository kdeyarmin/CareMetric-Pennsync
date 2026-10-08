import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { severitySolidClass } from "@/lib/severityStyles";


import {
  Route,
  Zap,
  FileText,
  ClipboardList,
  Target,
  ListChecks,
  Activity,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { manageOASISRecords, oasisClientKey } from "@/functions/manageOASISRecords";
import { addDaysToToday } from "@/components/oasis/oasisTaskDates";

/**
 * Matches the patient's extracted OASIS data against the agency's active
 * clinical pathway library and offers each triggered pathway's documentation
 * checklist and recommended tasks. The library is read through the OASIS record
 * broker (ClinicalPathway denies every direct client read), projected without
 * its legacy PDGM-group and rescore fields; tasks are created through the same
 * broker after it confirms the clinician may open this chart, keyed per pathway
 * task so a second click adds nothing twice.
 */
export default function ClinicalPathwayTrigger({ pdgmData, _analysisResults, patientId, onPathwaysTriggered }) {
  const [triggeredPathways, setTriggeredPathways] = useState([]);
  const [creatingFor, setCreatingFor] = useState(null);
  const [createdFor, setCreatedFor] = useState([]);
  const queryClient = useQueryClient();

  // Fetch all active clinical pathways
  const { data: pathways = [] } = useQuery({
    // Active-only — see AIPathwayRecommender.jsx.
    queryKey: ['clinicalPathways', 'active'],
    queryFn: async () => (await manageOASISRecords('list_pathways'))?.pathways || [],
  });

  const createPathwayTasks = async (pathway) => {
    if (!patientId || !pathway?.recommended_tasks?.length) return;
    setCreatingFor(pathway.id);
    try {
      const { results = [] } = await manageOASISRecords('create_tasks', {
        patient_id: patientId,
        tasks: pathway.recommended_tasks.slice(0, 25).map((task, index) => ({
          key: oasisClientKey('pathway-task', patientId, pathway.id, index, task.task_title),
          title: String(task.task_title || `${pathway.pathway_name} task`).slice(0, 200),
          description: task.task_description || '',
          type: task.task_type || 'followup',
          priority: task.priority,
          due_date: addDaysToToday({ today: 0, '24_hours': 1, '48_hours': 2, this_week: 7 }[task.due_timeframe] ?? 7),
          ai_reason: `Recommended by the ${pathway.pathway_name} clinical pathway`,
        })),
      });
      const added = results.filter((row) => row.status === 'created' || row.status === 'existing').length;
      if (added === pathway.recommended_tasks.slice(0, 25).length) {
        setCreatedFor((prev) => [...new Set([...prev, pathway.id])]);
        toast.success(`${added} pathway task${added === 1 ? '' : 's'} added to this patient.`);
      } else {
        toast.error(`${added} of ${results.length} pathway tasks were added. Try again for the rest.`);
      }
      if (added) queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch (error) {
      toast.error(error?.message || 'The pathway tasks could not be created.');
    } finally {
      setCreatingFor(null);
    }
  };

  const evaluateCondition = useCallback((condition, data) => {
    const { type, value, operator } = condition;
    const valueLower = (value || '').toLowerCase();

    switch (type) {
      case 'diagnosis_code': {
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
      }

      case 'diagnosis_keyword': {
        const primaryDx = (data.primary_diagnosis || data.primary_diagnosis_description || '').toLowerCase();
        const comorbidityText = (data.comorbidities || []).join(' ').toLowerCase();
        const searchText = primaryDx + ' ' + comorbidityText;

        return searchText.includes(valueLower);
      }

      case 'clinical_condition': {
        const clinicalItems = JSON.stringify(data.clinical_items || {}).toLowerCase();
        return clinicalItems.includes(valueLower);
      }

      case 'functional_score': {
        const functionalScores = data.functional_scores || {};
        const totalScore = Object.values(functionalScores).reduce((sum, val) => sum + (parseInt(val) || 0), 0);

        if (operator === 'greater_than') {
          return totalScore > parseInt(value);
        } else if (operator === 'less_than') {
          return totalScore < parseInt(value);
        }
        break;
      }

      case 'comorbidity': {
        const comorbidities = (data.comorbidities || []).map(c => c.toLowerCase());
        return comorbidities.some(c => c.includes(valueLower));
      }

      default:
        return false;
    }

    return false;
  }, []);

  // Keep the latest onPathwaysTriggered in a ref so checkPathwayTriggers does not
  // depend on its identity. Call sites pass an inline arrow that stores the
  // freshly-built `triggered` array in parent state (see OASISAnalyzer.jsx), so
  // depending on the prop directly rebuilt the callback on every render, re-ran
  // the effect below, and handed the parent a new array identity each time —
  // React never bails out on a new reference, so it looped until "Maximum update
  // depth exceeded".
  const onPathwaysTriggeredRef = useRef(onPathwaysTriggered);
  useEffect(() => { onPathwaysTriggeredRef.current = onPathwaysTriggered; }, [onPathwaysTriggered]);

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
    onPathwaysTriggeredRef.current?.(triggered);
  }, [pathways, pdgmData, evaluateCondition]);

  // Check for pathway triggers when data changes
  useEffect(() => {
    if (!pdgmData) {
      setTriggeredPathways([]);
      onPathwaysTriggeredRef.current?.([]);
      return;
    }
    // checkPathwayTriggers intentionally runs for an empty pathway list so a
    // retired/deactivated final pathway cannot remain displayed from cache.
    checkPathwayTriggers();
  }, [pdgmData, pathways, checkPathwayTriggers]);

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
            Based on this patient's diagnoses, these clinical pathways apply. Use them to guide documentation and the plan of care.
          </AlertDescription>
        </Alert>

        {triggeredPathways.map((pathway, idx) => (
          <div key={idx} className="border-2 border-indigo-300 rounded-lg overflow-hidden">
            {/* Pathway Header */}
            <div className="bg-gradient-to-r from-indigo-100 to-navy-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-indigo-900 text-lg">{pathway.pathway_name}</h3>
                <Badge className={severitySolidClass(pathway.priority_level)}>
                  {pathway.priority_level} priority
                </Badge>
              </div>
              <p className="text-sm text-indigo-700">{pathway.description}</p>
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
                          <Badge className={`text-xs ${severitySolidClass(prompt.priority)}`}>
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
                      size="sm"
                      onClick={() => createPathwayTasks(pathway)}
                      disabled={!patientId || creatingFor === pathway.id || createdFor.includes(pathway.id)}
                      className="bg-navy-600 hover:bg-navy-700"
                    >
                      {creatingFor === pathway.id
                        ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Adding…</>
                        : createdFor.includes(pathway.id)
                          ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Tasks added</>
                          : 'Add tasks'}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {pathway.recommended_tasks.map((task, tIdx) => (
                      <div key={tIdx} className="bg-white p-2 rounded border">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-slate-800">{task.task_title}</span>
                          <div className="flex gap-1">
                            <Badge className={`text-xs ${severitySolidClass(task.priority)}`}>
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
              <p className="text-slate-500">Comorbidities to Verify</p>
              <p className="text-lg font-bold text-green-700">
                {triggeredPathways.reduce((sum, p) => sum + (p.comorbidity_checklist?.length || 0), 0)}
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
