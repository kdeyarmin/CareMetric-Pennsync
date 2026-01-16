import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Save, X, ShieldCheck, AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";

export default function CustomComplianceRules() {
  const [editingRule, setEditingRule] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['customComplianceRules'],
    queryFn: () => base44.entities.ComplianceRule.list('-created_date', 500)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ComplianceRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['customComplianceRules']);
      setShowForm(false);
      setEditingRule(null);
      toast.success("Compliance rule created");
    },
    onError: (error) => {
      toast.error("Failed to create rule");
      console.error(error);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ComplianceRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['customComplianceRules']);
      setShowForm(false);
      setEditingRule(null);
      toast.success("Compliance rule updated");
    },
    onError: (error) => {
      toast.error("Failed to update rule");
      console.error(error);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ComplianceRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['customComplianceRules']);
      toast.success("Compliance rule deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete rule");
      console.error(error);
    }
  });

  const handleSave = (ruleData) => {
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: ruleData });
    } else {
      createMutation.mutate(ruleData);
    }
  };

  const filteredRules = rules.filter(rule => {
    const matchesSearch = !searchTerm || 
      rule.rule_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rule.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'all' || rule.category === filterCategory;
    const matchesSeverity = filterSeverity === 'all' || rule.severity === filterSeverity;
    return matchesSearch && matchesCategory && matchesSeverity;
  });

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-slate-600">Admin access required</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Custom Compliance Rules</h1>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Define organization-specific compliance requirements
            </p>
          </div>
          <Button onClick={() => { setShowForm(true); setEditingRule(null); }} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4 mr-2" />
            New Rule
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search rules..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="documentation">Documentation</SelectItem>
                  <SelectItem value="clinical">Clinical</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="safety">Safety</SelectItem>
                  <SelectItem value="organizational">Organizational</SelectItem>
                  <SelectItem value="regional">Regional</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                <SelectTrigger>
                  <SelectValue placeholder="All Severities" />
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
          </CardContent>
        </Card>

        {/* Rules List */}
        <div className="grid gap-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-6 text-center">Loading rules...</CardContent>
            </Card>
          ) : filteredRules.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-slate-600">
                {rules.length === 0 ? "No compliance rules defined yet" : "No rules match your filters"}
              </CardContent>
            </Card>
          ) : (
            filteredRules.map((rule) => (
              <Card key={rule.id} className={!rule.is_active ? "opacity-50" : ""}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <CardTitle className="text-lg">{rule.rule_name}</CardTitle>
                        <Badge className={
                          rule.severity === 'critical' ? 'bg-red-600' :
                          rule.severity === 'high' ? 'bg-orange-500' :
                          rule.severity === 'medium' ? 'bg-yellow-500' :
                          'bg-blue-500'
                        }>
                          {rule.severity}
                        </Badge>
                        <Badge variant="outline">{rule.category}</Badge>
                        {!rule.is_active && <Badge variant="outline">Inactive</Badge>}
                      </div>
                      <CardDescription>{rule.description}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingRule(rule);
                          setShowForm(true);
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm('Delete this compliance rule?')) {
                            deleteMutation.mutate(rule.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    {rule.validation_criteria && (
                      <div>
                        <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Validation Criteria:</p>
                        <p className="text-slate-600 dark:text-slate-400">{rule.validation_criteria}</p>
                      </div>
                    )}
                    {rule.example_violation && (
                      <div>
                        <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Example Violation:</p>
                        <p className="text-slate-600 dark:text-slate-400 italic">{rule.example_violation}</p>
                      </div>
                    )}
                    {rule.remediation_guidance && (
                      <div className="bg-green-50 dark:bg-green-950 p-3 rounded">
                        <p className="font-medium text-green-800 dark:text-green-300 mb-1">How to Fix:</p>
                        <p className="text-green-700 dark:text-green-400">{rule.remediation_guidance}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      {rule.applies_to_visit_types?.length > 0 && (
                        <span>Visit Types: {rule.applies_to_visit_types.join(', ')}</span>
                      )}
                      {rule.regulation_reference && (
                        <span>Reference: {rule.regulation_reference}</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Edit/Create Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <Card className="w-full max-w-2xl my-8">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{editingRule ? 'Edit' : 'Create'} Compliance Rule</CardTitle>
                  <Button size="icon" variant="ghost" onClick={() => { setShowForm(false); setEditingRule(null); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ComplianceRuleForm
                  initialData={editingRule}
                  onSave={handleSave}
                  onCancel={() => { setShowForm(false); setEditingRule(null); }}
                  isSaving={createMutation.isPending || updateMutation.isPending}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function ComplianceRuleForm({ initialData, onSave, onCancel, isSaving }) {
  const [formData, setFormData] = useState({
    rule_name: initialData?.rule_name || "",
    description: initialData?.description || "",
    category: initialData?.category || "documentation",
    severity: initialData?.severity || "medium",
    validation_criteria: initialData?.validation_criteria || "",
    example_violation: initialData?.example_violation || "",
    remediation_guidance: initialData?.remediation_guidance || "",
    regulation_reference: initialData?.regulation_reference || "",
    applies_to_visit_types: initialData?.applies_to_visit_types || [],
    applies_to_provider_types: initialData?.applies_to_provider_types || [],
    is_active: initialData?.is_active ?? true,
    auto_flag: initialData?.auto_flag ?? true
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.rule_name.trim() || !formData.validation_criteria.trim()) {
      toast.error("Rule name and validation criteria are required");
      return;
    }
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Rule Name *</Label>
        <Input
          value={formData.rule_name}
          onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
          placeholder="e.g., Medicare Homebound Documentation Required"
        />
      </div>

      <div>
        <Label>Description</Label>
        <Textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Brief description of this compliance requirement"
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Category *</Label>
          <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="documentation">Documentation</SelectItem>
              <SelectItem value="clinical">Clinical</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
              <SelectItem value="safety">Safety</SelectItem>
              <SelectItem value="organizational">Organizational</SelectItem>
              <SelectItem value="regional">Regional</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Severity *</Label>
          <Select value={formData.severity} onValueChange={(value) => setFormData({ ...formData, severity: value })}>
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
        <Label>Validation Criteria * (How to check compliance)</Label>
        <Textarea
          value={formData.validation_criteria}
          onChange={(e) => setFormData({ ...formData, validation_criteria: e.target.value })}
          placeholder="e.g., All skilled nursing visits must document homebound status with specific justification..."
          rows={3}
        />
      </div>

      <div>
        <Label>Example Violation</Label>
        <Textarea
          value={formData.example_violation}
          onChange={(e) => setFormData({ ...formData, example_violation: e.target.value })}
          placeholder="Example of what violates this rule"
          rows={2}
        />
      </div>

      <div>
        <Label>Remediation Guidance (How to fix)</Label>
        <Textarea
          value={formData.remediation_guidance}
          onChange={(e) => setFormData({ ...formData, remediation_guidance: e.target.value })}
          placeholder="Clear instructions on how to address violations"
          rows={2}
        />
      </div>

      <div>
        <Label>Regulation Reference (Optional)</Label>
        <Input
          value={formData.regulation_reference}
          onChange={(e) => setFormData({ ...formData, regulation_reference: e.target.value })}
          placeholder="e.g., 42 CFR 484.60, State Regulation XYZ-123"
        />
      </div>

      <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded">
        <div>
          <Label>Active Rule</Label>
          <p className="text-xs text-slate-600 dark:text-slate-400">Enable this compliance rule</p>
        </div>
        <Switch
          checked={formData.is_active}
          onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
        />
      </div>

      <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded">
        <div>
          <Label>Auto-Flag Violations</Label>
          <p className="text-xs text-slate-600 dark:text-slate-400">Automatically flag notes that violate this rule</p>
        </div>
        <Switch
          checked={formData.auto_flag}
          onCheckedChange={(checked) => setFormData({ ...formData, auto_flag: checked })}
        />
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving} className="flex-1 bg-indigo-600 hover:bg-indigo-700">
          {isSaving ? 'Saving...' : 'Save Rule'}
        </Button>
      </div>
    </form>
  );
}