import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Brain,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Activity,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { format, differenceInDays, isValid } from "date-fns";
import { toast } from 'sonner';

export default function CarePlanEvolution({ 
  _patientId, 
  patientName,
  carePlans = [], 
  visits = [],
  onCarePlanUpdated 
}) {
  const queryClient = useQueryClient();
  const ai = useAICall();
  const [recommendations, setRecommendations] = useState(null);
  const [selectedUpdates, setSelectedUpdates] = useState([]);
  const [isApplying, setIsApplying] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const analyzeCarePlanProgress = async () => {
    if (carePlans.length === 0) {
      toast.error("No care plans to analyze");
      return;
    }

    
    try {
      // Prepare care plan data with visit progress
      const carePlanData = carePlans.map(cp => {
        const createdDate = new Date(cp.created_date);
        const relatedVisits = visits.filter(v => {
          const visitDate = new Date(v.visit_date);
          return v.status === 'completed' && 
            isValid(visitDate) && 
            isValid(createdDate) &&
            visitDate >= createdDate;
        });
        
        // Extract progress indicators from visit notes
        const progressNotes = relatedVisits
          .filter(v => v.nurse_notes)
          .map(v => ({
            date: v.visit_date,
            notes: v.nurse_notes.substring(0, 500),
            vitals: v.vital_signs
          }));

        return {
          id: cp.id,
          problem: cp.problem,
          goal: cp.goal,
          interventions: cp.interventions,
          status: cp.status,
          target_date: cp.target_date,
          baseline_measurement: cp.baseline_measurement,
          created_date: cp.created_date,
          days_active: isValid(createdDate) ? differenceInDays(new Date(), createdDate) : 0,
          visit_count: relatedVisits.length,
          recent_progress: progressNotes.slice(0, 3)
        };
      });

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a clinical care plan optimization AI. Analyze these active care plans and patient progress to recommend updates.

PATIENT: ${patientName}

CARE PLANS WITH PROGRESS DATA:
${JSON.stringify(carePlanData, null, 2)}

For each care plan, analyze:
1. Is the patient making progress toward the goal?
2. Should the goal be modified (upgraded if ahead, adjusted if struggling)?
3. Are interventions effective or should they change?
4. Should the target date be extended or can it be shortened?
5. Should the care plan be marked as 'met' or 'revised'?

Consider:
- Vital sign trends indicating improvement or decline
- Time elapsed vs target date
- Visit frequency and documented progress
- Clinical best practices for goal modification

Return JSON:
{
  "overall_assessment": "summary of patient's care plan progress",
  "recommendations": [
    {
      "care_plan_id": "id",
      "current_problem": "current problem statement",
      "current_goal": "current goal",
      "progress_status": "on_track" | "ahead" | "behind" | "stalled" | "goal_met",
      "progress_percentage": 0-100,
      "recommendation_type": "upgrade_goal" | "modify_goal" | "change_interventions" | "extend_timeline" | "shorten_timeline" | "mark_met" | "mark_revised" | "no_change",
      "rationale": "why this change is recommended",
      "suggested_changes": {
        "new_goal": "updated goal if applicable",
        "new_interventions": ["intervention1", "intervention2"],
        "new_target_date_days": number of days to add/subtract,
        "new_status": "active" | "met" | "revised"
      },
      "priority": "high" | "medium" | "low",
      "clinical_notes": "additional clinical considerations"
    }
  ],
  "new_care_plan_suggestions": [
    {
      "problem": "new problem identified from progress notes",
      "goal": "suggested goal",
      "interventions": ["intervention1"],
      "rationale": "why this new care plan is needed"
    }
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_assessment: { type: "string" },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  care_plan_id: { type: "string" },
                  current_problem: { type: "string" },
                  current_goal: { type: "string" },
                  progress_status: { type: "string" },
                  progress_percentage: { type: "number" },
                  recommendation_type: { type: "string" },
                  rationale: { type: "string" },
                  suggested_changes: { type: "object" },
                  priority: { type: "string" },
                  clinical_notes: { type: "string" }
                }
              }
            },
            new_care_plan_suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  goal: { type: "string" },
                  interventions: { type: "array", items: { type: "string" } },
                  rationale: { type: "string" }
                }
              }
            }
          }
        }
      });

      setRecommendations(result);
      // Auto-select high priority recommendations
      const highPriority = result.recommendations
        ?.filter(r => r.priority === 'high' && r.recommendation_type !== 'no_change')
        .map(r => r.care_plan_id) || [];
      setSelectedUpdates(highPriority);
      
    } catch (error) {
      console.error("Error analyzing care plans:", error);
    }
    
  };

  const applySelectedUpdates = async () => {
    if (selectedUpdates.length === 0) return;
    
    setIsApplying(true);
    
    try {
      for (const cpId of selectedUpdates) {
        const rec = recommendations.recommendations.find(r => r.care_plan_id === cpId);
        if (!rec || !rec.suggested_changes) continue;

        const updates = {};
        
        if (rec.suggested_changes.new_goal) {
          updates.goal = rec.suggested_changes.new_goal;
        }
        if (rec.suggested_changes.new_interventions) {
          updates.interventions = rec.suggested_changes.new_interventions;
        }
        if (rec.suggested_changes.new_status) {
          updates.status = rec.suggested_changes.new_status;
        }
        if (rec.suggested_changes.new_target_date_days) {
          const currentPlan = carePlans.find(cp => cp.id === cpId);
          const currentTarget = currentPlan?.target_date ? new Date(currentPlan.target_date) : new Date();
          currentTarget.setDate(currentTarget.getDate() + rec.suggested_changes.new_target_date_days);
          updates.target_date = format(currentTarget, 'yyyy-MM-dd');
        }

        if (Object.keys(updates).length > 0) {
          await base44.entities.CarePlan.update(cpId, updates);
        }
      }

      // Create new suggested care plans if any were selected
      // (Would need additional UI for this)

      queryClient.invalidateQueries({ queryKey: ['patientCarePlans'] });
      onCarePlanUpdated && onCarePlanUpdated();
      
      toast.success(`Successfully updated ${selectedUpdates.length} care plan(s)`);
      setRecommendations(null);
      setSelectedUpdates([]);
      
    } catch (error) {
      console.error("Error applying updates:", error);
      toast.error("Error updating care plans");
    }
    
    setIsApplying(false);
  };

  const toggleSelection = (cpId) => {
    setSelectedUpdates(prev => 
      prev.includes(cpId) 
        ? prev.filter(id => id !== cpId)
        : [...prev, cpId]
    );
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'on_track': return <Activity className="w-4 h-4 text-blue-500" />;
      case 'ahead': return <TrendingUp className="w-4 h-4 text-green-500" />;
      case 'behind': return <TrendingDown className="w-4 h-4 text-orange-500" />;
      case 'stalled': return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'goal_met': return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      default: return <Activity className="w-4 h-4 text-slate-500" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'on_track': return 'bg-blue-100 text-blue-800';
      case 'ahead': return 'bg-green-100 text-green-800';
      case 'behind': return 'bg-orange-100 text-orange-800';
      case 'stalled': return 'bg-red-100 text-red-800';
      case 'goal_met': return 'bg-green-100 text-green-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-blue-500';
      default: return 'bg-slate-500';
    }
  };

  const activeCarePlans = carePlans.filter(cp => cp.status === 'active');

  if (activeCarePlans.length === 0) {
    return null;
  }

  return (
    <Card className="border-indigo-200">
      <CardHeader 
        className="py-3 bg-gradient-to-r from-indigo-50 to-navy-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-4 h-4 text-indigo-600" />
            AI Care Plan Evolution
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {activeCarePlans.length} active plans
            </Badge>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 space-y-4">
          {!recommendations ? (
            <div className="text-center py-4">
              <Brain className="w-12 h-12 mx-auto mb-3 text-indigo-300" />
              <p className="text-sm text-slate-600 mb-3">
                Analyze patient progress to get AI recommendations for care plan updates
              </p>
              <Button 
                onClick={analyzeCarePlanProgress}
                disabled={ai.loading}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {ai.loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing Progress...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Analyze & Recommend Updates
                  </>
                )}
              </Button>
            </div>
          ) : (
            <>
              {/* Overall Assessment */}
              <Alert className="bg-indigo-50 border-indigo-200">
                <Brain className="w-4 h-4 text-indigo-600" />
                <AlertDescription className="text-indigo-900">
                  <p className="font-semibold mb-1">AI Assessment</p>
                  <p className="text-sm">{recommendations.overall_assessment}</p>
                </AlertDescription>
              </Alert>

              {/* Recommendations */}
              <div className="space-y-3">
                {recommendations.recommendations?.map((rec) => (
                  <div 
                    key={rec.care_plan_id}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      selectedUpdates.includes(rec.care_plan_id)
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {rec.recommendation_type !== 'no_change' && (
                        <Checkbox
                          checked={selectedUpdates.includes(rec.care_plan_id)}
                          onCheckedChange={() => toggleSelection(rec.care_plan_id)}
                          className="mt-1"
                        />
                      )}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(rec.progress_status)}
                            <span className="font-medium text-sm">{rec.current_problem}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={getStatusColor(rec.progress_status)}>
                              {(rec.progress_status || '').replace('_', ' ')}
                            </Badge>
                            <Badge className={`${getPriorityColor(rec.priority)} text-white text-xs`}>
                              {rec.priority}
                            </Badge>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-2">
                          <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                            <span>Progress toward goal</span>
                            <span>{rec.progress_percentage}%</span>
                          </div>
                          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${
                                rec.progress_percentage >= 80 ? 'bg-green-500' :
                                rec.progress_percentage >= 50 ? 'bg-blue-500' :
                                rec.progress_percentage >= 25 ? 'bg-yellow-500' :
                                'bg-red-500'
                              }`}
                              style={{ width: `${rec.progress_percentage}%` }}
                            />
                          </div>
                        </div>

                        {/* Current Goal */}
                        <p className="text-xs text-slate-600 mb-2">
                          <strong>Current Goal:</strong> {rec.current_goal}
                        </p>

                        {/* Recommendation */}
                        {rec.recommendation_type !== 'no_change' && (
                          <div className="bg-white p-2 rounded border mt-2">
                            <div className="flex items-center gap-1 text-xs font-semibold text-indigo-700 mb-1">
                              <ArrowRight className="w-3 h-3" />
                              Recommended: {(rec.recommendation_type || '').replace(/_/g, ' ')}
                            </div>
                            <p className="text-xs text-slate-700 mb-2">{rec.rationale}</p>
                            
                            {rec.suggested_changes?.new_goal && (
                              <p className="text-xs">
                                <strong>New Goal:</strong> {rec.suggested_changes.new_goal}
                              </p>
                            )}
                            {rec.suggested_changes?.new_interventions && (
                              <p className="text-xs">
                                <strong>New Interventions:</strong> {rec.suggested_changes.new_interventions.join(', ')}
                              </p>
                            )}
                          </div>
                        )}

                        {rec.clinical_notes && (
                          <p className="text-xs text-slate-500 mt-2 italic">
                            💡 {rec.clinical_notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* New Care Plan Suggestions */}
              {recommendations.new_care_plan_suggestions?.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-semibold text-slate-700 mb-2">
                    Suggested New Care Plans:
                  </p>
                  {recommendations.new_care_plan_suggestions.map((suggestion, idx) => (
                    <div key={idx} className="p-2 bg-green-50 rounded border border-green-200 mb-2">
                      <p className="text-xs font-medium text-green-800">{suggestion.problem}</p>
                      <p className="text-xs text-green-700">{suggestion.goal}</p>
                      <p className="text-xs text-slate-600 italic">{suggestion.rationale}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={applySelectedUpdates}
                  disabled={selectedUpdates.length === 0 || isApplying}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {isApplying ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Applying...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Apply {selectedUpdates.length} Update(s)
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRecommendations(null);
                    setSelectedUpdates([]);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="ghost"
                  onClick={analyzeCarePlanProgress}
                  disabled={ai.loading}
                >
                  <RefreshCw className={`w-4 h-4 ${ai.loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}