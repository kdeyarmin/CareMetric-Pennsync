import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Shield, 
  Plus, 
  Edit2, 
  Trash2,
  Lock,
  CheckCircle,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function ComplianceRulesEngine() {
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState({
    rule_name: '',
    rule_type: 'field_required',
    target_entity: 'Visit',
    target_field: '',
    validation_logic: '',
    error_message: '',
    severity: 'error',
    is_mandatory: false,
    is_active: true
  });

  const queryClient = useQueryClient();

  const { data: rules, isLoading } = useQuery({
    queryKey: ['compliance-rules'],
    queryFn: () => base44.entities.CustomValidationRule.filter({})
  });

  const createRuleMutation = useMutation({
    mutationFn: async (ruleData) => {
      if (editingRule) {
        return await base44.entities.CustomValidationRule.update(editingRule.id, ruleData);
      }
      return await base44.entities.CustomValidationRule.create(ruleData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['compliance-rules']);
      setShowForm(false);
      setEditingRule(null);
      resetForm();
      toast.success(editingRule ? 'Rule updated' : 'Rule created');
    },
    onError: (error) => {
      toast.error('Failed to save rule: ' + error.message);
    }
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId) => {
      return await base44.entities.CustomValidationRule.delete(ruleId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['compliance-rules']);
      toast.success('Rule deleted');
    }
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async ({ ruleId, isActive }) => {
      return await base44.entities.CustomValidationRule.update(ruleId, { is_active: isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['compliance-rules']);
    }
  });

  const resetForm = () => {
    setFormData({
      rule_name: '',
      rule_type: 'field_required',
      target_entity: 'Visit',
      target_field: '',
      validation_logic: '',
      error_message: '',
      severity: 'error',
      is_mandatory: false,
      is_active: true
    });
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData(rule);
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    createRuleMutation.mutate(formData);
  };

  const activeRules = rules?.filter(r => r.is_active) || [];
  const mandatoryRules = rules?.filter(r => r.is_mandatory) || [];

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Compliance Rules Engine</h1>
            <p className="text-sm text-slate-600 mt-1">Configure custom validation rules</p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setEditingRule(null);
              setShowForm(!showForm);
            }}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Rule
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Shield className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{rules?.length || 0}</p>
                  <p className="text-xs text-slate-600">Total Rules</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-100 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{activeRules.length}</p>
                  <p className="text-xs text-slate-600">Active Rules</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-100 rounded-lg">
                  <Lock className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{mandatoryRules.length}</p>
                  <p className="text-xs text-slate-600">Mandatory Gates</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Form */}
        {showForm && (
          <Card className="border-2 border-blue-300">
            <CardHeader>
              <CardTitle>{editingRule ? 'Edit Rule' : 'Create New Rule'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Rule Name</label>
                    <Input
                      value={formData.rule_name}
                      onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
                      placeholder="e.g., Visit Notes Required"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Rule Type</label>
                    <Select 
                      value={formData.rule_type} 
                      onValueChange={(value) => setFormData({ ...formData, rule_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="field_required">Field Required</SelectItem>
                        <SelectItem value="field_format">Field Format</SelectItem>
                        <SelectItem value="field_range">Field Range</SelectItem>
                        <SelectItem value="conditional">Conditional Logic</SelectItem>
                        <SelectItem value="cross_field">Cross-Field Validation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Target Entity</label>
                    <Select 
                      value={formData.target_entity} 
                      onValueChange={(value) => setFormData({ ...formData, target_entity: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Visit">Visit</SelectItem>
                        <SelectItem value="Patient">Patient</SelectItem>
                        <SelectItem value="CarePlan">Care Plan</SelectItem>
                        <SelectItem value="OASISAudit">OASIS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Target Field</label>
                    <Input
                      value={formData.target_field}
                      onChange={(e) => setFormData({ ...formData, target_field: e.target.value })}
                      placeholder="e.g., visit_notes"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Validation Logic</label>
                  <Textarea
                    value={formData.validation_logic}
                    onChange={(e) => setFormData({ ...formData, validation_logic: e.target.value })}
                    placeholder="e.g., value !== null && value.length > 0"
                    rows={3}
                    required
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    JavaScript expression that returns true if valid
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Error Message</label>
                  <Textarea
                    value={formData.error_message}
                    onChange={(e) => setFormData({ ...formData, error_message: e.target.value })}
                    placeholder="e.g., Visit notes are required for all visits"
                    rows={2}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Severity</label>
                    <Select 
                      value={formData.severity} 
                      onValueChange={(value) => setFormData({ ...formData, severity: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="error">Error (Blocks Save)</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="info">Info</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3 pt-7">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Mandatory Gate</label>
                      <Switch
                        checked={formData.is_mandatory}
                        onCheckedChange={(checked) => setFormData({ ...formData, is_mandatory: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Active</label>
                      <Switch
                        checked={formData.is_active}
                        onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button type="submit" disabled={createRuleMutation.isPending} className="flex-1">
                    {createRuleMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Saving...
                      </>
                    ) : (
                      editingRule ? 'Update Rule' : 'Create Rule'
                    )}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => {
                      setShowForm(false);
                      setEditingRule(null);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Rules List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : rules?.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Shield className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <p className="text-slate-600 mb-4">No compliance rules configured</p>
              <Button onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Rule
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {rules.map(rule => (
              <Card key={rule.id} className="border-l-4 border-l-blue-600">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-bold text-lg">{rule.rule_name}</h3>
                        <Badge variant={rule.severity === 'error' ? 'destructive' : 'outline'}>
                          {rule.severity}
                        </Badge>
                        {rule.is_mandatory && (
                          <Badge className="bg-red-100 text-red-800">
                            <Lock className="h-3 w-3 mr-1" />
                            Mandatory
                          </Badge>
                        )}
                        <Badge variant={rule.is_active ? 'default' : 'outline'}>
                          {rule.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 mb-2">
                        <span className="font-medium">{rule.target_entity}</span> • {rule.target_field} • {rule.rule_type}
                      </p>
                      <p className="text-sm text-slate-700 mb-3">{rule.error_message}</p>
                      <div className="bg-slate-50 p-2 rounded text-xs font-mono">
                        {rule.validation_logic}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={rule.is_active}
                        onCheckedChange={(checked) => 
                          toggleRuleMutation.mutate({ ruleId: rule.id, isActive: checked })
                        }
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(rule)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm('Delete this rule?')) {
                            deleteRuleMutation.mutate(rule.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}