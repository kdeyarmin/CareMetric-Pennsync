import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2, Building2, Wand2 } from "lucide-react";
import { toast } from "sonner";

const CONDITION_LABELS = {
  always: "Every patient",
  diagnosis_keyword: "Diagnosis contains…",
  medication_keyword: "Medication contains…",
  has_wound: "Has an active wound",
  care_type: "Care type is…",
};

const BLANK = {
  rule_name: "",
  requirement_label: "",
  description: "",
  condition_type: "always",
  condition_keywords: [],
  condition_care_type: "home_health",
  required_keywords: [],
  applies_to_visit_types: [],
  severity: "high",
  source: "",
  is_active: true,
};

// Common state-survey-driven requirements offered as one-click starting points.
const PRESETS = [
  {
    rule_name: "Oxygen patients require SpO2",
    requirement_label: "Document SpO2 / pulse-oximetry reading this visit",
    condition_type: "medication_keyword",
    condition_keywords: ["oxygen", "o2"],
    required_keywords: ["spo2", "o2 sat", "oxygen saturation", "pulse ox"],
    severity: "high",
    source: "State survey",
  },
  {
    rule_name: "Diabetic patients require blood sugar",
    requirement_label: "Document a blood-sugar / glucose value this visit",
    condition_type: "diagnosis_keyword",
    condition_keywords: ["diabet"],
    required_keywords: ["blood sugar", "glucose", "bg ", "fingerstick", "fsbs"],
    severity: "high",
    source: "State survey",
  },
  {
    rule_name: "Wounds require measurements",
    requirement_label: "Document wound measurements (length × width × depth)",
    condition_type: "has_wound",
    condition_keywords: [],
    required_keywords: ["cm", "mm", "measur", "length", "width"],
    severity: "high",
    source: "State survey",
  },
];

const VISIT_TYPES = ["admission", "routine_visit", "recertification", "discharge", "prn"];
const csv = (arr) => (Array.isArray(arr) ? arr.join(", ") : "");
const fromCsv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

