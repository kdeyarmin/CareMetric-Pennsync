import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { manageOASISRecords } from "@/functions/manageOASISRecords";
import { useAuth } from "@/lib/AuthContext";
import { isOasisPlatformOwnerView } from "@/lib/oasisRoles";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Settings,
  Plus,
  Trash2,
  Edit,
  Zap,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * Read a number input, falling back to the field's default when it is cleared.
 *
 * `parseInt('')` is NaN, and NaN serializes to null — so clearing one of these
 * boxes persisted a rule with no threshold (every comparison against null is
 * false, so the automation silently stopped firing) while the `|| default`
 * display fallback re-rendered the old number and hid it. 0 is preserved as a
 * legitimate value, which a plain `|| default` would have discarded.
 */
const numOrDefault = (raw, fallback) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

// The triggers and actions the OASIS record broker evaluates and runs. A rule
// naming anything else is refused on save, so the form offers only these.
const TRIGGER_OPTIONS = [
  ['compliance_issue', 'Compliance score below threshold'],
  ['accuracy_concern', 'Accuracy score below threshold'],
  ['score_threshold', 'Score threshold'],
  ['missing_documentation', 'Missing documentation'],
  ['specific_m_item', 'Specific M-items flagged'],
  ['clinical_concern', 'Clinical concern'],
];
const ACTION_OPTIONS = [
  ['create_task', 'Create a follow-up task'],
  ['create_alert', 'Create a patient alert'],
  ['notify_clinician', 'Notify the reviewer'],
  ['flag_for_review', 'Flag for the audit queue'],
];
const SCORE_TYPE_OPTIONS = [
  ['overall', 'Overall'],
  ['compliance', 'Compliance'],
  ['accuracy', 'Accuracy'],
];
const listText = (value) => (Array.isArray(value) ? value.join(', ') : '');
const textList = (raw) => String(raw || '').split(',').map((item) => item.trim()).filter(Boolean);

