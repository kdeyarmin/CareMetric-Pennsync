import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Plus, Edit2, Trash2, Play, Pause, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

export default function AlertRuleManager() {
  const [editingRule, setEditingRule] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const queryClient = useQueryClient();

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['alertRules'],
    queryFn: () => base44.entities.AlertTriggerRule.list()
  });

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.AlertTriggerRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertRules'] });
      setShowDialog(false);
      setEditingRule(null);
      toast.success('Alert rule created');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AlertTriggerRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertRules'] });
      setShowDialog(false);
      setEditingRule(null);
      toast.success('Alert rule updated');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.AlertTriggerRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertRules'] });
      toast.success('Alert rule deleted');
    }
  });

  const testRuleMutation = useMutation({
    mutationFn: () => base44.functions.invoke('automatedAlertMonitoring', { force_check: true }),
    onSuccess: (result) => {
      toast.success(`Test complete: ${result.alerts_created} alerts created`);
      queryClient.invalidateQueries({ queryKey: ['patientAlerts'] });
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    const ruleData = {
      rule_name: formData.get('rule_name'),
      rule_type: formData.get('rule_type'),
      alert_severity: formData.get('alert_severity'),
      trigger_condition: {
        parameter: formData.get('parameter'),
        operator: formData.get('operator'),
        threshold_value: parseFloat(formData.get('threshold_value')) || undefined,
        threshold_min: parseFloat(formData.get('threshold_min')) || undefined,
        threshold_max: parseFloat(formData.get('threshold_max')) || undefined,
        timeframe_hours: parseFloat(formData.get('timeframe_hours')) || 24
      },
      alert_title_template: formData.get('alert_title_template'),
      alert_description_template: formData.get('alert_description_template'),
      recommended_actions: formData.get('recommended_actions')?.split('\n').filter(Boolean) || [],
      notification_channels: ['in_app', 'email'],
      notify_roles: ['admin'],
      applies_to_patients: formData.get('applies_to_patients') || 'all',
      cooldown_hours: parseFloat(formData.get('cooldown_hours')) || 24,
      is_active: true,
      created_by: user?.email
    };

    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: ruleData });
    } else {
      createMutation.mutate(ruleData);
    }
  };

  const getRuleBadgeColor = (type) => {
    const colors = {
      vital_sign_threshold: 'bg-red-100 text-red-800',
      lab_result_critical: 'bg-purple-100 text-purple-800',
      missed_visit: 'bg-orange-100 text-orange-800',
      weight_change: 'bg-blue-100 text-blue-800',
      pain_level: 'bg-pink-100 text-pink-800',
      functional_decline: 'bg-amber-100 text-amber-800',
      predictive_risk: 'bg-indigo-100 text-indigo-800'
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  if (isLoading) return <div>Loading alert rules...</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                Automated Alert Rules
              </CardTitle>
              <CardDescription>
                Configure triggers to automatically generate patient alerts
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => testRuleMutation.mutate()}
                variant="outline"
                size="sm"
                disabled={testRuleMutation.isPending}
              >
                <Play className="h-4 w-4 mr-2" />
                Test All Rules
              </Button>
              <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogTrigger asChild>
                  <Button onClick={() => setEditingRule(null)}>
                    <Plus className="h-4 w-4 mr-2" />
                    New Rule
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingRule ? 'Edit' : 'Create'} Alert Rule</DialogTitle>
                    <DialogDescription>
                      Configure automated patient monitoring and alerting
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Rule Name</Label>
                        <Input
                          name="rule_name"
                          defaultValue={editingRule?.rule_name}
                          placeholder="e.g., High Blood Pressure Alert"
                          required
                        />
                      </div>
                      <div>
                        <Label>Rule Type</Label>
                        <Select name="rule_type" defaultValue={editingRule?.rule_type} required>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="vital_sign_threshold">Vital Sign Threshold</SelectItem>
                            <SelectItem value="lab_result_critical">Critical Lab Result</SelectItem>
                            <SelectItem value="missed_visit">Missed Visit</SelectItem>
                            <SelectItem value="medication_adherence">Medication Adherence</SelectItem>
                            <SelectItem value="weight_change">Weight Change</SelectItem>
                            <SelectItem value="pain_level">Pain Level</SelectItem>
                            <SelectItem value="functional_decline">Functional Decline</SelectItem>
                            <SelectItem value="care_plan_stalled">Care Plan Stalled</SelectItem>
                            <SelectItem value="overdue_task">Overdue Tasks</SelectItem>
                            <SelectItem value="predictive_risk">Predictive Risk Score</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Severity</Label>
                        <Select name="alert_severity" defaultValue={editingRule?.alert_severity || 'moderate'}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="moderate">Moderate</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="critical">Critical</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Applies To</Label>
                        <Select name="applies_to_patients" defaultValue={editingRule?.applies_to_patients || 'all'}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Patients</SelectItem>
                            <SelectItem value="high_risk_only">High Risk Only</SelectItem>
                            <SelectItem value="specific_diagnoses">Specific Diagnoses</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <h4 className="font-semibold mb-3">Trigger Conditions</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Parameter</Label>
                          <Input
                            name="parameter"
                            defaultValue={editingRule?.trigger_condition?.parameter}
                            placeholder="e.g., blood_pressure_systolic"
                          />
                        </div>
                        <div>
                          <Label>Operator</Label>
                          <Select name="operator" defaultValue={editingRule?.trigger_condition?.operator}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select operator" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="greater_than">Greater Than</SelectItem>
                              <SelectItem value="less_than">Less Than</SelectItem>
                              <SelectItem value="outside_range">Outside Range</SelectItem>
                              <SelectItem value="change_percentage">Change %</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Threshold Value</Label>
                          <Input
                            name="threshold_value"
                            type="number"
                            step="0.01"
                            defaultValue={editingRule?.trigger_condition?.threshold_value}
                          />
                        </div>
                        <div>
                          <Label>Timeframe (hours)</Label>
                          <Input
                            name="timeframe_hours"
                            type="number"
                            defaultValue={editingRule?.trigger_condition?.timeframe_hours || 24}
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label>Alert Title Template</Label>
                      <Input
                        name="alert_title_template"
                        defaultValue={editingRule?.alert_title_template}
                        placeholder="e.g., High BP Alert for {{patient_name}}"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Use: {`{{patient_name}}, {{value}}, {{threshold}}, {{parameter}}`}
                      </p>
                    </div>

                    <div>
                      <Label>Alert Description Template</Label>
                      <Textarea
                        name="alert_description_template"
                        defaultValue={editingRule?.alert_description_template}
                        placeholder="e.g., {{parameter}} of {{value}} exceeds threshold of {{threshold}}"
                        rows={3}
                      />
                    </div>

                    <div>
                      <Label>Recommended Actions (one per line)</Label>
                      <Textarea
                        name="recommended_actions"
                        defaultValue={editingRule?.recommended_actions?.join('\n')}
                        placeholder="Review vital signs&#10;Contact physician&#10;Assess medication adherence"
                        rows={4}
                      />
                    </div>

                    <div>
                      <Label>Cooldown Period (hours)</Label>
                      <Input
                        name="cooldown_hours"
                        type="number"
                        defaultValue={editingRule?.cooldown_hours || 24}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Minimum time between repeat alerts
                      </p>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                      <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                        {editingRule ? 'Update' : 'Create'} Rule
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {rules.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                No alert rules configured. Create your first rule to enable automated monitoring.
              </div>
            ) : (
              rules.map((rule) => (
                <Card key={rule.id} className={!rule.is_active ? 'opacity-50' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-semibold">{rule.rule_name}</h4>
                          <Badge className={getRuleBadgeColor(rule.rule_type)}>
                            {rule.rule_type.replace(/_/g, ' ')}
                          </Badge>
                          <Badge variant="outline">{rule.alert_severity}</Badge>
                          {!rule.is_active && <Badge variant="outline">Inactive</Badge>}
                        </div>
                        <p className="text-sm text-gray-600 mb-2">
                          {rule.alert_description_template || 'No description'}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>
                            <TrendingUp className="h-3 w-3 inline mr-1" />
                            Triggered {rule.trigger_count || 0} times
                          </span>
                          {rule.last_triggered && (
                            <span>Last: {new Date(rule.last_triggered).toLocaleDateString()}</span>
                          )}
                          <span>Cooldown: {rule.cooldown_hours}h</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={rule.is_active}
                          onCheckedChange={(checked) => {
                            updateMutation.mutate({
                              id: rule.id,
                              data: { is_active: checked }
                            });
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingRule(rule);
                            setShowDialog(true);
                          }}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm('Delete this alert rule?')) {
                              deleteMutation.mutate(rule.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}