import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sparkles,
  Target,
  CheckCircle2,
  Edit2,
  X,
  AlertCircle,
  Save,
  Loader2
} from "lucide-react";
import { toast } from 'sonner';

export default function AIReferralCarePlanGenerator({ 
  referralData, 
  intakeAnalysis, 
  patientId,
  existingCarePlans = [],
  onCarePlansSaved 
}) {
  const [generating, setGenerating] = useState(false);
  const [generatedPlans, setGeneratedPlans] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editedPlan, setEditedPlan] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const response = await base44.functions.invoke('generateCarePlanFromReferral', {
        referralData,
        intakeAnalysis,
        existingCarePlans
      });

      const plans = response.data?.care_plans || [];
      setGeneratedPlans(plans);
    } catch (error) {
      console.error('Failed to generate care plans:', error);
      toast.error('Failed to generate care plans. Please try again.');
    }
    setGenerating(false);
  };

  const handleEdit = (index) => {
    setEditingIndex(index);
    setEditedPlan({ ...generatedPlans[index] });
  };

  const handleSaveEdit = () => {
    const updated = [...generatedPlans];
    updated[editingIndex] = editedPlan;
    setGeneratedPlans(updated);
    setEditingIndex(null);
    setEditedPlan(null);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditedPlan(null);
  };

  const handleRemove = (index) => {
    setGeneratedPlans(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveAll = async () => {
    if (!patientId) {
      toast.error('No patient selected. Please ensure patient is assigned to this referral.');
      return;
    }

    setSaving(true);
    try {
      const _today = new Date().toISOString().split('T')[0];
      
      // Independent inserts — create concurrently so the save isn't N serial
      // round-trips while the user waits.
      await Promise.all(generatedPlans.map((plan) => {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + (plan.target_days || 60));

        return base44.entities.CarePlan.create({
          patient_id: patientId,
          problem: plan.problem,
          goal: plan.goal,
          interventions: plan.interventions,
          frequency: plan.frequency,
          baseline_measurement: plan.baseline_measurement,
          target_date: targetDate.toISOString().split('T')[0],
          status: 'active'
        });
      }));

      toast.success(`Successfully created ${generatedPlans.length} care plans!`);
      setGeneratedPlans([]);
      onCarePlansSaved?.();
    } catch (error) {
      console.error('Failed to save care plans:', error);
      toast.error('Failed to save care plans. Please try again.');
    }
    setSaving(false);
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-700 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-700 border-blue-300';
      default: return 'bg-slate-100 text-slate-700 border-slate-300';
    }
  };

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-gold-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="w-5 h-5 text-navy-600" />
          AI Care Plan Generator
          <Badge className="bg-navy-600 text-white">Powered by AI</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {generatedPlans.length === 0 ? (
          <div className="text-center py-8">
            <Target className="w-12 h-12 text-navy-400 mx-auto mb-4" />
            <p className="text-slate-600 mb-4">
              Generate AI-powered care plans based on the referral analysis and patient data
            </p>
            <Button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Care Plans...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Care Plans
                </>
              )}
            </Button>
          </div>
        ) : (
          <>
            <Alert className="bg-navy-50 border-navy-300">
              <AlertCircle className="w-4 h-4 text-navy-600" />
              <AlertDescription className="text-navy-900 text-sm">
                Review and edit the AI-generated care plans below. You can modify any field before saving.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              {generatedPlans.map((plan, index) => (
                <Card key={index} className="border-2 hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={getPriorityColor(plan.priority)}>
                            {plan.priority} priority
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {plan.target_days} days
                          </Badge>
                        </div>
                        {editingIndex === index ? (
                          <Input
                            value={editedPlan.problem}
                            onChange={(e) => setEditedPlan({ ...editedPlan, problem: e.target.value })}
                            className="font-semibold"
                          />
                        ) : (
                          <h4 className="font-semibold text-slate-900">{plan.problem}</h4>
                        )}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {editingIndex === index ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={handleSaveEdit}>
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                              <X className="w-4 h-4 text-slate-600" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => handleEdit(index)}>
                              <Edit2 className="w-4 h-4 text-blue-600" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleRemove(index)}>
                              <X className="w-4 h-4 text-red-600" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label className="text-xs font-semibold text-slate-600">Goal</Label>
                      {editingIndex === index ? (
                        <Textarea
                          value={editedPlan.goal}
                          onChange={(e) => setEditedPlan({ ...editedPlan, goal: e.target.value })}
                          className="mt-1"
                          rows={2}
                        />
                      ) : (
                        <p className="text-sm text-slate-700 mt-1">{plan.goal}</p>
                      )}
                    </div>

                    <div>
                      <Label className="text-xs font-semibold text-slate-600">Interventions</Label>
                      {editingIndex === index ? (
                        <div className="space-y-2 mt-1">
                          {editedPlan.interventions?.map((intervention, i) => (
                            <Input
                              key={i}
                              value={intervention}
                              onChange={(e) => {
                                const newInterventions = [...editedPlan.interventions];
                                newInterventions[i] = e.target.value;
                                setEditedPlan({ ...editedPlan, interventions: newInterventions });
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <ul className="list-disc list-inside space-y-1 mt-1">
                          {plan.interventions?.map((intervention, i) => (
                            <li key={i} className="text-sm text-slate-700">{intervention}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-semibold text-slate-600">Frequency</Label>
                        {editingIndex === index ? (
                          <Input
                            value={editedPlan.frequency}
                            onChange={(e) => setEditedPlan({ ...editedPlan, frequency: e.target.value })}
                            className="mt-1"
                          />
                        ) : (
                          <p className="text-sm text-slate-700 mt-1">{plan.frequency}</p>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-slate-600">Baseline</Label>
                        {editingIndex === index ? (
                          <Input
                            value={editedPlan.baseline_measurement}
                            onChange={(e) => setEditedPlan({ ...editedPlan, baseline_measurement: e.target.value })}
                            className="mt-1"
                          />
                        ) : (
                          <p className="text-sm text-slate-700 mt-1">{plan.baseline_measurement}</p>
                        )}
                      </div>
                    </div>

                    {plan.rationale && (
                      <div className="bg-blue-50 border border-blue-200 rounded p-2">
                        <Label className="text-xs font-semibold text-blue-700">Rationale</Label>
                        <p className="text-xs text-blue-900 mt-1">{plan.rationale}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={handleSaveAll}
                disabled={saving || !patientId}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save All {generatedPlans.length} Care Plans
                  </>
                )}
              </Button>
              <Button
                onClick={() => setGeneratedPlans([])}
                variant="outline"
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}