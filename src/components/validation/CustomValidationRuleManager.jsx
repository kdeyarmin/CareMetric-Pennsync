import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { 
  Settings, 
  Plus, 
  Edit, 
  Trash2,
  AlertTriangle,
  Info
} from "lucide-react";

export default function CustomValidationRuleManager() {
  const confirm = useConfirm();
  const [showDialog, setShowDialog] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    rule_name: '',
    entity_type: 'patient',
    field_name: '',
    validation_type: 'required',
    validation_value: '',
    error_message: '',
    severity: 'error',
    is_active: true
  });

  const { data: rules = [] } = useQuery({
    queryKey: ['customValidationRules'],
    queryFn: () => base44.entities.CustomValidationRule.list('-created_date')
  });

  const createRuleMutation = useMutation({
    mutationFn: (data) => base44.entities.CustomValidationRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customValidationRules'] });
      resetForm();
    }
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CustomValidationRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customValidationRules'] });
      resetForm();
    }
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id) => base44.entities.CustomValidationRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customValidationRules'] });
    }
  });

  const resetForm = () => {
    setFormData({
      rule_name: '',
      entity_type: 'patient',
      field_name: '',
      validation_type: 'required',
      validation_value: '',
      error_message: '',
      severity: 'error',
      is_active: true
    });
    setEditingRule(null);
    setShowDialog(false);
  };

  const handleSubmit = () => {
    if (editingRule) {
      updateRuleMutation.mutate({ id: editingRule.id, data: formData });
    } else {
      createRuleMutation.mutate(formData);
    }
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData({
      rule_name: rule.rule_name,
      entity_type: rule.entity_type,
      field_name: rule.field_name,
      validation_type: rule.validation_type,
      validation_value: rule.validation_value || '',
      error_message: rule.error_message || '',
      severity: rule.severity,
      is_active: rule.is_active
    });
    setShowDialog(true);
  };

  const handleDelete = async (id) => {
    if (await confirm({ title: "Delete rule?", description: "Are you sure you want to delete this validation rule?", confirmText: "Delete", destructive: true })) {
      deleteRuleMutation.mutate(id);
    }
  };

  const severityConfig = {
    error: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100' },
    warning: { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-100' },
    info: { icon: Info, color: 'text-blue-600', bg: 'bg-blue-100' }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Custom Validation Rules
            </CardTitle>
            <Button onClick={() => setShowDialog(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-96">
            <div className="space-y-3 pr-4">
              {rules.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Settings className="w-12 h-12 mx-auto mb-3 text-slate-400" />
                  <p className="text-sm">No custom validation rules defined</p>
                </div>
              ) : (
                rules.map((rule) => {
                  const SeverityIcon = severityConfig[rule.severity]?.icon || Info;
                  return (
                    <Card key={rule.id} className={`${rule.is_active ? '' : 'opacity-60'}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-semibold">{rule.rule_name}</h4>
                              <Badge variant="outline" className={severityConfig[rule.severity]?.bg}>
                                <SeverityIcon className="w-3 h-3 mr-1" />
                                {rule.severity}
                              </Badge>
                              {!rule.is_active && (
                                <Badge variant="outline" className="bg-slate-100">
                                  Inactive
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-slate-600 space-y-1">
                              <p><strong>Entity:</strong> {rule.entity_type}</p>
                              <p><strong>Field:</strong> {rule.field_name}</p>
                              <p><strong>Type:</strong> {rule.validation_type}</p>
                              {rule.validation_value && (
                                <p><strong>Value:</strong> {rule.validation_value}</p>
                              )}
                              {rule.error_message && (
                                <p className="text-red-700 bg-red-50 p-2 rounded mt-2">
                                  "{rule.error_message}"
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(rule)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(rule.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? 'Edit Validation Rule' : 'Create Validation Rule'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label>Rule Name *</Label>
              <Input
                value={formData.rule_name}
                onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
                placeholder="e.g., Require Valid Email"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Entity Type *</Label>
                <Select 
                  value={formData.entity_type} 
                  onValueChange={(value) => setFormData({ ...formData, entity_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="patient">Patient</SelectItem>
                    <SelectItem value="visit">Visit</SelectItem>
                    <SelectItem value="care_plan">Care Plan</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Field Name *</Label>
                <Input
                  value={formData.field_name}
                  onChange={(e) => setFormData({ ...formData, field_name: e.target.value })}
                  placeholder="e.g., email, phone"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Validation Type *</Label>
                <Select 
                  value={formData.validation_type} 
                  onValueChange={(value) => setFormData({ ...formData, validation_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="required">Required</SelectItem>
                    <SelectItem value="min_length">Minimum Length</SelectItem>
                    <SelectItem value="max_length">Maximum Length</SelectItem>
                    <SelectItem value="regex">Regex Pattern</SelectItem>
                    <SelectItem value="range">Numeric Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Validation Value</Label>
                <Input
                  value={formData.validation_value}
                  onChange={(e) => setFormData({ ...formData, validation_value: e.target.value })}
                  placeholder={
                    formData.validation_type === 'regex' ? '^[A-Z]{2}\\d{5}$' :
                    formData.validation_type === 'range' ? '0,100' :
                    formData.validation_type === 'min_length' ? '5' : ''
                  }
                />
              </div>
            </div>

            <div>
              <Label>Error Message</Label>
              <Textarea
                value={formData.error_message}
                onChange={(e) => setFormData({ ...formData, error_message: e.target.value })}
                placeholder="Custom error message to display when validation fails"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Severity</Label>
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

              <div className="flex items-center space-x-2 pt-6">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label>Active</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={!formData.rule_name || !formData.field_name || createRuleMutation.isPending || updateRuleMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {editingRule ? 'Update Rule' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}