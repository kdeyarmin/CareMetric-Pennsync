import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Sparkles, 
  CheckCircle, 
  Target,
  Activity,
  Calendar,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function AutomatedCarePlanGenerator({ patientId, trigger }) {
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [selectedGoals, setSelectedGoals] = useState([]);
  const [selectedInterventions, setSelectedInterventions] = useState([]);
  const queryClient = useQueryClient();

  const generatePlanMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('generateAICarePlan', {
        patient_id: patientId,
        trigger_type: trigger
      });
      return response.data;
    },
    onSuccess: (data) => {
      setGeneratedPlan(data);
      // Pre-select all goals and interventions
      setSelectedGoals(data.goals?.map((_, idx) => idx) || []);
      setSelectedInterventions(data.interventions?.map((_, idx) => idx) || []);
      toast.success('Care plan generated successfully');
    },
    onError: (error) => {
      toast.error('Failed to generate care plan: ' + error.message);
    }
  });

  const createCarePlanMutation = useMutation({
    mutationFn: async () => {
      const selectedGoalData = generatedPlan.goals.filter((_, idx) => 
        selectedGoals.includes(idx)
      );
      const selectedInterventionData = generatedPlan.interventions.filter((_, idx) => 
        selectedInterventions.includes(idx)
      );

      const carePlan = await base44.entities.CarePlan.create({
        patient_id: patientId,
        start_date: new Date().toISOString().split('T')[0],
        status: 'active',
        goals: selectedGoalData,
        interventions: selectedInterventionData,
        review_frequency: generatedPlan.review_frequency || 'weekly',
        notes: generatedPlan.rationale
      });

      // Create automated tasks from interventions
      for (const intervention of selectedInterventionData) {
        if (intervention.frequency) {
          await base44.entities.Task.create({
            patient_id: patientId,
            title: intervention.intervention,
            description: intervention.rationale || '',
            task_type: 'intervention',
            status: 'pending',
            due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            recurring: true,
            recurrence_pattern: intervention.frequency
          });
        }
      }

      return carePlan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['patient-careplans']);
      queryClient.invalidateQueries(['tasks']);
      setGeneratedPlan(null);
      toast.success('Care plan created with automated tasks');
    },
    onError: (error) => {
      toast.error('Failed to create care plan: ' + error.message);
    }
  });

  if (!generatedPlan) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Sparkles className="h-12 w-12 text-blue-600 mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-2">AI Care Plan Generator</h3>
          <p className="text-sm text-slate-600 mb-4">
            Generate a comprehensive care plan based on patient data and clinical pathways
          </p>
          <Button
            onClick={() => generatePlanMutation.mutate()}
            disabled={generatePlanMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {generatePlanMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Care Plan
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-600" />
          Generated Care Plan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Goals */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Target className="h-5 w-5 text-green-600" />
              Care Plan Goals ({selectedGoals.length} selected)
            </h3>
          </div>
          <div className="space-y-3">
            {generatedPlan.goals?.map((goal, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <Checkbox
                  checked={selectedGoals.includes(idx)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedGoals([...selectedGoals, idx]);
                    } else {
                      setSelectedGoals(selectedGoals.filter(i => i !== idx));
                    }
                  }}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="font-medium text-sm">{goal.goal}</p>
                  <p className="text-xs text-slate-600 mt-1">{goal.rationale}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">
                      <Calendar className="h-3 w-3 mr-1" />
                      {goal.timeframe}
                    </Badge>
                    {goal.measurable_criteria && (
                      <Badge variant="outline" className="text-xs">
                        {goal.measurable_criteria}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Interventions */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600" />
              Interventions ({selectedInterventions.length} selected)
            </h3>
          </div>
          <div className="space-y-3">
            {generatedPlan.interventions?.map((intervention, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <Checkbox
                  checked={selectedInterventions.includes(idx)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedInterventions([...selectedInterventions, idx]);
                    } else {
                      setSelectedInterventions(selectedInterventions.filter(i => i !== idx));
                    }
                  }}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="font-medium text-sm">{intervention.intervention}</p>
                  <p className="text-xs text-slate-600 mt-1">{intervention.rationale}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">
                      {intervention.discipline}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {intervention.frequency}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rationale */}
        {generatedPlan.rationale && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm font-medium text-blue-900 mb-2">Clinical Rationale</p>
            <p className="text-sm text-blue-800">{generatedPlan.rationale}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          <Button
            onClick={() => createCarePlanMutation.mutate()}
            disabled={createCarePlanMutation.isPending || (selectedGoals.length === 0 && selectedInterventions.length === 0)}
            className="flex-1 bg-green-600 hover:bg-green-700"
          >
            {createCarePlanMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Create Care Plan & Tasks
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => setGeneratedPlan(null)}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}