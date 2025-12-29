import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2, Bell } from "lucide-react";
import { toast } from "sonner";

export default function NotificationRuleManager() {
  const [showDialog, setShowDialog] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    rule_type: "event_based",
    trigger_event: "patient_alert",
    is_active: true,
    recipients: [{ type: "role", value: "admin" }],
    notification_template: {
      subject: "",
      body: "",
      variables: []
    },
    throttle: {
      enabled: false,
      max_per_hour: 10,
      max_per_day: 50
    }
  });

  const queryClient = useQueryClient();

  const { data: rules = [] } = useQuery({
    queryKey: ['notificationRules'],
    queryFn: () => base44.entities.NotificationRule.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.NotificationRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationRules'] });
      setShowDialog(false);
      resetForm();
      toast.success("Notification rule created");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.NotificationRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationRules'] });
      setShowDialog(false);
      resetForm();
      toast.success("Notification rule updated");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.NotificationRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationRules'] });
      toast.success("Notification rule deleted");
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      rule_type: "event_based",
      trigger_event: "patient_alert",
      is_active: true,
      recipients: [{ type: "role", value: "admin" }],
      notification_template: {
        subject: "",
        body: "",
        variables: []
      },
      throttle: {
        enabled: false,
        max_per_hour: 10,
        max_per_day: 50
      }
    });
    setEditingRule(null);
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData(rule);
    setShowDialog(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const addRecipient = () => {
    setFormData({
      ...formData,
      recipients: [...formData.recipients, { type: "email", value: "" }]
    });
  };

  const updateRecipient = (index, field, value) => {
    const newRecipients = [...formData.recipients];
    newRecipients[index][field] = value;
    setFormData({ ...formData, recipients: newRecipients });
  };

  const removeRecipient = (index) => {
    setFormData({
      ...formData,
      recipients: formData.recipients.filter((_, i) => i !== index)
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Notification Rules</h2>
          <p className="text-gray-600">Configure automated alerts and notifications</p>
        </div>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setShowDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              New Rule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingRule ? 'Edit Rule' : 'Create Notification Rule'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Rule Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Rule Type</Label>
                  <Select value={formData.rule_type} onValueChange={(v) => setFormData({ ...formData, rule_type: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="event_based">Event Based</SelectItem>
                      <SelectItem value="threshold_based">Threshold Based</SelectItem>
                      <SelectItem value="time_based">Time Based</SelectItem>
                      <SelectItem value="condition_based">Condition Based</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Trigger Event</Label>
                  <Select value={formData.trigger_event} onValueChange={(v) => setFormData({ ...formData, trigger_event: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patient_alert">Patient Alert</SelectItem>
                      <SelectItem value="task_overdue">Task Overdue</SelectItem>
                      <SelectItem value="compliance_issue">Compliance Issue</SelectItem>
                      <SelectItem value="user_action">User Action</SelectItem>
                      <SelectItem value="system_event">System Event</SelectItem>
                      <SelectItem value="data_threshold">Data Threshold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Notification Subject</Label>
                <Input
                  value={formData.notification_template.subject}
                  onChange={(e) => setFormData({
                    ...formData,
                    notification_template: { ...formData.notification_template, subject: e.target.value }
                  })}
                  placeholder="e.g., Alert: {{patient_name}} requires attention"
                />
              </div>

              <div>
                <Label>Notification Body</Label>
                <Textarea
                  value={formData.notification_template.body}
                  onChange={(e) => setFormData({
                    ...formData,
                    notification_template: { ...formData.notification_template, body: e.target.value }
                  })}
                  placeholder="Use {{variable_name}} for dynamic content"
                  rows={4}
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label>Recipients</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addRecipient}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </div>
                {formData.recipients.map((recipient, index) => (
                  <div key={index} className="flex gap-2 mb-2">
                    <Select value={recipient.type} onValueChange={(v) => updateRecipient(index, 'type', v)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="role">Role</SelectItem>
                        <SelectItem value="user">User</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={recipient.value}
                      onChange={(e) => updateRecipient(index, 'value', e.target.value)}
                      placeholder={recipient.type === 'email' ? 'email@example.com' : recipient.type}
                      className="flex-1"
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeRecipient(index)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Switch
                    checked={formData.throttle.enabled}
                    onCheckedChange={(checked) => setFormData({
                      ...formData,
                      throttle: { ...formData.throttle, enabled: checked }
                    })}
                  />
                  <Label>Enable Throttling</Label>
                </div>
                {formData.throttle.enabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Max per Hour</Label>
                      <Input
                        type="number"
                        value={formData.throttle.max_per_hour}
                        onChange={(e) => setFormData({
                          ...formData,
                          throttle: { ...formData.throttle, max_per_hour: parseInt(e.target.value) }
                        })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Max per Day</Label>
                      <Input
                        type="number"
                        value={formData.throttle.max_per_day}
                        onChange={(e) => setFormData({
                          ...formData,
                          throttle: { ...formData.throttle, max_per_day: parseInt(e.target.value) }
                        })}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label>Active</Label>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingRule ? 'Update' : 'Create'} Rule
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {rules.map((rule) => (
          <Card key={rule.id}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Bell className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-bold">{rule.name}</h3>
                    <Badge variant={rule.is_active ? "default" : "secondary"}>
                      {rule.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="text-gray-600 mb-3">{rule.description}</p>
                  <div className="flex gap-4 text-sm text-gray-600">
                    <span>Type: {rule.rule_type.replace('_', ' ')}</span>
                    <span>•</span>
                    <span>Trigger: {rule.trigger_event.replace('_', ' ')}</span>
                    <span>•</span>
                    <span>{rule.recipients?.length || 0} recipients</span>
                    {rule.trigger_count > 0 && (
                      <>
                        <span>•</span>
                        <span>Triggered {rule.trigger_count}x</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(rule)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm('Delete this notification rule?')) {
                        deleteMutation.mutate(rule.id);
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
    </div>
  );
}