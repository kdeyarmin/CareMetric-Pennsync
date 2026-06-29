import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Sparkles, AlertTriangle, CheckCircle2, Edit3, Save, Plus, X, Target } from "lucide-react";
import AIFieldIndicator from "@/components/ui/ai-field-indicator";
import ProgressFeedback from "@/components/ui/progress-feedback";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from 'sonner';

export default function AICarePlanSuggestionEngine({ 
  referralData, 
  oasisData,
  patientId,
  onCarePlansGenerated,
  autoGenerate = false 
}) {
  const ai = useAICall();
  const [carePlans, setCarePlans] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editedPlan, setEditedPlan] = useState(null);
  const [generationStage, setGenerationStage] = useState(0);
  const progressIntervalRef = useRef(null);

  // Clear the progress interval if the component unmounts mid-generation.
  useEffect(() => () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  }, []);

  const generationStages = useMemo(() => [
    "Analyzing patient diagnoses and comorbidities...",
    "Evaluating functional limitations and ADLs...",
    "Identifying clinical risk factors...",
    "Formulating evidence-based care plans...",
    "Generating specific interventions..."
  ], []);

  const generateCarePlans = useCallback(async () => {
    if (!referralData) {
      toast.error("No referral data available");
      return;
    }

    setGenerationStage(0);

    const progressInterval = setInterval(() => {
      setGenerationStage(prev => Math.min(prev + 1, generationStages.length - 1));
    }, 2000);
    progressIntervalRef.current = progressInterval;

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert home health clinical care planning specialist with expertise in Medicare compliance and evidence-based practice.

Analyze the following patient data and generate comprehensive, individualized care plans:

REFERRAL DATA:
${JSON.stringify(referralData, null, 2)}

OASIS ASSESSMENT DATA:
${JSON.stringify(oasisData || {}, null, 2)}

Generate 4-6 priority care plans based on:
1. Primary and secondary diagnoses
2. Functional limitations (ADL/IADL deficits)
3. Safety risks (falls, medication management, etc.)
4. Wound care needs
5. Symptom management (pain, SOB, etc.)
6. Psychosocial needs

For EACH care plan, provide:

**PROBLEM/NURSING DIAGNOSIS:**
- Use NANDA-approved nursing diagnosis format when applicable
- Be specific and patient-centered
- Include "related to" and "as evidenced by" when appropriate

**GOAL:**
- Use SMART goal format (Specific, Measurable, Achievable, Relevant, Time-bound)
- Include specific measurement criteria
- Set realistic timeframe (typically 30-60 days for home health)
- Patient-centered language

**INTERVENTIONS:**
- List 4-6 specific nursing interventions
- Evidence-based and best practice aligned
- Include frequency recommendations
- Address skilled nursing, education, monitoring, and coordination
- Be specific about what nurse will DO

**BASELINE MEASUREMENT:**
- What will you measure initially?
- Current status/level

**FREQUENCY:**
- How often to assess progress (e.g., "Each visit", "Weekly", "PRN")

**CLINICAL REVIEW FLAGS:**
Array of items requiring clinical verification or special attention. Examples:
- "Verify medication dosages with physician"
- "Assess actual ADL level during first visit"
- "Confirm wound measurements on admission"
- "Review fall history and home safety"

**PRIORITY LEVEL:**
- critical: Immediate safety/medical concern requiring urgent attention
- high: Significant impact on patient outcomes
- medium: Important for overall care
- low: Supportive/preventive care

**EVIDENCE/RATIONALE:**
- Brief clinical reasoning for this care plan
- How it supports Medicare coverage criteria

Generate care plans prioritized by clinical importance. Focus on what requires SKILLED nursing intervention.`,
        response_json_schema: {
          type: "object",
          properties: {
            care_plans: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  goal: { type: "string" },
                  interventions: { 
                    type: "array",
                    items: { type: "string" }
                  },
                  baseline_measurement: { type: "string" },
                  frequency: { type: "string" },
                  priority: {
                    type: "string",
                    enum: ["critical", "high", "medium", "low"]
                  },
                  clinical_review_flags: {
                    type: "array",
                    items: { type: "string" }
                  },
                  evidence_rationale: { type: "string" },
                  target_date_days: {
                    type: "number",
                    description: "Days until target achievement (typically 30-60)"
                  }
                }
              }
            },
            summary: {
              type: "string",
              description: "Overall care planning summary and key considerations"
            }
          }
        }
      });

      clearInterval(progressInterval);
      setGenerationStage(generationStages.length - 1);
      setCarePlans(result.care_plans || []);
      
      if (onCarePlansGenerated) {
        onCarePlansGenerated(result.care_plans, result.summary);
      }
    } catch (error) {
      clearInterval(progressInterval);
      console.error('Error generating care plans:', error);
      toast.error('Failed to generate care plans. Please try again.');
    } finally {
      setGenerationStage(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [referralData, oasisData, generationStages, onCarePlansGenerated]);

  useEffect(() => {
    if (autoGenerate && referralData && !carePlans.length && !ai.loading) {
      generateCarePlans();
    }
  }, [autoGenerate, referralData, carePlans.length, ai.loading, generateCarePlans]);

  const handleEditPlan = (index) => {
    setEditingIndex(index);
    setEditedPlan({ ...carePlans[index] });
  };

  const handleSaveEdit = () => {
    const updated = [...carePlans];
    updated[editingIndex] = editedPlan;
    setCarePlans(updated);
    setEditingIndex(null);
    setEditedPlan(null);
  };

  const handleRemovePlan = (index) => {
    setCarePlans(carePlans.filter((_, i) => i !== index));
  };

  const handleCreateCarePlan = async (plan) => {
    if (!patientId) {
      toast.error("Patient ID required to create care plan");
      return;
    }

    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + (plan.target_date_days || 60));

      await base44.entities.CarePlan.create({
        patient_id: patientId,
        problem: plan.problem,
        goal: plan.goal,
        interventions: plan.interventions,
        baseline_measurement: plan.baseline_measurement,
        frequency: plan.frequency,
        target_date: targetDate.toISOString().split('T')[0],
        status: 'active'
      });

      toast.success("Care plan created successfully!");
    } catch (error) {
      console.error('Error creating care plan:', error);
      toast.error('Failed to create care plan. Please try again.');
    }
  };

  const getPriorityColor = (priority) => {
    const colors = {
      critical: "bg-red-100 text-red-800 border-red-300",
      high: "bg-orange-100 text-orange-800 border-orange-300",
      medium: "bg-blue-100 text-blue-800 border-blue-300",
      low: "bg-slate-100 text-slate-800 border-slate-300"
    };
    return colors[priority] || colors.medium;
  };

  if (ai.loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <ProgressFeedback
            stages={generationStages}
            currentStage={generationStage}
            message="Generating Care Plans"
          />
        </CardContent>
      </Card>
    );
  }

  if (!carePlans.length) {
    return (
      <Card className="border-2 border-green-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-green-600" />
            AI Care Plan Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 mb-4">
            Generate evidence-based, individualized care plan suggestions based on referral data and OASIS assessment.
          </p>
          <Button 
            onClick={generateCarePlans}
            className="bg-green-600 hover:bg-green-700"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Care Plans
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-green-300">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-green-600" />
              AI-Generated Care Plan Suggestions ({carePlans.length})
            </CardTitle>
            <AIFieldIndicator confidence={90} source="AI" />
          </div>
          <Button 
            size="sm" 
            variant="outline"
            onClick={generateCarePlans}
            className="text-green-600"
          >
            <Sparkles className="w-4 h-4 mr-1" />
            Regenerate
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="space-y-3">
          {carePlans.map((plan, index) => (
            <AccordionItem key={index} value={`plan-${index}`} className="border rounded-lg">
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex items-center gap-2 flex-1">
                  <Badge className={getPriorityColor(plan.priority)}>
                    {plan.priority}
                  </Badge>
                  <span className="font-semibold text-left flex-1">
                    {editingIndex === index ? "Editing..." : plan.problem}
                  </span>
                  {plan.clinical_review_flags?.length > 0 && (
                    <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Review Needed
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                {editingIndex === index ? (
                  <div className="space-y-4">
                    <div>
                      <label htmlFor={`careplan-problem-${index}`} className="text-sm font-semibold text-slate-700">Problem/Diagnosis</label>
                      <Textarea
                        id={`careplan-problem-${index}`}
                        value={editedPlan.problem}
                        onChange={(e) => setEditedPlan({ ...editedPlan, problem: e.target.value })}
                        className="mt-1"
                        rows={2}
                      />
                    </div>
                    <div>
                      <label htmlFor={`careplan-goal-${index}`} className="text-sm font-semibold text-slate-700">Goal</label>
                      <Textarea
                        id={`careplan-goal-${index}`}
                        value={editedPlan.goal}
                        onChange={(e) => setEditedPlan({ ...editedPlan, goal: e.target.value })}
                        className="mt-1"
                        rows={2}
                      />
                    </div>
                    <div>
                      <label htmlFor={`careplan-baseline-${index}`} className="text-sm font-semibold text-slate-700">Baseline Measurement</label>
                      <Input
                        id={`careplan-baseline-${index}`}
                        value={editedPlan.baseline_measurement}
                        onChange={(e) => setEditedPlan({ ...editedPlan, baseline_measurement: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label htmlFor={`careplan-frequency-${index}`} className="text-sm font-semibold text-slate-700">Frequency</label>
                      <Input
                        id={`careplan-frequency-${index}`}
                        value={editedPlan.frequency}
                        onChange={(e) => setEditedPlan({ ...editedPlan, frequency: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveEdit} className="bg-green-600">
                        <Save className="w-4 h-4 mr-1" />
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingIndex(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                      <p className="text-xs font-semibold text-green-900 mb-1">GOAL</p>
                      <p className="text-sm text-slate-900">{plan.goal}</p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-2">INTERVENTIONS</p>
                      <ul className="space-y-1">
                        {plan.interventions?.map((intervention, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-900">
                            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                            <span>{intervention}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-blue-50 p-2 rounded">
                        <p className="text-xs font-semibold text-blue-900">Baseline</p>
                        <p className="text-sm text-slate-900">{plan.baseline_measurement}</p>
                      </div>
                      <div className="bg-navy-50 p-2 rounded">
                        <p className="text-xs font-semibold text-navy-900">Frequency</p>
                        <p className="text-sm text-slate-900">{plan.frequency}</p>
                      </div>
                    </div>

                    {plan.clinical_review_flags?.length > 0 && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <div className="flex items-start gap-2 mb-2">
                          <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                          <p className="text-xs font-semibold text-yellow-900">Clinical Review Required</p>
                        </div>
                        <ul className="space-y-1 ml-6">
                          {(plan.clinical_review_flags || []).map((flag, i) => (
                            <li key={i} className="text-xs text-yellow-800">• {flag}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {plan.evidence_rationale && (
                      <div className="bg-slate-50 p-3 rounded border">
                        <p className="text-xs font-semibold text-slate-700 mb-1">Evidence & Rationale</p>
                        <p className="text-xs text-slate-600 italic">{plan.evidence_rationale}</p>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      {patientId && (
                        <Button 
                          size="sm" 
                          onClick={() => handleCreateCarePlan(plan)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Create Care Plan
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => handleEditPlan(index)}>
                        <Edit3 className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => handleRemovePlan(index)}
                        className="text-red-600"
                      >
                        <X className="w-4 h-4 mr-1" />
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}