export default function OASISAutomationSettings() {
  const confirm = useConfirm();
  const { user } = useAuth();
  // Rules apply to every agency's analyses, so only the platform owner (the
  // built-in admin role, which a profile edit cannot grant) changes them; the
  // broker enforces the same rule. Everyone else sees what is configured.
  const canEdit = isOasisPlatformOwnerView(user);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    rule_name: '',
    description: '',
    trigger_type: 'compliance_issue',
    trigger_conditions: {
      score_operator: 'less_than',
      score_type: 'overall',
      score_value: 70
    },
    action_type: 'create_task',
    action_config: {
      task_priority: 'high',
      due_in_days: 7,
      task_type: 'followup'
    },
    is_active: true,
    priority: 0
  });

  // Fetch automation rules (the same list the workflow engine evaluates).
  const { data: rules = [] } = useQuery({
    queryKey: ['oasisAutomationRules'],
    queryFn: async () => (await manageOASISRecords('list_rules'))?.rules || [],
  });

  // Create/update rule
  const saveMutation = useMutation({
    mutationFn: (data) => manageOASISRecords('save_rule', {
      ...(editingRule ? { rule_id: editingRule.id } : {}),
      rule: data,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisAutomationRules'] });
      resetForm();
      setIsDialogOpen(false);
    },
    onError: (error) => {
      toast.error(error?.message || "Couldn't save the rule. Please try again.");
    },
  });

  // Delete rule
  const deleteMutation = useMutation({
    mutationFn: (id) => manageOASISRecords('delete_rule', { rule_id: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisAutomationRules'] });
    },
    onError: (error) => {
      toast.error(error?.message || "Couldn't delete the rule. Please try again.");
    },
  });

  // Toggle active status
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => manageOASISRecords('save_rule', { rule_id: id, rule: { is_active } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisAutomationRules'] });
    },
    onError: (error) => {
      toast.error(error?.message || "Couldn't update the rule. Please try again.");
    },
  });

  const resetForm = () => {
    setFormData({
      rule_name: '',
      description: '',
      trigger_type: 'compliance_issue',
      trigger_conditions: {
        score_operator: 'less_than',
        score_type: 'overall',
        score_value: 70
      },
      action_type: 'create_task',
      action_config: {
        task_priority: 'high',
        due_in_days: 7,
        task_type: 'followup'
      },
      is_active: true,
      priority: 0
    });
    setEditingRule(null);
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData({
      ...rule,
      description: rule.description || '',
      trigger_conditions: rule.trigger_conditions || {},
      action_config: rule.action_config || {},
    });
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const getTriggerBadge = (type) => {
    const colors = {
      compliance_issue: "bg-red-100 text-red-800",
      accuracy_concern: "bg-yellow-100 text-yellow-800",
      score_threshold: "bg-blue-100 text-blue-800",
      clinical_concern: "bg-navy-100 text-navy-800"
    };
    return colors[type] || "bg-slate-100 text-slate-800";
  };

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            Automation Rules Configuration
          </CardTitle>
          {canEdit && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={resetForm} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                New Rule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingRule ? 'Edit Automation Rule' : 'Create Automation Rule'}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label>Rule Name</Label>
                  <Input
                    value={formData.rule_name}
                    onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
                    placeholder="e.g., High Compliance Issues - Create Review Task"
                  />
                </div>

                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="What does this rule do?"
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Trigger Type</Label>
                    <Select
                      value={formData.trigger_type}
                      onValueChange={(value) => setFormData({ ...formData, trigger_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRIGGER_OPTIONS.map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Action Type</Label>
                    <Select
                      value={formData.action_type}
                      onValueChange={(value) => setFormData({ ...formData, action_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTION_OPTIONS.map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="border rounded-lg p-4 bg-slate-50">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Trigger Conditions
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {formData.trigger_type === 'score_threshold' && (
                      <div className="col-span-2">
                        <Label>Score Type</Label>
                        <Select
                          value={formData.trigger_conditions?.score_type || 'overall'}
                          onValueChange={(value) => setFormData({
                            ...formData,
                            trigger_conditions: { ...formData.trigger_conditions, score_type: value }
                          })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SCORE_TYPE_OPTIONS.map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {formData.trigger_type === 'specific_m_item' && (
                      <div className="col-span-2">
                        <Label>M-items (comma separated)</Label>
                        <Input
                          value={listText(formData.trigger_conditions?.m_item_codes)}
                          onChange={(e) => setFormData({
                            ...formData,
                            trigger_conditions: { ...formData.trigger_conditions, m_item_codes: textList(e.target.value) }
                          })}
                          placeholder="e.g., M1830, M1860"
                        />
                      </div>
                    )}
                    {formData.trigger_type === 'clinical_concern' && (
                      <div className="col-span-2">
                        <Label>Keywords (comma separated, optional)</Label>
                        <Input
                          value={listText(formData.trigger_conditions?.keywords)}
                          onChange={(e) => setFormData({
                            ...formData,
                            trigger_conditions: { ...formData.trigger_conditions, keywords: textList(e.target.value) }
                          })}
                          placeholder="e.g., fall, wound, dyspnea"
                        />
                      </div>
                    )}
                    <div>
                      <Label>Score Operator</Label>
                      <Select
                        value={formData.trigger_conditions?.score_operator || 'less_than'}
                        onValueChange={(value) => setFormData({
                          ...formData,
                          trigger_conditions: { ...formData.trigger_conditions, score_operator: value }
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="less_than">Less Than</SelectItem>
                          <SelectItem value="greater_than">Greater Than</SelectItem>
                          <SelectItem value="equals">Equals</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Score Value (%)</Label>
                      {/* `??`, not `||`: numOrDefault deliberately keeps a typed
                          0, but a `|| 70` display fallback re-rendered the box
                          as 70, so the admin could never enter or see a 0
                          threshold. */}
                      <Input
                        type="number"
                        value={formData.trigger_conditions?.score_value ?? 70}
                        onChange={(e) => setFormData({
                          ...formData,
                          trigger_conditions: {
                            ...formData.trigger_conditions,
                            score_value: numOrDefault(e.target.value, 70)
                          }
                        })}
                      />
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg p-4 bg-slate-50">
                  <h4 className="font-semibold mb-3">Action Configuration</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Task Priority</Label>
                      <Select
                        value={formData.action_config?.task_priority || 'high'}
                        onValueChange={(value) => setFormData({
                          ...formData,
                          action_config: { ...formData.action_config, task_priority: value }
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Due in (Days)</Label>
                      {/* `??` for the same reason as Score Value above: "due in
                          0 days" (due today) is what a critical-compliance rule
                          wants, and `|| 7` snapped the field back to a week. */}
                      <Input
                        type="number"
                        value={formData.action_config?.due_in_days ?? 7}
                        onChange={(e) => setFormData({
                          ...formData,
                          action_config: {
                            ...formData.action_config,
                            due_in_days: numOrDefault(e.target.value, 7)
                          }
                        })}
                      />
                    </div>
                  </div>
                </div>

                {formData.action_type === 'notify_clinician' && (
                  <div>
                    <Label>Notification Message</Label>
                    <Textarea
                      value={formData.action_config?.notification_message || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        action_config: { ...formData.action_config, notification_message: e.target.value }
                      })}
                      placeholder="What should the reviewer be told?"
                      rows={2}
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label>Active</Label>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? 'Saving...' : 'Save Rule'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {rules.length === 0 ? (
          <Alert>
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              {canEdit
                ? 'No automation rules configured. Create your first rule to enable AI-driven follow-up actions.'
                : 'No automation rules are configured yet. The platform owner sets them up.'}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={`border rounded-lg p-4 ${
                  rule.is_active ? 'bg-white border-blue-200' : 'bg-slate-50 border-slate-300 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-semibold text-slate-900">{rule.rule_name}</h4>
                      <Badge className={getTriggerBadge(rule.trigger_type)}>
                        {String(rule.trigger_type || '').replace(/_/g, ' ')}
                      </Badge>
                      {rule.is_active && (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Active
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 mb-2">{rule.description}</p>
                    <div className="flex gap-4 text-xs text-slate-500">
                      <span>Action: {String(rule.action_type || '').replace(/_/g, ' ')}</span>
                      <span>Priority: {rule.action_config?.task_priority || 'medium'}</span>
                      <span>Due: {rule.action_config?.due_in_days ?? 7} days</span>
                    </div>
                  </div>
                  {canEdit && (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={rule.is_active}
                      onCheckedChange={(checked) =>
                        toggleActiveMutation.mutate({ id: rule.id, is_active: checked })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(rule)}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        // Destructive and unrecoverable — confirm first, matching
                        // every other delete in the app.
                        if (await confirm({
                          title: "Delete automation rule?",
                          description: `Delete "${rule.rule_name || "this rule"}"? This can't be undone.`,
                          confirmText: "Delete",
                          destructive: true,
                        })) {
                          deleteMutation.mutate(rule.id);
                        }
                      }}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}