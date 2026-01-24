import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Shield, AlertTriangle, CheckCircle } from "lucide-react";

export default function AgencyComplianceEngine() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState({
    rule_name: "",
    description: "",
    category: "",
    severity: "medium",
    required_elements: "",
    validation_logic: "",
    auto_fix_available: false,
    fix_template: "",
    applies_to_provider_types: ""
  });

  const { data: rules = [] } = useQuery({
    queryKey: ['agencyComplianceRules'],
    queryFn: () => base44.entities.AgencyComplianceRule.list()
  });

  const createRuleMutation = useMutation({
    mutationFn: (data) => base44.entities.AgencyComplianceRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencyComplianceRules'] });
      toast.success('Compliance rule created');
      resetForm();
    }
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AgencyComplianceRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencyComplianceRules'] });
      toast.success('Rule updated');
      resetForm();
    }
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id) => base44.entities.AgencyComplianceRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencyComplianceRules'] });
      toast.success('Rule deleted');
    }
  });

  const toggleRuleMutation = useMutation({
    mutationFn: ({ id, isActive }) => base44.entities.AgencyComplianceRule.update(id, { is_active: !isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencyComplianceRules'] });
    }
  });

  const resetForm = () => {
    setFormData({
      rule_name: "",
      description: "",
      category: "",
      severity: "medium",
      required_elements: "",
      validation_logic: "",
      auto_fix_available: false,
      fix_template: "",
      applies_to_provider_types: ""
    });
    setEditingRule(null);
    setShowForm(false);
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData({
      rule_name: rule.rule_name,
      description: rule.description,
      category: rule.category,
      severity: rule.severity,
      required_elements: rule.required_elements?.join(', ') || "",
      validation_logic: rule.validation_logic || "",
      auto_fix_available: rule.auto_fix_available || false,
      fix_template: rule.fix_template || "",
      applies_to_provider_types: rule.applies_to_provider_types?.join(', ') || ""
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    const data = {
      ...formData,
      required_elements: formData.required_elements.split(',').map(s => s.trim()).filter(Boolean),
      applies_to_provider_types: formData.applies_to_provider_types.split(',').map(s => s.trim()).filter(Boolean)
    };

    if (editingRule) {
      updateRuleMutation.mutate({ id: editingRule.id, data });
    } else {
      createRuleMutation.mutate(data);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'medium': return 'bg-yellow-600 text-white';
      case 'low': return 'bg-blue-600 text-white';
      default: return 'bg-slate-600 text-white';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" />
            Agency Compliance Rules
          </h2>
          <p className="text-slate-600">Custom compliance rules specific to your agency</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          New Rule
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingRule ? 'Edit Rule' : 'Create Compliance Rule'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Rule Name</Label>
              <Input
                value={formData.rule_name}
                onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
                placeholder="e.g., Homebound Status Documentation"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="documentation">Documentation</SelectItem>
                    <SelectItem value="safety">Safety</SelectItem>
                    <SelectItem value="quality">Quality</SelectItem>
                    <SelectItem value="billing">Billing</SelectItem>
                    <SelectItem value="training">Training</SelectItem>
                    <SelectItem value="oasis">OASIS</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Severity</Label>
                <Select value={formData.severity} onValueChange={(v) => setFormData({ ...formData, severity: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Detailed description of what this rule checks"
                rows={3}
              />
            </div>

            <div>
              <Label>Required Elements (comma-separated)</Label>
              <Input
                value={formData.required_elements}
                onChange={(e) => setFormData({ ...formData, required_elements: e.target.value })}
                placeholder="e.g., Homebound justification, Two qualifying factors"
              />
            </div>

            <div>
              <Label>Validation Logic (AI Instructions)</Label>
              <Textarea
                value={formData.validation_logic}
                onChange={(e) => setFormData({ ...formData, validation_logic: e.target.value })}
                placeholder="Instructions for AI to validate this rule..."
                rows={4}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={formData.auto_fix_available}
                onCheckedChange={(v) => setFormData({ ...formData, auto_fix_available: v })}
              />
              <Label>Enable One-Click Auto-Fix</Label>
            </div>

            {formData.auto_fix_available && (
              <div>
                <Label>Fix Template</Label>
                <Textarea
                  value={formData.fix_template}
                  onChange={(e) => setFormData({ ...formData, fix_template: e.target.value })}
                  placeholder="Template text for auto-fixing violations..."
                  rows={3}
                />
              </div>
            )}

            <div>
              <Label>Applies to Provider Types (comma-separated)</Label>
              <Input
                value={formData.applies_to_provider_types}
                onChange={(e) => setFormData({ ...formData, applies_to_provider_types: e.target.value })}
                placeholder="e.g., RN, LPN, PT, OT (leave blank for all)"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!formData.rule_name || !formData.description}>
                {editingRule ? 'Update' : 'Create'} Rule
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rules List */}
      <div className="grid grid-cols-1 gap-4">
        {rules.map((rule) => (
          <Card key={rule.id} className={!rule.is_active ? 'opacity-50' : ''}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold">{rule.rule_name}</span>
                    <Badge className={getSeverityColor(rule.severity)}>{rule.severity}</Badge>
                    <Badge variant="outline">{rule.category}</Badge>
                    {rule.auto_fix_available && (
                      <Badge className="bg-green-600">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Auto-Fix
                      </Badge>
                    )}
                    {!rule.is_active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <p className="text-sm text-slate-700 mb-2">{rule.description}</p>
                  {rule.required_elements && rule.required_elements.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {rule.required_elements.map((elem, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">{elem}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => toggleRuleMutation.mutate({ id: rule.id, isActive: rule.is_active })}
                  >
                    {rule.is_active ? <CheckCircle className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-slate-400" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleEdit(rule)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    onClick={() => {
                      if (confirm('Delete this rule?')) {
                        deleteRuleMutation.mutate(rule.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {rules.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No Custom Rules Yet</h3>
            <p className="text-slate-600 mb-4">Create agency-specific compliance rules to enforce your standards</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create First Rule
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}