export default function FacilityDocumentationRulesManager() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const { data: rules = [] } = useQuery({
    queryKey: ["facility-doc-rules"],
    queryFn: () => base44.entities.FacilityDocumentationRule.list("-severity", 200),
    initialData: [],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["facility-doc-rules"] });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FacilityDocumentationRule.create(data),
    onSuccess: () => { invalidate(); toast.success("Rule created"); reset(); },
    onError: (e) => toast.error(e?.message || "Could not create rule"),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FacilityDocumentationRule.update(id, data),
    onSuccess: () => { invalidate(); toast.success("Rule updated"); reset(); },
    onError: (e) => toast.error(e?.message || "Could not update rule"),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FacilityDocumentationRule.delete(id),
    onSuccess: () => { invalidate(); toast.success("Rule deleted"); },
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }) => base44.entities.FacilityDocumentationRule.update(id, { is_active }),
    onSuccess: invalidate,
  });

  const reset = () => { setForm(BLANK); setEditing(null); setIsOpen(false); };

  const openNew = (preset) => {
    setEditing(null);
    setForm(preset ? { ...BLANK, ...preset } : BLANK);
    setIsOpen(true);
  };

  const openEdit = (rule) => {
    setEditing(rule);
    setForm({
      rule_name: rule.rule_name || "",
      requirement_label: rule.requirement_label || "",
      description: rule.description || "",
      condition_type: rule.condition_type || "always",
      condition_keywords: rule.condition_keywords || [],
      condition_care_type: rule.condition_care_type || "home_health",
      required_keywords: rule.required_keywords || [],
      applies_to_visit_types: rule.applies_to_visit_types || [],
      severity: rule.severity || "high",
      source: rule.source || "",
      is_active: rule.is_active !== false,
    });
    setIsOpen(true);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.rule_name.trim() || !form.requirement_label.trim()) {
      toast.error("Rule name and requirement are required.");
      return;
    }
    // Stamp created_by only on create; preserve the original creator on edit so
    // the audit field isn't rewritten to whoever last touched the rule.
    const payload = { ...form, created_by: editing ? editing.created_by : currentUser?.email };
    if (editing) updateMutation.mutate({ id: editing.id, data: payload });
    else createMutation.mutate(payload);
  };

  const remove = async (id) => {
    if (await confirm({ title: "Delete rule?", description: "This facility requirement will no longer be enforced.", confirmText: "Delete", destructive: true })) {
      deleteMutation.mutate(id);
    }
  };

  const toggleVisit = (vt) => {
    setForm((f) => ({
      ...f,
      applies_to_visit_types: f.applies_to_visit_types.includes(vt)
        ? f.applies_to_visit_types.filter((x) => x !== vt)
        : [...f.applies_to_visit_types, vt],
    }));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" /> Facility Documentation Rules
          </CardTitle>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Require documentation for patients who match a condition — e.g. <em>on oxygen → SpO2
            in every note</em>, <em>diabetic → blood sugar</em>, <em>any wound → measurements</em>.
            Nurses see the applicable items live while charting.
          </p>
        </div>
        <Button onClick={() => openNew()}>
          <Plus className="w-4 h-4 mr-2" /> New Rule
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-slate-500 self-center">Quick add:</span>
          {PRESETS.map((p) => (
            <Button key={p.rule_name} variant="outline" size="sm" className="h-7 text-xs" onClick={() => openNew(p)}>
              <Wand2 className="w-3 h-3 mr-1" /> {p.rule_name}
            </Button>
          ))}
        </div>

        <div className="space-y-3">
          {rules.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Building2 className="w-12 h-12 mx-auto mb-3 text-slate-400" />
              <p>No facility rules yet. Add one, or start from a quick-add preset above.</p>
            </div>
          ) : (
            rules.map((rule) => (
              <Card key={rule.id} className={`border-l-4 ${rule.is_active === false ? "border-l-slate-300 opacity-70" : "border-l-navy-500"}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-slate-800">{rule.rule_name}</span>
                        <Badge variant="outline">{rule.severity}</Badge>
                        <Badge className="bg-slate-100 text-slate-700">
                          {CONDITION_LABELS[rule.condition_type] || rule.condition_type}
                          {rule.condition_type === "diagnosis_keyword" || rule.condition_type === "medication_keyword"
                            ? ` ${csv(rule.condition_keywords)}`
                            : rule.condition_type === "care_type"
                              ? ` ${rule.condition_care_type}`
                              : ""}
                        </Badge>
                        {rule.source && <span className="text-[11px] text-slate-400">{rule.source}</span>}
                      </div>
                      <p className="text-sm text-slate-600">{rule.requirement_label}</p>
                      {rule.required_keywords?.length > 0 && (
                        <p className="text-[11px] text-slate-400 mt-1">
                          Detected by: {csv(rule.required_keywords)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Switch
                        checked={rule.is_active !== false}
                        onCheckedChange={(v) => toggleMutation.mutate({ id: rule.id, is_active: v })}
                        aria-label="Active"
                      />
                      <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(rule.id)}>
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </CardContent>

      <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) reset(); }}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Rule" : "New Facility Rule"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label className="text-sm">Rule name</Label>
              <Input value={form.rule_name} onChange={(e) => setForm({ ...form, rule_name: e.target.value })} placeholder="Oxygen patients require SpO2" required />
            </div>
            <div>
              <Label className="text-sm">Requirement shown to the nurse</Label>
              <Input value={form.requirement_label} onChange={(e) => setForm({ ...form, requirement_label: e.target.value })} placeholder="Document SpO2 / pulse-oximetry reading this visit" required />
            </div>
            <div>
              <Label className="text-sm">Description <span className="text-slate-400">optional</span></Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Rationale / survey citation" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Applies to</Label>
                <Select value={form.condition_type} onValueChange={(v) => setForm({ ...form, condition_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONDITION_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["critical", "high", "medium", "low"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(form.condition_type === "diagnosis_keyword" || form.condition_type === "medication_keyword") && (
              <div>
                <Label className="text-sm">Condition keywords <span className="text-slate-400">comma-separated</span></Label>
                <Input
                  value={csv(form.condition_keywords)}
                  onChange={(e) => setForm({ ...form, condition_keywords: fromCsv(e.target.value) })}
                  placeholder={form.condition_type === "diagnosis_keyword" ? "diabet, dm" : "oxygen, o2"}
                />
                <p className="text-xs text-slate-500 mt-1">Rule applies if the patient's {form.condition_type === "diagnosis_keyword" ? "diagnoses/conditions" : "medications"} contain any of these.</p>
              </div>
            )}

            {form.condition_type === "care_type" && (
              <div>
                <Label className="text-sm">Care type</Label>
                <Select value={form.condition_care_type} onValueChange={(v) => setForm({ ...form, condition_care_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home_health">Home Health</SelectItem>
                    <SelectItem value="hospice">Hospice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-sm">Required in the note <span className="text-slate-400">comma-separated keywords</span></Label>
              <Input
                value={csv(form.required_keywords)}
                onChange={(e) => setForm({ ...form, required_keywords: fromCsv(e.target.value) })}
                placeholder="spo2, o2 sat, oxygen saturation, pulse ox"
              />
              <p className="text-xs text-slate-500 mt-1">
                The requirement is satisfied when the note contains any of these. Leave blank to make it an advisory reminder the nurse confirms manually.
              </p>
            </div>

            <div>
              <Label className="text-sm">Visit types <span className="text-slate-400">none selected = all visits</span></Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {VISIT_TYPES.map((vt) => (
                  <button
                    type="button"
                    key={vt}
                    onClick={() => toggleVisit(vt)}
                    className={`text-xs px-2 py-1 rounded border ${form.applies_to_visit_types.includes(vt) ? "bg-navy-600 text-white border-navy-600" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                  >
                    {vt}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Source <span className="text-slate-400">optional</span></Label>
                <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="PA State Survey 2025" />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} id="rule-active" />
                <Label htmlFor="rule-active">Active</Label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={reset}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editing ? "Update" : "Create"} Rule
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
