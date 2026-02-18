import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CheckCircle2, Pencil, X, Trash2, ChevronDown, ChevronUp, Plus, BookOpen
} from "lucide-react";

const PRIORITY_STYLES = {
  high: "border-l-red-500 bg-red-50/30",
  medium: "border-l-amber-500 bg-amber-50/20",
  low: "border-l-blue-500 bg-blue-50/20",
};

export default function CarePlanSuggestionCard({
  plan, index, selected, editing, editDraft,
  onToggle, onEdit, onSaveEdit, onCancelEdit, onUpdateDraft, onRemove,
}) {
  const [detailOpen, setDetailOpen] = useState(false);

  if (editing && editDraft) {
    return (
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-blue-700">Editing Suggestion #{index + 1}</p>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onCancelEdit}>Cancel</Button>
              <Button size="sm" className="h-6 text-[10px] bg-blue-600 hover:bg-blue-700" onClick={onSaveEdit}>Save</Button>
            </div>
          </div>

          <div>
            <Label className="text-[10px]">Problem</Label>
            <Textarea
              value={editDraft.problem}
              onChange={e => onUpdateDraft({ ...editDraft, problem: e.target.value })}
              className="text-xs h-16"
            />
          </div>

          <div>
            <Label className="text-[10px]">Goal (SMART)</Label>
            <Textarea
              value={editDraft.goal}
              onChange={e => onUpdateDraft({ ...editDraft, goal: e.target.value })}
              className="text-xs h-16"
            />
          </div>

          <div>
            <Label className="text-[10px]">Interventions (one per line)</Label>
            <Textarea
              value={(editDraft.interventions || []).join("\n")}
              onChange={e => onUpdateDraft({ ...editDraft, interventions: e.target.value.split("\n").filter(Boolean) })}
              className="text-xs h-24"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Baseline Measurement</Label>
              <Input
                value={editDraft.baseline_measurement || ""}
                onChange={e => onUpdateDraft({ ...editDraft, baseline_measurement: e.target.value })}
                className="text-xs h-8"
              />
            </div>
            <div>
              <Label className="text-[10px]">Target Measurement</Label>
              <Input
                value={editDraft.target_measurement || ""}
                onChange={e => onUpdateDraft({ ...editDraft, target_measurement: e.target.value })}
                className="text-xs h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Frequency</Label>
              <Input
                value={editDraft.frequency || ""}
                onChange={e => onUpdateDraft({ ...editDraft, frequency: e.target.value })}
                className="text-xs h-8"
              />
            </div>
            <div>
              <Label className="text-[10px]">Target Days</Label>
              <Input
                type="number"
                value={editDraft.estimated_days || 60}
                onChange={e => onUpdateDraft({ ...editDraft, estimated_days: parseInt(e.target.value) || 60 })}
                className="text-xs h-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`border-l-4 ${PRIORITY_STYLES[plan.priority] || PRIORITY_STYLES.medium}`}>
      <CardContent className="p-3">
        {/* Header */}
        <div className="flex items-start gap-2">
          <Checkbox checked={selected} onCheckedChange={onToggle} className="mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <Badge className={`text-[9px] px-1.5 py-0 ${
                plan.priority === "high" ? "bg-red-100 text-red-700" :
                plan.priority === "medium" ? "bg-amber-100 text-amber-700" :
                "bg-blue-100 text-blue-700"
              }`}>
                {plan.priority}
              </Badge>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">{plan.estimated_days || 60}d</Badge>
            </div>
            <h4 className="font-semibold text-xs text-slate-900 leading-snug">{plan.problem}</h4>
            <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">{plan.goal}</p>
          </div>
          <div className="flex gap-0.5 flex-shrink-0">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}>
              <Pencil className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={onRemove}>
              <Trash2 className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDetailOpen(!detailOpen)}>
              {detailOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
          </div>
        </div>

        {/* Expanded details */}
        {detailOpen && (
          <div className="mt-2 pt-2 border-t space-y-2">
            {/* Interventions */}
            <div>
              <p className="text-[10px] font-semibold text-slate-700 mb-1">Interventions:</p>
              <ul className="space-y-0.5">
                {plan.interventions?.map((intv, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                    <CheckCircle2 className="w-3 h-3 text-blue-500 mt-0.5 shrink-0" />
                    <span>{intv}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Measurements */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded bg-gradient-to-br from-blue-100/30 to-slate-100/40 border border-blue-200/20">
                <p className="text-[9px] font-semibold text-slate-500">Baseline</p>
                <p className="text-[11px] text-slate-700">{plan.baseline_measurement}</p>
              </div>
              <div className="p-2 rounded bg-gradient-to-br from-blue-100/30 to-slate-100/40 border border-blue-200/20">
                <p className="text-[9px] font-semibold text-slate-500">Target</p>
                <p className="text-[11px] text-slate-700">{plan.target_measurement}</p>
              </div>
            </div>

            <div className="text-[11px] text-slate-600">
              <strong>Frequency:</strong> {plan.frequency}
            </div>

            {/* Rationale */}
            {plan.rationale && (
              <div className="p-2 rounded bg-gradient-to-br from-blue-100/30 to-slate-100/40 border border-blue-200/20">
                <p className="text-[9px] font-semibold text-slate-600 mb-0.5 flex items-center gap-1">
                  <BookOpen className="w-2.5 h-2.5" /> Rationale
                </p>
                <p className="text-[10px] text-slate-600">{plan.rationale}</p>
              </div>
            )}

            {plan.evidence_basis && (
              <div className="p-2 rounded bg-gradient-to-br from-blue-100/30 to-slate-100/40 border border-blue-200/20">
                <p className="text-[9px] font-semibold text-slate-600 mb-0.5">Evidence Basis</p>
                <p className="text-[10px] text-slate-600">{plan.evidence_basis}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}