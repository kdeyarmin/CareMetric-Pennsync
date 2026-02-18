import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Brain, Loader2, Sparkles, CheckCircle2, Target, TrendingUp,
  AlertCircle, Plus, Pencil, X, ChevronDown, ChevronUp, RefreshCw, Trash2
} from "lucide-react";
import { toast } from "sonner";
import { format, addDays } from "date-fns";

import CarePlanSuggestionCard from "./CarePlanSuggestionCard";

export default function SmartCarePlanGenerator({ patientId, onCarePlansCreated }) {
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [selectedIndices, setSelectedIndices] = useState([]);
  const [editingIdx, setEditingIdx] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const { data: patient } = useQuery({
    queryKey: ["patientForGen", patientId],
    queryFn: async () => {
      const patients = await base44.entities.Patient.list();
      return patients.find(p => p.id === patientId) || null;
    },
    enabled: !!patientId,
  });

  const { data: visits = [] } = useQuery({
    queryKey: ["visitsForGen", patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, "-visit_date", 10),
    enabled: !!patientId,
  });

  const { data: existingPlans = [] } = useQuery({
    queryKey: ["plansForGen", patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId,
  });

  const generateSuggestions = async () => {
    if (!patient) return;
    setGenerating(true);
    setSuggestions(null);
    setSelectedIndices([]);
    setEditingIdx(null);

    const recentNotes = visits
      .filter(v => v.nurse_notes)
      .slice(0, 5)
      .map(v => ({ date: v.visit_date, type: v.visit_type, note: v.nurse_notes?.substring(0, 600) }));

    const existingSummary = existingPlans
      .filter(cp => cp.status === "active")
      .map(cp => cp.problem)
      .join(", ");

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a home health clinical documentation AI. Generate evidence-based care plan suggestions for this patient.

PATIENT:
Name: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || "Not specified"}
Secondary Diagnoses: ${(patient.secondary_diagnoses || []).join(", ") || "None"}
Chronic Conditions: ${(patient.chronic_conditions || []).map(c => c.condition).join(", ") || "None"}
Functional Status: ADL=${patient.functional_status?.adl_independence || "unknown"}, Ambulation=${patient.functional_status?.ambulation || "unknown"}, Fall Risk=${patient.functional_status?.fall_risk || "unknown"}, Cognitive=${patient.functional_status?.cognitive_status || "unknown"}
Medications: ${(patient.current_medications || []).map(m => m.name).join(", ") || "None listed"}
Allergies: ${patient.allergies || "NKDA"}
Living Situation: ${patient.social_history?.living_situation || "unknown"}
Care Type: ${patient.care_type || "home_health"}

RECENT CLINICAL NOTES:
${JSON.stringify(recentNotes, null, 1)}

EXISTING ACTIVE CARE PLANS: ${existingSummary || "None"}

INSTRUCTIONS:
1. Analyze the patient's diagnosis, notes, functional status, and social factors.
2. Identify clinical problems NOT already covered by existing care plans.
3. For each problem, create a SMART goal (Specific, Measurable, Achievable, Relevant, Time-bound).
4. Suggest 3-5 evidence-based nursing interventions per problem.
5. Include baseline and target measurements.
6. Prioritize by clinical urgency.
7. Reference best practices and Medicare home health guidelines where relevant.

Generate 3-6 care plan suggestions.`,
      response_json_schema: {
        type: "object",
        properties: {
          overall_assessment: { type: "string" },
          care_plans: {
            type: "array",
            items: {
              type: "object",
              properties: {
                problem: { type: "string" },
                goal: { type: "string" },
                interventions: { type: "array", items: { type: "string" } },
                baseline_measurement: { type: "string" },
                target_measurement: { type: "string" },
                frequency: { type: "string" },
                priority: { type: "string", enum: ["high", "medium", "low"] },
                estimated_days: { type: "number" },
                rationale: { type: "string" },
                evidence_basis: { type: "string" },
              },
            },
          },
          monitoring_recommendations: { type: "array", items: { type: "string" } },
        },
      },
    });

    setSuggestions(result);
    setSelectedIndices(result.care_plans?.map((_, i) => i) || []);
    setGenerating(false);
    toast.success("AI care plan suggestions generated");
  };

  const toggleSelection = (idx) => {
    setSelectedIndices(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const startEditing = (idx) => {
    setEditingIdx(idx);
    setEditDraft({ ...suggestions.care_plans[idx] });
  };

  const saveEdit = () => {
    if (editingIdx === null || !editDraft) return;
    const updated = { ...suggestions };
    updated.care_plans[editingIdx] = editDraft;
    setSuggestions(updated);
    setEditingIdx(null);
    setEditDraft(null);
    toast.success("Suggestion updated");
  };

  const removeSuggestion = (idx) => {
    const updated = { ...suggestions };
    updated.care_plans = updated.care_plans.filter((_, i) => i !== idx);
    setSuggestions(updated);
    setSelectedIndices(prev => prev.filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
    if (editingIdx === idx) { setEditingIdx(null); setEditDraft(null); }
  };

  const createSelectedPlans = async () => {
    if (!suggestions || selectedIndices.length === 0) return;
    setCreating(true);

    const plans = selectedIndices.map(i => suggestions.care_plans[i]);
    for (const plan of plans) {
      const targetDate = addDays(new Date(), plan.estimated_days || 60);
      await base44.entities.CarePlan.create({
        patient_id: patientId,
        problem: plan.problem,
        goal: plan.goal,
        interventions: plan.interventions,
        baseline_measurement: plan.baseline_measurement,
        current_measurement: plan.baseline_measurement,
        frequency: plan.frequency,
        target_date: format(targetDate, "yyyy-MM-dd"),
        status: "active",
        progress_percentage: 0,
      });
    }

    toast.success(`Created ${plans.length} care plan(s)`);
    queryClient.invalidateQueries({ queryKey: ["allCarePlans"] });
    queryClient.invalidateQueries({ queryKey: ["plansForGen", patientId] });
    setSuggestions(null);
    setSelectedIndices([]);
    setCreating(false);
    if (onCarePlansCreated) onCarePlansCreated();
  };

  // Not generated yet
  if (!suggestions && !generating) {
    return (
      <Card>
        <CardContent className="p-4 sm:p-6 text-center">
          <Brain className="w-8 h-8 text-blue-500 mx-auto mb-2" />
          <h3 className="font-semibold text-slate-800 text-sm mb-1">AI Care Plan Generator</h3>
          <p className="text-xs text-slate-500 mb-4 max-w-md mx-auto">
            Analyze diagnosis, clinical notes, and functional status to suggest evidence-based care plans with SMART goals and interventions.
          </p>
          <Button onClick={generateSuggestions} disabled={!patientId} className="bg-blue-600 hover:bg-blue-700">
            <Brain className="w-4 h-4 mr-2" /> Generate Care Plans
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (generating) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Loader2 className="w-7 h-7 animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-sm text-slate-600">Analyzing patient data and generating suggestions...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="p-3 sm:p-4 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-500" /> AI Care Plan Suggestions
            <Badge variant="outline" className="text-[10px]">{suggestions?.care_plans?.length || 0}</Badge>
          </CardTitle>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={generateSuggestions}>
              <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
          {/* Assessment */}
          {suggestions?.overall_assessment && (
            <div className="p-3 rounded-lg bg-gradient-to-br from-blue-100/40 to-slate-100/60 border border-blue-200/30 text-xs text-slate-700">
              <p className="font-semibold text-slate-800 mb-1 flex items-center gap-1">
                <Target className="w-3 h-3" /> Clinical Assessment
              </p>
              {suggestions.overall_assessment}
            </div>
          )}

          {/* Suggestions list */}
          <div className="space-y-2">
            {suggestions?.care_plans?.map((plan, idx) => (
              <CarePlanSuggestionCard
                key={idx}
                plan={plan}
                index={idx}
                selected={selectedIndices.includes(idx)}
                editing={editingIdx === idx}
                editDraft={editingIdx === idx ? editDraft : null}
                onToggle={() => toggleSelection(idx)}
                onEdit={() => startEditing(idx)}
                onSaveEdit={saveEdit}
                onCancelEdit={() => { setEditingIdx(null); setEditDraft(null); }}
                onUpdateDraft={setEditDraft}
                onRemove={() => removeSuggestion(idx)}
              />
            ))}
          </div>

          {/* Monitoring */}
          {suggestions?.monitoring_recommendations?.length > 0 && (
            <div className="p-3 rounded-lg bg-gradient-to-br from-blue-100/30 to-slate-100/50 border border-blue-200/20 text-xs">
              <p className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Monitoring Recommendations
              </p>
              <ul className="space-y-0.5 text-slate-600">
                {suggestions.monitoring_recommendations.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-xs text-slate-500">{selectedIndices.length} of {suggestions?.care_plans?.length} selected</p>
            <Button
              onClick={createSelectedPlans}
              disabled={creating || selectedIndices.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
              size="sm"
            >
              {creating ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
              Create {selectedIndices.length} Plan(s)
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}