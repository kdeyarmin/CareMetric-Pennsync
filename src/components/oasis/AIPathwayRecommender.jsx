import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Target,
  CheckCircle2,
  DollarSign,
  Stethoscope,
  Sparkles,
  Activity,
  ClipboardList,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";

export default function AIPathwayRecommender({ 
  pdgmData, 
  analysisResults, 
  patientId,
  navigationData,
  onPathwaysActivated 
}) {
  const ai = useAICall();
  const [recommendations, setRecommendations] = useState(null);
  const [selectedPathways, setSelectedPathways] = useState([]);
  const [expandedPathway, setExpandedPathway] = useState(null);
  const queryClient = useQueryClient();

  // Current user — assigned_to is required on Task; without it the bulkCreate of
  // generated pathway tasks is rejected and nothing is created.
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: availablePathways = [] } = useQuery({
    queryKey: ['clinicalPathways'],
    queryFn: () => base44.entities.ClinicalPathway.filter({ is_active: true }),
  });

  const createTasksMutation = useMutation({
    mutationFn: (tasks) => base44.entities.Task.bulkCreate(tasks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  const analyzePathways = useCallback(async () => {

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a home health clinical pathway specialist and PDGM revenue analyst. Analyze this OASIS data and recommend specific clinical pathways and interventions.

OASIS DATA:
${JSON.stringify({
  primary_diagnosis: pdgmData.primary_diagnosis,
  primary_diagnosis_code: pdgmData.primary_diagnosis_code,
  comorbidities: pdgmData.comorbidities,
  functional_scores: pdgmData.functional_scores,
  admission_source: pdgmData.admission_source,
  episode_timing: pdgmData.episode_timing,
  clinical_items: pdgmData.clinical_items,
  therapy_services: pdgmData.therapy_services,
  risk_factors: pdgmData.risk_factors
}, null, 2)}

ANALYSIS FINDINGS:
Accuracy Score: ${analysisResults.accuracy_score}
Compliance Score: ${analysisResults.compliance_score}
Revenue Score: ${analysisResults.revenue_optimization_score}
Key Issues: ${JSON.stringify(analysisResults.accuracy_issues?.slice(0, 5) || [])}
Revenue Opportunities: ${JSON.stringify(analysisResults.revenue_tips?.slice(0, 3) || [])}

PDGM GROUPING (if available):
${navigationData ? JSON.stringify({
  clinical_group: navigationData.clinical_group?.assigned_group,
  functional_level: navigationData.functional_level?.level,
  comorbidity_level: navigationData.comorbidity_adjustment?.level,
  calculated_payment: navigationData.case_mix_calculation?.calculated_payment
}, null, 2) : 'Not yet calculated'}

AVAILABLE PATHWAYS IN SYSTEM:
${JSON.stringify(availablePathways.map(p => ({
  name: p.pathway_name,
  description: p.description,
  pdgm_group: p.pdgm_clinical_group
})), null, 2)}

Recommend clinical pathways and interventions:

1. PATHWAY RECOMMENDATIONS
   - Match patient to 3-5 most relevant clinical pathways
   - Consider diagnosis, functional status, comorbidities, and risks
   - Prioritize pathways that address identified issues
   - Include both system pathways AND custom recommendations

2. INTERVENTION STRATEGIES
   - Specific clinical interventions for this patient
   - Tie to PDGM optimization opportunities
   - Include skilled nursing tasks and goals

3. PDGM IMPACT ANALYSIS
   - How each pathway affects PDGM grouping
   - Expected revenue impact
   - Functional level improvement potential
   - Comorbidity adjustment opportunities

4. DOCUMENTATION FOCUS AREAS
   - What to document to support the pathway
   - M-items that will be affected
   - CMS compliance considerations

Return JSON:
{
  "recommended_pathways": [
    {
      "pathway_name": "name",
      "pathway_type": "existing_pathway/custom_recommendation",
      "existing_pathway_id": "ID if matches system pathway, else null",
      "match_score": 0-100,
      "primary_trigger": "diagnosis/functional/comorbidity/risk",
      "trigger_details": "specific condition that triggered this",
      "clinical_rationale": "why this pathway is appropriate",
      "priority": "critical/high/medium/low",
      "expected_outcomes": ["outcome 1", "outcome 2"],
      "pdgm_impact": {
        "affects_clinical_group": true/false,
        "clinical_group_change": "from X to Y if applicable",
        "affects_functional_level": true/false,
        "functional_improvement_potential": "description",
        "affects_comorbidity_adjustment": true/false,
        "comorbidity_opportunities": "description",
        "estimated_payment_impact": "$X increase/no change",
        "payment_impact_explanation": "why and how"
      },
      "documentation_requirements": [
        {
          "area": "what to document",
          "frequency": "how often",
          "m_items_affected": ["M1800", "M1860"],
          "sample_narrative": "example documentation text"
        }
      ],
      "recommended_interventions": [
        {
          "intervention": "specific nursing intervention",
          "frequency": "how often",
          "skilled_rationale": "why skilled nursing is needed",
          "expected_functional_impact": "description"
        }
      ],
      "tasks_to_generate": [
        {
          "title": "task title",
          "description": "task description",
          "type": "call/schedule/document/coordinate/other",
          "priority": "high/medium/low",
          "due_timeframe": "today/24_hours/this_week"
        }
      ]
    }
  ],
  "overall_strategy": "summary of recommended clinical approach",
  "implementation_priority": ["pathway 1", "pathway 2"],
  "quick_wins": [
    {
      "action": "immediate action to take",
      "pathway": "which pathway this supports",
      "impact": "expected benefit"
    }
  ],
  "revenue_optimization_summary": {
    "current_estimated_payment": 0,
    "optimized_payment_potential": 0,
    "key_drivers": ["driver 1", "driver 2"]
  }
}`,
        response_json_schema: {
          type: "object",
          properties: {
            recommended_pathways: { type: "array", items: { type: "object" } },
            overall_strategy: { type: "string" },
            implementation_priority: { type: "array", items: { type: "string" } },
            quick_wins: { type: "array", items: { type: "object" } },
            revenue_optimization_summary: { type: "object" }
          }
        }
      });

      setRecommendations(result);
      
      // Auto-select high priority pathways
      const highPriority = result.recommended_pathways
        ?.filter(p => p.priority === 'critical' || p.priority === 'high')
        ?.map((p, idx) => idx) || [];
      setSelectedPathways(highPriority);

      // Log activity
      logActivity(ActivityActions.GENERATE, {
        action: 'pathway_recommendations',
        pathways_recommended: result.recommended_pathways?.length,
        patient_id: patientId,
        page: 'OASISAnalyzer'
      });
    } catch (error) {
      console.error("Pathway analysis error:", error);
      setRecommendations({ error: "Failed to generate pathway recommendations." });
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [analysisResults, availablePathways, navigationData, patientId, pdgmData]);

  useEffect(() => {
    if (pdgmData && analysisResults && !recommendations && !ai.loading) {
      analyzePathways();
    }
  }, [pdgmData, analysisResults, analyzePathways, ai.loading, recommendations]);

  const handleActivatePathways = async () => {
    if (!recommendations || selectedPathways.length === 0) return;
    // assigned_to is required on Task; abort if the current user isn't resolved yet.
    if (!currentUser?.email) {
      toast.error('Could not determine the current user. Please refresh and try again.');
      return;
    }

    const tasksToCreate = [];
    
    selectedPathways.forEach(idx => {
      const pathway = recommendations.recommended_pathways[idx];
      if (pathway?.tasks_to_generate) {
        pathway.tasks_to_generate.forEach(task => {
          tasksToCreate.push({
            ...task,
            patient_id: patientId,
            assigned_to: currentUser?.email,
            source: 'ai_generated',
            ai_reason: `Generated from ${pathway.pathway_name} pathway`
          });
        });
      }
    });

    if (tasksToCreate.length > 0) {
      await createTasksMutation.mutateAsync(tasksToCreate);
      
      logActivity(ActivityActions.TASK_CREATE, {
        task_count: tasksToCreate.length,
        source: 'ai_pathway_recommendations',
        patient_id: patientId,
        page: 'OASISAnalyzer'
      });
    }

    if (onPathwaysActivated) {
      const activated = selectedPathways.map(idx => recommendations.recommended_pathways[idx]);
      onPathwaysActivated(activated);
    }
  };

  const getPriorityColor = (priority) => {
    const colors = {
      critical: 'bg-red-600 text-white',
      high: 'bg-orange-500 text-white',
      medium: 'bg-blue-500 text-white',
      low: 'bg-slate-400 text-white'
    };
    return colors[priority] || colors.medium;
  };

  const formatCurrency = (amount) => {
    if (!amount) return '$0';
    const num = parseFloat(String(amount).replace(/[^0-9.-]/g, ''));
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
  };

  if (!pdgmData || !analysisResults) {
    return null;
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-navy-50 to-gold-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-navy-600" />
            AI Clinical Pathway Recommender
          </div>
          {recommendations?.recommended_pathways?.length > 0 && (
            <Badge className="bg-navy-600 text-white">
              {recommendations.recommended_pathways.length} pathways
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {ai.loading ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-navy-600 mx-auto mb-3" />
            <p className="text-sm text-slate-600">Analyzing clinical pathways and interventions...</p>
            <p className="text-xs text-slate-400 mt-1">Evaluating diagnosis, functional status, and PDGM optimization</p>
          </div>
        ) : !recommendations ? (
          <Button
            onClick={analyzePathways}
            className="w-full bg-navy-600 hover:bg-navy-700"
          >
            <Sparkles className="w-4 h-4 mr-2" /> Generate Pathway Recommendations
          </Button>
        ) : recommendations.error ? (
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-red-800">{recommendations.error}</AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Overall Strategy */}
            <Alert className="bg-gradient-to-r from-indigo-50 to-navy-50 border-indigo-300">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <AlertDescription className="text-indigo-900">
                <strong>Recommended Strategy:</strong> {recommendations.overall_strategy}
              </AlertDescription>
            </Alert>

            {/* Revenue Optimization Summary */}
            {recommendations.revenue_optimization_summary && (
              <div className="bg-green-50 p-4 rounded-lg border-2 border-green-300">
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  <span className="font-semibold text-green-900">Revenue Optimization Potential</span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-white p-2 rounded text-center">
                    <p className="text-xs text-slate-500">Current Estimate</p>
                    <p className="text-lg font-bold text-slate-700">
                      {formatCurrency(recommendations.revenue_optimization_summary.current_estimated_payment)}
                    </p>
                  </div>
                  <div className="bg-gradient-to-r from-green-100 to-emerald-100 p-2 rounded text-center border-2 border-green-400">
                    <p className="text-xs text-green-600">Optimized Potential</p>
                    <p className="text-lg font-bold text-green-700">
                      {formatCurrency(recommendations.revenue_optimization_summary.optimized_payment_potential)}
                    </p>
                  </div>
                </div>
                <div className="bg-white p-2 rounded border">
                  <p className="text-xs font-medium text-slate-700 mb-1">Key Drivers:</p>
                  <div className="flex flex-wrap gap-1">
                    {recommendations.revenue_optimization_summary.key_drivers?.map((driver, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">{driver}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Quick Wins */}
            {recommendations.quick_wins?.length > 0 && (
              <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-300">
                <p className="text-sm font-semibold text-yellow-900 mb-2 flex items-center gap-1">
                  <Sparkles className="w-4 h-4" />
                  Quick Wins - Immediate Actions
                </p>
                <div className="space-y-2">
                  {recommendations.quick_wins.map((win, idx) => (
                    <div key={idx} className="bg-white p-2 rounded border text-xs">
                      <p className="font-medium text-slate-800 mb-1">{win.action}</p>
                      <p className="text-slate-600">Pathway: <span className="font-semibold">{win.pathway}</span></p>
                      <p className="text-green-700">Impact: {win.impact}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pathway Recommendations */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">Recommended Pathways</p>
                <p className="text-xs text-slate-500">{selectedPathways.length} selected</p>
              </div>

              {recommendations.recommended_pathways?.map((pathway, idx) => {
                const isExpanded = expandedPathway === idx;
                const isSelected = selectedPathways.includes(idx);
                
                return (
                  <div 
                    key={idx}
                    className={`rounded-lg border-2 overflow-hidden ${
                      isSelected ? 'border-navy-400 ring-2 ring-navy-200' : 'border-slate-200'
                    }`}
                  >
                    {/* Pathway Header */}
                    <div className={`p-3 ${isSelected ? 'bg-navy-50' : 'bg-slate-50'}`}>
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            setSelectedPathways(prev => 
                              checked 
                                ? [...prev, idx]
                                : prev.filter(i => i !== idx)
                            );
                          }}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold text-slate-900">{pathway.pathway_name}</h4>
                              <Badge className={getPriorityColor(pathway.priority)}>
                                {pathway.priority}
                              </Badge>
                              {pathway.pathway_type === 'existing_pathway' && (
                                <Badge variant="outline" className="text-xs bg-white">
                                  System Pathway
                                </Badge>
                              )}
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {pathway.match_score}% match
                            </Badge>
                          </div>

                          <p className="text-sm text-slate-700 mb-2">{pathway.clinical_rationale}</p>

                          <div className="flex flex-wrap gap-2 mb-2">
                            <Badge className="bg-blue-100 text-blue-800 text-xs">
                              <Stethoscope className="w-3 h-3 mr-1" />
                              {pathway.primary_trigger}
                            </Badge>
                            <span className="text-xs text-slate-600">{pathway.trigger_details}</span>
                          </div>

                          {/* PDGM Impact Summary */}
                          {pathway.pdgm_impact && (
                            <div className="bg-white p-2 rounded border border-green-200 mt-2">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-xs font-medium text-green-800 flex items-center gap-1">
                                  <DollarSign className="w-3 h-3" />
                                  PDGM Impact
                                </p>
                                {pathway.pdgm_impact.estimated_payment_impact && (
                                  <Badge className="bg-green-600 text-white text-xs">
                                    {pathway.pdgm_impact.estimated_payment_impact}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-slate-700">{pathway.pdgm_impact.payment_impact_explanation}</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {pathway.pdgm_impact.affects_functional_level && (
                                  <Badge variant="outline" className="text-xs">
                                    <Activity className="w-3 h-3 mr-1" />
                                    Functional
                                  </Badge>
                                )}
                                {pathway.pdgm_impact.affects_comorbidity_adjustment && (
                                  <Badge variant="outline" className="text-xs">
                                    <ClipboardList className="w-3 h-3 mr-1" />
                                    Comorbidity
                                  </Badge>
                                )}
                                {pathway.pdgm_impact.affects_clinical_group && (
                                  <Badge variant="outline" className="text-xs">Clinical Group</Badge>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Expand/Collapse Button */}
                          <Button
                            onClick={() => setExpandedPathway(isExpanded ? null : idx)}
                            variant="ghost"
                            size="sm"
                            className="mt-2 text-xs"
                          >
                            {isExpanded ? (
                              <><ChevronUp className="w-3 h-3 mr-1" /> Hide Details</>
                            ) : (
                              <><ChevronDown className="w-3 h-3 mr-1" /> Show Details</>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="p-3 bg-white space-y-3 border-t">
                        {/* Expected Outcomes */}
                        {pathway.expected_outcomes?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-slate-700 mb-1">Expected Outcomes:</p>
                            <ul className="space-y-1">
                              {pathway.expected_outcomes.map((outcome, oIdx) => (
                                <li key={oIdx} className="text-xs text-slate-700 flex items-start gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                                  {outcome}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Documentation Requirements */}
                        {pathway.documentation_requirements?.length > 0 && (
                          <div className="bg-blue-50 p-3 rounded border border-blue-200">
                            <p className="text-xs font-semibold text-blue-800 mb-2">📝 Documentation Requirements:</p>
                            {pathway.documentation_requirements.map((req, rIdx) => (
                              <div key={rIdx} className="bg-white p-2 rounded border mb-2 last:mb-0">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-xs font-medium text-slate-800">{req.area}</p>
                                  <Badge variant="outline" className="text-xs">{req.frequency}</Badge>
                                </div>
                                {req.m_items_affected?.length > 0 && (
                                  <p className="text-xs text-navy-700 mb-1">
                                    M-items: {req.m_items_affected.join(', ')}
                                  </p>
                                )}
                                {req.sample_narrative && (
                                  <div className="bg-indigo-50 p-2 rounded mt-1">
                                    <p className="text-xs text-indigo-900 italic">"{req.sample_narrative}"</p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Recommended Interventions */}
                        {pathway.recommended_interventions?.length > 0 && (
                          <div className="bg-green-50 p-3 rounded border border-green-200">
                            <p className="text-xs font-semibold text-green-800 mb-2">🏥 Clinical Interventions:</p>
                            {pathway.recommended_interventions.map((intervention, iIdx) => (
                              <div key={iIdx} className="bg-white p-2 rounded border mb-2 last:mb-0">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-xs font-medium text-slate-800">{intervention.intervention}</p>
                                  <Badge variant="outline" className="text-xs">{intervention.frequency}</Badge>
                                </div>
                                <p className="text-xs text-slate-600 mb-1">
                                  <strong>Skilled Rationale:</strong> {intervention.skilled_rationale}
                                </p>
                                <p className="text-xs text-green-700">
                                  <strong>Expected Impact:</strong> {intervention.expected_functional_impact}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Detailed PDGM Impact */}
                        {pathway.pdgm_impact && (
                          <div className="bg-navy-50 p-3 rounded border border-navy-200">
                            <p className="text-xs font-semibold text-navy-800 mb-2">📊 Detailed PDGM Impact:</p>
                            <div className="space-y-2 text-xs">
                              {pathway.pdgm_impact.clinical_group_change && (
                                <div className="bg-white p-2 rounded">
                                  <p className="text-slate-600">Clinical Group: {pathway.pdgm_impact.clinical_group_change}</p>
                                </div>
                              )}
                              {pathway.pdgm_impact.functional_improvement_potential && (
                                <div className="bg-white p-2 rounded">
                                  <p className="text-slate-600">Functional: {pathway.pdgm_impact.functional_improvement_potential}</p>
                                </div>
                              )}
                              {pathway.pdgm_impact.comorbidity_opportunities && (
                                <div className="bg-white p-2 rounded">
                                  <p className="text-slate-600">Comorbidity: {pathway.pdgm_impact.comorbidity_opportunities}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Tasks Preview */}
                        {pathway.tasks_to_generate?.length > 0 && (
                          <div className="bg-slate-50 p-2 rounded border">
                            <p className="text-xs font-medium text-slate-700 mb-1">
                              {pathway.tasks_to_generate.length} tasks will be created
                            </p>
                            <div className="space-y-1">
                              {pathway.tasks_to_generate.slice(0, 3).map((task, tIdx) => (
                                <div key={tIdx} className="text-xs text-slate-600 flex items-center gap-1">
                                  <span className="w-1 h-1 bg-slate-400 rounded-full"></span>
                                  {task.title}
                                </div>
                              ))}
                              {pathway.tasks_to_generate.length > 3 && (
                                <p className="text-xs text-slate-500">+{pathway.tasks_to_generate.length - 3} more</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Activate Button */}
            {selectedPathways.length > 0 && (
              <div className="bg-gradient-to-r from-navy-100 to-gold-100 p-4 rounded-lg border-2 border-navy-300">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-navy-900">
                      Activate {selectedPathways.length} selected pathway{selectedPathways.length > 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-navy-700">
                      This will generate {selectedPathways.reduce((sum, idx) => 
                        sum + (recommendations.recommended_pathways[idx]?.tasks_to_generate?.length || 0), 0
                      )} tasks
                    </p>
                  </div>
                  <Button
                    onClick={handleActivatePathways}
                    className="bg-navy-600 hover:bg-navy-700"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Activate Pathways
                  </Button>
                </div>
              </div>
            )}

            {/* Regenerate */}
            <Button
              onClick={() => { setRecommendations(null); analyzePathways(); }}
              variant="outline"
              size="sm"
              className="w-full"
            >
              Regenerate Recommendations
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}