import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Target, Plus, CheckCircle2, AlertCircle } from "lucide-react";

export default function CarePlanSuggestions({ suggestions, patientId, onApply }) {
  const [selected, setSelected] = useState({});
  const [applying, setApplying] = useState(false);

  if (!suggestions || suggestions.length === 0) return null;

  const handleApply = async () => {
    if (!patientId) {
      toast.error('Please select a patient first');
      return;
    }

    const selectedSuggestions = suggestions.filter((_, idx) => selected[idx]);
    if (selectedSuggestions.length === 0) {
      toast.error('Please select at least one suggestion');
      return;
    }

    setApplying(true);
    try {
      for (const suggestion of selectedSuggestions) {
        await base44.entities.CarePlan.create({
          patient_id: patientId,
          problem: suggestion.problem,
          goal: suggestion.goal,
          interventions: suggestion.interventions,
          frequency: suggestion.frequency || 'weekly',
          baseline_measurement: suggestion.baseline_measurement,
          status: 'active'
        });
      }

      toast.success(`${selectedSuggestions.length} care plan(s) created successfully`);
      onApply?.();
    } catch (error) {
      toast.error('Failed to create care plans: ' + error.message);
    } finally {
      setApplying(false);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'low': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      default: return 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200';
    }
  };

  return (
    <Card className="border-2 border-purple-200 dark:border-purple-800">
      <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950">
        <CardTitle className="flex items-center gap-2">
          <Target className="w-5 h-5 text-purple-600" />
          Care Plan Suggestions
        </CardTitle>
        <CardDescription>
          AI-recommended care plan updates based on document analysis
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {suggestions.map((suggestion, idx) => (
          <div 
            key={idx}
            className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
          >
            <Checkbox
              checked={selected[idx] || false}
              onCheckedChange={(checked) => setSelected({ ...selected, [idx]: checked })}
            />
            <div className="flex-1 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {suggestion.problem}
                    </span>
                    <Badge className={getPriorityColor(suggestion.priority)}>
                      {suggestion.priority} priority
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    <strong>Goal:</strong> {suggestion.goal}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Interventions:
                </p>
                <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-400 space-y-1">
                  {suggestion.interventions.map((intervention, i) => (
                    <li key={i}>{intervention}</li>
                  ))}
                </ul>
              </div>

              {suggestion.rationale && (
                <div className="text-xs text-slate-500 dark:text-slate-400 italic border-l-2 border-purple-300 pl-3">
                  Rationale: {suggestion.rationale}
                </div>
              )}

              {suggestion.baseline_measurement && (
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  <strong>Baseline:</strong> {suggestion.baseline_measurement}
                </div>
              )}
            </div>
          </div>
        ))}

        <Button 
          onClick={handleApply} 
          disabled={applying || !patientId || Object.values(selected).filter(Boolean).length === 0}
          className="w-full bg-purple-600 hover:bg-purple-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          {applying ? 'Creating Care Plans...' : `Create ${Object.values(selected).filter(Boolean).length} Care Plan(s)`}
        </Button>
      </CardContent>
    </Card>
  );
}