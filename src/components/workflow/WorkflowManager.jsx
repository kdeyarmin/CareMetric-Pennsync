import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2, Play, Pause } from "lucide-react";
import { toast } from "sonner";

export default function WorkflowManager() {
  const [showDialog, setShowDialog] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    workflow_type: "user_approval",
    trigger_event: "user_invite",
    is_active: true,
    steps: [
      {
        step_name: "Initial Approval",
        step_type: "approval",
        approver_role: "admin",
        timeout_hours: 24
      }
    ]
  });

  const queryClient = useQueryClient();

  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => base44.entities.WorkflowDefinition.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.WorkflowDefinition.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setShowDialog(false);
      resetForm();
      toast.success("Workflow created successfully");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.WorkflowDefinition.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setShowDialog(false);
      resetForm();
      toast.success("Workflow updated successfully");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.WorkflowDefinition.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.success("Workflow deleted successfully");
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      workflow_type: "user_approval",
      trigger_event: "user_invite",
      is_active: true,
      steps: [
        {
          step_name: "Initial Approval",
          step_type: "approval",
          approver_role: "admin",
          timeout_hours: 24
        }
      ]
    });
    setEditingWorkflow(null);
  };

  const handleEdit = (workflow) => {
    setEditingWorkflow(workflow);
    setFormData(workflow);
    setShowDialog(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingWorkflow) {
      updateMutation.mutate({ id: editingWorkflow.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleToggleActive = async (workflow) => {
    await updateMutation.mutateAsync({
      id: workflow.id,
      data: { ...workflow, is_active: !workflow.is_active }
    });
  };

  const addStep = () => {
    setFormData({
      ...formData,
      steps: [
        ...formData.steps,
        {
          step_name: "",
          step_type: "approval",
          approver_role: "admin",
          timeout_hours: 24
        }
      ]
    });
  };

  const updateStep = (index, field, value) => {
    const newSteps = [...formData.steps];
    newSteps[index][field] = value;
    setFormData({ ...formData, steps: newSteps });
  };

  const removeStep = (index) => {
    setFormData({
      ...formData,
      steps: formData.steps.filter((_, i) => i !== index)
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Workflow Definitions</h2>
          <p className="text-gray-600">Create and manage automated workflows</p>
        </div>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setShowDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              New Workflow
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingWorkflow ? 'Edit Workflow' : 'Create Workflow'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Workflow Name</Label>
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
                  <Label>Workflow Type</Label>
                  <Select value={formData.workflow_type} onValueChange={(v) => setFormData({ ...formData, workflow_type: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user_approval">User Approval</SelectItem>
                      <SelectItem value="data_access_request">Data Access Request</SelectItem>
                      <SelectItem value="patient_update">Patient Update</SelectItem>
                      <SelectItem value="compliance_review">Compliance Review</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
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
                      <SelectItem value="user_invite">User Invite</SelectItem>
                      <SelectItem value="role_change">Role Change</SelectItem>
                      <SelectItem value="patient_create">Patient Create</SelectItem>
                      <SelectItem value="patient_update">Patient Update</SelectItem>
                      <SelectItem value="data_export">Data Export</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label>Workflow Steps</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addStep}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Step
                  </Button>
                </div>
                {formData.steps.map((step, index) => (
                  <Card key={index} className="mb-2">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium">Step {index + 1}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeStep(index)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Step Name</Label>
                          <Input
                            value={step.step_name}
                            onChange={(e) => updateStep(index, 'step_name', e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Step Type</Label>
                          <Select value={step.step_type} onValueChange={(v) => updateStep(index, 'step_type', v)}>
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="approval">Approval</SelectItem>
                              <SelectItem value="notification">Notification</SelectItem>
                              <SelectItem value="data_validation">Data Validation</SelectItem>
                              <SelectItem value="automated_action">Automated Action</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {step.step_type === 'approval' && (
                          <>
                            <div>
                              <Label className="text-xs">Approver Role</Label>
                              <Input
                                value={step.approver_role}
                                onChange={(e) => updateStep(index, 'approver_role', e.target.value)}
                                className="h-9"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Timeout (hours)</Label>
                              <Input
                                type="number"
                                value={step.timeout_hours}
                                onChange={(e) => updateStep(index, 'timeout_hours', parseInt(e.target.value))}
                                className="h-9"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
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
                  {editingWorkflow ? 'Update' : 'Create'} Workflow
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {workflows.map((workflow) => (
          <Card key={workflow.id}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold">{workflow.name}</h3>
                    <Badge variant={workflow.is_active ? "default" : "secondary"}>
                      {workflow.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    <Badge variant="outline">{workflow.workflow_type.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-gray-600 mb-3">{workflow.description}</p>
                  <div className="flex gap-2 text-sm text-gray-600">
                    <span>Trigger: {workflow.trigger_event.replace('_', ' ')}</span>
                    <span>•</span>
                    <span>{workflow.steps?.length || 0} steps</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleToggleActive(workflow)}
                  >
                    {workflow.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleEdit(workflow)}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm('Delete this workflow?')) {
                        deleteMutation.mutate(workflow.id);
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