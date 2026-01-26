import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Shield, Plus, Edit2, Trash2, CheckCircle2, AlertTriangle, Filter } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

export default function ComplianceRuleDashboard() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: complianceRules = [] } = useQuery({
    queryKey: ['complianceRules'],
    queryFn: () => base44.entities.ComplianceRule.list('-created_date')
  });

  const { data: medicareRules = [] } = useQuery({
    queryKey: ['medicareRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list()
  });

  const { data: agencyRules = [] } = useQuery({
    queryKey: ['agencyRules'],
    queryFn: () => base44.entities.AgencyComplianceRule.list()
  });

  const [formData, setFormData] = useState({
    rule_name: "",
    description: "",
    category: "documentation",
    severity: "medium",
    required_elements: [],
    validation_logic: "",
    auto_fix_available: false,
    fix_template: "",
    is_active: true
  });

  const saveRuleMutation = useMutation({
    mutationFn: (data) => {
      if (editingRule) {
        return base44.entities.AgencyComplianceRule.update(editingRule.id, data);
      }
      return base44.entities.AgencyComplianceRule.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencyRules'] });
      setDialogOpen(false);
      resetForm();
      toast.success(editingRule ? "Rule updated" : "Rule created");
    }
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id) => base44.entities.AgencyComplianceRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencyRules'] });
      toast.success("Rule deleted");
    }
  });

  const resetForm = () => {
    setFormData({
      rule_name: "",
      description: "",
      category: "documentation",
      severity: "medium",
      required_elements: [],
      validation_logic: "",
      auto_fix_available: false,
      fix_template: "",
      is_active: true
    });
    setEditingRule(null);
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData(rule);
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!formData.rule_name || !formData.description) {
      toast.error("Rule name and description are required");
      return;
    }
    saveRuleMutation.mutate(formData);
  };

  const filteredRules = agencyRules.filter(rule => {
    const matchesCategory = filterCategory === "all" || rule.category === filterCategory;
    const matchesSeverity = filterSeverity === "all" || rule.severity === filterSeverity;
    return matchesCategory && matchesSeverity;
  });

  const allRulesCount = complianceRules.length + medicareRules.length + agencyRules.length;

  const severityColors = {
    critical: 'bg-red-600',
    high: 'bg-orange-600',
    medium: 'bg-yellow-600',
    low: 'bg-blue-600'
  };

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Shield className="w-8 h-8 text-blue-600 mx-auto mb-2" />
            <p className="text-2xl font-bold">{allRulesCount}</p>
            <p className="text-xs text-gray-600">Total Rules Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <p className="text-2xl font-bold">{complianceRules.length}</p>
            <p className="text-xs text-gray-600">System Rules</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Shield className="w-8 h-8 text-purple-600 mx-auto mb-2" />
            <p className="text-2xl font-bold">{medicareRules.length}</p>
            <p className="text-xs text-gray-600">Medicare Rules</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <AlertTriangle className="w-8 h-8 text-orange-600 mx-auto mb-2" />
            <p className="text-2xl font-bold">{agencyRules.length}</p>
            <p className="text-xs text-gray-600">Agency Rules</p>
          </CardContent>
        </Card>
      </div>

      {/* Agency Rules Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Agency Compliance Rules
            </CardTitle>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex gap-4">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="documentation">Documentation</SelectItem>
                <SelectItem value="safety">Safety</SelectItem>
                <SelectItem value="quality">Quality</SelectItem>
                <SelectItem value="billing">Billing</SelectItem>
                <SelectItem value="training">Training</SelectItem>
                <SelectItem value="oasis">OASIS</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Rules List */}
          <div className="space-y-3">
            {filteredRules.map((rule) => (
              <Card key={rule.id} className="border-l-4 border-l-blue-400">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold">{rule.rule_name}</h4>
                        <Badge className={severityColors[rule.severity]}>
                          {rule.severity}
                        </Badge>
                        <Badge variant="outline">{rule.category}</Badge>
                        {rule.auto_fix_available && (
                          <Badge className="bg-green-600">Auto-fix</Badge>
                        )}
                        {!rule.is_active && (
                          <Badge variant="outline" className="bg-gray-100">Inactive</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{rule.description}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(rule)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm('Delete this rule?')) {
                            deleteRuleMutation.mutate(rule.id);
                          }
                        }}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredRules.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No rules match your filters
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? 'Edit Compliance Rule' : 'Add New Compliance Rule'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Rule Name *</Label>
              <Input
                value={formData.rule_name}
                onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
                placeholder="E.g., Homebound Status Verification"
                className="mt-2"
              />
            </div>

            <div>
              <Label>Description *</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe what this rule checks for..."
                className="mt-2"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select 
                  value={formData.category} 
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
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
                <Select 
                  value={formData.severity} 
                  onValueChange={(value) => setFormData({ ...formData, severity: value })}
                >
                  <SelectTrigger className="mt-2">
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
              <Label>Validation Logic (AI Instructions)</Label>
              <Textarea
                value={formData.validation_logic}
                onChange={(e) => setFormData({ ...formData, validation_logic: e.target.value })}
                placeholder="Describe how the AI should validate this rule..."
                className="mt-2 min-h-24"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={formData.auto_fix_available}
                onCheckedChange={(checked) => setFormData({ ...formData, auto_fix_available: checked })}
              />
              <Label>Auto-fix available</Label>
            </div>

            {formData.auto_fix_available && (
              <div>
                <Label>Fix Template</Label>
                <Textarea
                  value={formData.fix_template}
                  onChange={(e) => setFormData({ ...formData, fix_template: e.target.value })}
                  placeholder="Template text for auto-fix..."
                  className="mt-2"
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label>Rule is active</Label>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={saveRuleMutation.isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {saveRuleMutation.isPending ? 'Saving...' : (editingRule ? 'Update Rule' : 'Create Rule')}
              </Button>
              <Button
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}