import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export default function OASISAutomationSettings() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    rule_name: '',
    description: '',
    trigger_type: 'compliance_issue',
    trigger_conditions: {
      severity_levels: ['critical', 'high'],
      score_operator: 'less_than',
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

  // Fetch automation rules
  const { data: rules = [] } = useQuery({
    queryKey: ['automationRules'],
    queryFn: () => base44.entities.OASISAutomationRule.list('-priority'),
  });

  // Create/update rule
  const saveMutation = useMutation({
    mutationFn: (data) => 
      editingRule 
        ? base44.entities.OASISAutomationRule.update(editingRule.id, data)
        : base44.entities.OASISAutomationRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automationRules'] });
      resetForm();
      setIsDialogOpen(false);
    },
    onError: () => {
      toast.error("Couldn't save the rule. Please try again.");
    },
  });

  // Delete rule
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.OASISAutomationRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automationRules'] });
    },
    onError: () => {
      toast.error("Couldn't delete the rule. Please try again.");
    },
  });

  // Toggle active status
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => 
      base44.entities.OASISAutomationRule.update(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automationRules'] });
    },
    onError: () => {
      toast.error("Couldn't update the rule. Please try again.");
    },
  });

  const resetForm = () => {
    setFormData({
      rule_name: '',
      description: '',
      trigger_type: 'compliance_issue',
      trigger_conditions: {
        severity_levels: ['critical', 'high'],
        score_operator: 'less_than',
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
    setFormData(rule);
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const getTriggerBadge = (type) => {
    const colors = {
      compliance_issue: "bg-red-100 text-red-800",
      revenue_opportunity: "bg-green-100 text-green-800",
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
                        <SelectItem value="compliance_issue">Compliance Issue</SelectItem>
                        <SelectItem value="revenue_opportunity">Revenue Opportunity</SelectItem>
                        <SelectItem value="accuracy_concern">Accuracy Concern</SelectItem>
                        <SelectItem value="missing_documentation">Missing Documentation</SelectItem>
                        <SelectItem value="score_threshold">Score Threshold</SelectItem>
                        <SelectItem value="clinical_concern">Clinical Concern</SelectItem>
                        <SelectItem value="pdgm_discrepancy">PDGM Discrepancy</SelectItem>
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
                        <SelectItem value="create_task">Create Task</SelectItem>
                        <SelectItem value="create_alert">Create Alert</SelectItem>
                        <SelectItem value="suggest_documentation">Suggest Documentation</SelectItem>
                        <SelectItem value="schedule_reassessment">Schedule Reassessment</SelectItem>
                        <SelectItem value="flag_for_review">Flag for Review</SelectItem>
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
                      <Input
                        type="number"
                        value={formData.trigger_conditions?.score_value || 70}
                        onChange={(e) => setFormData({
                          ...formData,
                          trigger_conditions: { 
                            ...formData.trigger_conditions, 
                            score_value: parseInt(e.target.value) 
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
                      <Input
                        type="number"
                        value={formData.action_config?.due_in_days || 7}
                        onChange={(e) => setFormData({
                          ...formData,
                          action_config: { 
                            ...formData.action_config, 
                            due_in_days: parseInt(e.target.value) 
                          }
                        })}
                      />
                    </div>
                  </div>
                </div>

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
        </div>
      </CardHeader>

      <CardContent>
        {rules.length === 0 ? (
          <Alert>
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              No automation rules configured. Create your first rule to enable AI-driven follow-up actions.
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
                        {rule.trigger_type.replace(/_/g, ' ')}
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
                      <span>Action: {rule.action_type.replace(/_/g, ' ')}</span>
                      <span>Priority: {rule.action_config?.task_priority || 'medium'}</span>
                      <span>Due: {rule.action_config?.due_in_days || 7} days</span>
                    </div>
                  </div>
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
                      onClick={() => deleteMutation.mutate(rule.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}