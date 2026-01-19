import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Brain, Loader2, Sparkles, CheckCircle2, AlertCircle, Target, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function AICarePlanGenerator({ patientId, onCarePlansCreated }) {
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPlans, setSelectedPlans] = useState([]);
  const [creating, setCreating] = useState(false);

  const generateSuggestions = async () => {
    setGenerating(true);
    try {
      const { data } = await base44.functions.invoke('generateAICarePlan', {
        patient_id: patientId,
        auto_create: false
      });

      setSuggestions(data.ai_suggestions);
      setSelectedPlans(data.ai_suggestions.care_plans.map((_, idx) => idx));
      setDialogOpen(true);
      toast.success('AI care plan suggestions generated');
    } catch (error) {
      toast.error('Failed to generate care plan suggestions');
      console.error(error);
    } finally {
      setGenerating(false);
    }
  };

  const createSelectedPlans = async () => {
    if (!suggestions || selectedPlans.length === 0) return;

    setCreating(true);
    try {
      const plansToCreate = selectedPlans.map(idx => suggestions.care_plans[idx]);
      
      for (const plan of plansToCreate) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + (plan.estimated_days || 60));

        await base44.entities.CarePlan.create({
          patient_id: patientId,
          problem: plan.problem,
          goal: plan.goal,
          interventions: plan.interventions,
          baseline_measurement: plan.baseline_measurement,
          current_measurement: plan.baseline_measurement,
          frequency: plan.frequency,
          target_date: targetDate.toISOString().split('T')[0],
          status: 'active',
          progress_percentage: 0
        });
      }

      toast.success(`Created ${selectedPlans.length} care plan(s)`);
      setDialogOpen(false);
      setSuggestions(null);
      setSelectedPlans([]);
      if (onCarePlansCreated) onCarePlansCreated();
    } catch (error) {
      toast.error('Failed to create care plans');
      console.error(error);
    } finally {
      setCreating(false);
    }
  };

  const togglePlanSelection = (index) => {
    setSelectedPlans(prev => 
      prev.includes(index) 
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <>
      <Button
        onClick={generateSuggestions}
        disabled={generating}
        className="bg-purple-600 hover:bg-purple-700"
      >
        {generating ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Analyzing Patient...
          </>
        ) : (
          <>
            <Brain className="w-4 h-4 mr-2" />
            Generate AI Care Plans
          </>
        )}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          {suggestions && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  AI-Generated Care Plan Suggestions
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {/* Overall Assessment */}
                {suggestions.overall_assessment && (
                  <Card className="bg-purple-50 border-purple-200">
                    <CardContent className="p-4">
                      <h4 className="font-semibold text-sm text-purple-900 mb-2 flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Overall Assessment
                      </h4>
                      <p className="text-sm text-purple-800">{suggestions.overall_assessment}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Care Plan Priorities */}
                {suggestions.care_plan_priorities?.length > 0 && (
                  <Card className="bg-blue-50 border-blue-200">
                    <CardContent className="p-4">
                      <h4 className="font-semibold text-sm text-blue-900 mb-2 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Priority Focus Areas
                      </h4>
                      <ul className="text-sm text-blue-800 space-y-1">
                        {suggestions.care_plan_priorities.map((priority, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-blue-500 mt-0.5">•</span>
                            <span>{priority}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Suggested Care Plans */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Suggested Care Plans ({suggestions.care_plans?.length})
                  </h3>
                  
                  {suggestions.care_plans?.map((plan, idx) => (
                    <Card key={idx} className={`border-l-4 ${
                      plan.priority === 'high' ? 'border-l-red-500' :
                      plan.priority === 'medium' ? 'border-l-yellow-500' :
                      'border-l-blue-500'
                    }`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={selectedPlans.includes(idx)}
                            onCheckedChange={() => togglePlanSelection(idx)}
                            className="mt-1"
                          />
                          <div className="flex-1 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge className={getPriorityColor(plan.priority)}>
                                    {plan.priority} priority
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    {plan.estimated_days} days
                                  </Badge>
                                </div>
                                <h4 className="font-semibold text-gray-900">{plan.problem}</h4>
                              </div>
                            </div>

                            <div>
                              <p className="text-sm font-medium text-gray-700 mb-1">Goal:</p>
                              <p className="text-sm text-gray-600">{plan.goal}</p>
                            </div>

                            <div>
                              <p className="text-sm font-medium text-gray-700 mb-1">Interventions:</p>
                              <ul className="space-y-1">
                                {plan.interventions.map((intervention, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                                    <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />
                                    <span>{intervention}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="font-medium text-gray-700">Baseline:</p>
                                <p className="text-gray-600">{plan.baseline_measurement}</p>
                              </div>
                              <div>
                                <p className="font-medium text-gray-700">Target:</p>
                                <p className="text-gray-600">{plan.target_measurement}</p>
                              </div>
                            </div>

                            <div>
                              <p className="text-sm font-medium text-gray-700 mb-1">Frequency:</p>
                              <p className="text-sm text-gray-600">{plan.frequency}</p>
                            </div>

                            {plan.rationale && (
                              <div className="p-3 bg-purple-50 rounded-lg">
                                <p className="text-xs font-medium text-purple-900 mb-1">AI Rationale:</p>
                                <p className="text-xs text-purple-800">{plan.rationale}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Monitoring Recommendations */}
                {suggestions.monitoring_recommendations?.length > 0 && (
                  <Card className="bg-yellow-50 border-yellow-200">
                    <CardContent className="p-4">
                      <h4 className="font-semibold text-sm text-yellow-900 mb-2 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Monitoring Recommendations
                      </h4>
                      <ul className="text-sm text-yellow-800 space-y-1">
                        {suggestions.monitoring_recommendations.map((rec, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-yellow-500 mt-0.5">•</span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={createSelectedPlans}
                  disabled={creating || selectedPlans.length === 0}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Create {selectedPlans.length} Plan(s)
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}