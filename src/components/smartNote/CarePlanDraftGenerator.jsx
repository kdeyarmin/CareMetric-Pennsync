import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Target, Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function CarePlanDraftGenerator({ 
  diagnosis, 
  noteContent,
  vitalSigns,
  patientId,
  patientContext,
  onCarePlanCreated 
}) {
  const [loading, setLoading] = useState(false);
  const [draftPlans, setDraftPlans] = useState(null);
  const [creatingPlans, setCreatingPlans] = useState({});

  const generateCarePlans = async () => {
    setLoading(true);
    try {
      // Build comprehensive patient context
      const contextDetails = [];
      if (patientContext?.age) {
        contextDetails.push(`Age: ${patientContext.age} years`);
      }
      if (patientContext?.diagnoses?.length > 0) {
        contextDetails.push(`Diagnoses: ${patientContext.diagnoses.join(', ')}`);
      }
      if (patientContext?.medications?.length > 0) {
        const medNames = patientContext.medications.map(m => m.name || m).join(', ');
        contextDetails.push(`Current Medications: ${medNames}`);
      }
      if (patientContext?.allergies) {
        contextDetails.push(`Allergies: ${patientContext.allergies}`);
      }
      if (vitalSigns && Object.values(vitalSigns).some(v => v)) {
        const vitals = Object.entries(vitalSigns)
          .filter(([k, v]) => v)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        contextDetails.push(`Vital Signs: ${vitals}`);
      }

      const prompt = `Based on the following comprehensive patient assessment, generate evidence-based care plan drafts:

PRIMARY DIAGNOSIS: ${diagnosis}

ENHANCED CLINICAL NOTES:
${noteContent || 'Not provided'}

PATIENT CONTEXT:
${contextDetails.join('\n')}

Generate 2-4 prioritized care plans focusing on:
1. Most critical patient needs based on diagnosis and clinical findings
2. Comorbidities and risk factors identified
3. Patient safety concerns
4. Medication management needs
5. Functional improvement opportunities

For each care plan provide:
- Problem/Nursing Diagnosis (specific and measurable)
- SMART Goal (Specific, Measurable, Achievable, Relevant, Time-bound)
- Evidence-Based Interventions (3-5 specific actions)
- Expected Timeframe for goal achievement
- Evaluation Criteria (how to measure progress)
- Priority Level (high/medium/low)
- Clinical Rationale (why this is important for this patient)

Consider the patient's age, comorbidities, current medications, and any safety risks when formulating plans.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
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
                  timeframe: { type: "string" },
                  evaluation_criteria: { type: "string" },
                  priority: { 
                    type: "string",
                    enum: ["high", "medium", "low"]
                  },
                  rationale: { type: "string" }
                }
              }
            }
          }
        }
      });

      setDraftPlans(response.care_plans);
    } catch (error) {
      console.error('Error generating care plans:', error);
      toast.error('Failed to generate care plans');
    } finally {
      setLoading(false);
    }
  };

  const createCarePlan = async (plan, index) => {
    if (!patientId) {
      toast.error('Please select a patient first');
      return;
    }

    setCreatingPlans(prev => ({ ...prev, [index]: true }));
    try {
      // Calculate target date based on timeframe
      const targetDate = (() => {
        const today = new Date();
        if (plan.timeframe?.includes('week')) {
          const weeks = parseInt(plan.timeframe) || 4;
          today.setDate(today.getDate() + (weeks * 7));
        } else if (plan.timeframe?.includes('month')) {
          const months = parseInt(plan.timeframe) || 2;
          today.setMonth(today.getMonth() + months);
        } else {
          today.setDate(today.getDate() + 60); // Default 60 days
        }
        return today.toISOString().split('T')[0];
      })();

      await base44.entities.CarePlan.create({
        patient_id: patientId,
        problem: plan.problem,
        goal: plan.goal,
        interventions: plan.interventions,
        target_date: targetDate,
        status: 'active',
        baseline_measurement: plan.evaluation_criteria,
        frequency: 'weekly'
      });

      toast.success('Care plan created successfully');
      if (onCarePlanCreated) {
        onCarePlanCreated(plan);
      }
      
      // Remove created plan from list
      setDraftPlans(prev => prev.filter((_, i) => i !== index));
    } catch (error) {
      console.error('Error creating care plan:', error);
      toast.error('Failed to create care plan');
    } finally {
      setCreatingPlans(prev => ({ ...prev, [index]: false }));
    }
  };

  if (!diagnosis) {
    return null;
  }

  return (
    <Card className="border-green-200 bg-green-50 dark:bg-green-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Target className="w-4 h-4 text-green-600" />
            Draft Care Plans
          </span>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={generateCarePlans}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Generating...
              </>
            ) : (
              'Generate Plans'
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            <span className="ml-2 text-sm text-slate-600">Creating care plans...</span>
          </div>
        ) : draftPlans?.length > 0 ? (
          draftPlans.map((plan, idx) => (
            <div 
              key={idx} 
              className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-green-200"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={
                      plan.priority === 'high' ? 'bg-red-500' :
                      plan.priority === 'medium' ? 'bg-yellow-500' :
                      'bg-blue-500'
                    }>
                      {plan.priority} priority
                    </Badge>
                  </div>
                  <h5 className="font-semibold text-sm text-slate-900 dark:text-slate-100 mb-1">
                    {plan.problem}
                  </h5>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                    {plan.rationale}
                  </p>
                </div>
                <Button 
                  size="sm"
                  onClick={() => createCarePlan(plan, idx)}
                  disabled={creatingPlans[idx] || !patientId}
                  className="bg-green-600 hover:bg-green-700 flex-shrink-0"
                >
                  {creatingPlans[idx] ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-3 h-3 mr-1" />
                      Add
                    </>
                  )}
                </Button>
              </div>

              <div className="space-y-2">
                <div className="bg-green-50 dark:bg-green-900 p-2 rounded">
                  <p className="text-xs font-medium text-green-900 dark:text-green-300 mb-1">
                    📋 Goal:
                  </p>
                  <p className="text-xs text-green-800 dark:text-green-200">
                    {plan.goal}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Interventions:
                  </p>
                  <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5 ml-4">
                    {plan.interventions?.map((intervention, iIdx) => (
                      <li key={iIdx}>• {intervention}</li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    ⏱️ Timeframe: {plan.timeframe}
                  </span>
                  <span className="text-slate-500">
                    📊 {plan.evaluation_criteria}
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-6">
            <Target className="w-12 h-12 mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500 mb-3">
              Generate evidence-based care plans from your assessment
            </p>
            <Button size="sm" onClick={generateCarePlans}>
              Generate Care Plans
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}