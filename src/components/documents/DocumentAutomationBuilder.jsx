import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Edit, Trash2, Play, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import ConditionalWorkflowBuilder from "./ConditionalWorkflowBuilder";

export default function DocumentAutomationBuilder() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});
  const [formData, setFormData] = useState({
    workflow_name: "",
    description: "",
    template_id: "",
    trigger_type: "event",
    trigger_event: "visit_completed",
    data_sources: [],
    placeholder_mapping: {},
    conditional_branches: [],
    ai_enrichment: {
      enabled: false,
      extract_summary: false,
      extract_keywords: false,
      max_summary_length: 300,
    },
    signature_settings: {
      auto_sign: false,
      require_signature: [],
      send_to_signers: false,
      signer_emails: [],
    },
    post_generation_actions: [],
    is_active: true,
  });

  const { data: workflows = [] } = useQuery({
    queryKey: ["automationWorkflows"],
    queryFn: () => base44.entities.DocumentAutomationWorkflow.list("-created_date"),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["documentTemplates"],
    queryFn: () =>
      base44.entities.DocumentSignatureTemplate.list("-created_date", 100),
  });

  const createMutation = useMutation({
    mutationFn: (data) =>
      base44.entities.DocumentAutomationWorkflow.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automationWorkflows"] });
      toast.success("Workflow created");
      resetForm();
      setShowForm(false);
    },
    onError: () => toast.error("Failed to create workflow"),
  });

  const updateMutation = useMutation({
    mutationFn: (data) =>
      base44.entities.DocumentAutomationWorkflow.update(editingWorkflow.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automationWorkflows"] });
      toast.success("Workflow updated");
      resetForm();
      setShowForm(false);
    },
    onError: () => toast.error("Failed to update workflow"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.DocumentAutomationWorkflow.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automationWorkflows"] });
      toast.success("Workflow deleted");
    },
    onError: () => toast.error("Failed to delete workflow"),
  });

  const resetForm = () => {
    setFormData({
      workflow_name: "",
      description: "",
      template_id: "",
      trigger_type: "event",
      trigger_event: "visit_completed",
      data_sources: [],
      placeholder_mapping: {},
      conditional_branches: [],
      ai_enrichment: {
        enabled: false,
        extract_summary: false,
        extract_keywords: false,
        max_summary_length: 300,
      },
      signature_settings: {
        auto_sign: false,
        require_signature: [],
        send_to_signers: false,
        signer_emails: [],
      },
      post_generation_actions: [],
      is_active: true,
    });
    setEditingWorkflow(null);
    setExpandedSections({});
  };

  const handleSave = () => {
    if (!formData.workflow_name || !formData.template_id) {
      toast.error("Please fill in required fields");
      return;
    }

    if (editingWorkflow) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (workflow) => {
    setEditingWorkflow(workflow);
    setFormData(workflow);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="w-6 h-6" />
          Document Automation Workflows
        </h2>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Create Workflow
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingWorkflow ? "Edit Workflow" : "Create Automation Workflow"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Workflow Name *
              </label>
              <Input
                value={formData.workflow_name}
                onChange={(e) =>
                  setFormData({ ...formData, workflow_name: e.target.value })
                }
                placeholder="e.g., Auto-generate Care Plan Agreement"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Description
              </label>
              <Textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Describe when and how this workflow triggers"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Template *
              </label>
              <Select
                value={formData.template_id}
                onValueChange={(value) =>
                  setFormData({ ...formData, template_id: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.template_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Trigger Type
                </label>
                <Select
                  value={formData.trigger_type}
                  onValueChange={(value) =>
                    setFormData({ ...formData, trigger_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="event">Event-Based</SelectItem>
                    <SelectItem value="schedule">Scheduled</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.trigger_type === "event" && (
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Event Type
                  </label>
                  <Select
                    value={formData.trigger_event}
                    onValueChange={(value) =>
                      setFormData({ ...formData, trigger_event: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="visit_completed">
                        Visit Completed
                      </SelectItem>
                      <SelectItem value="patient_created">
                        Patient Created
                      </SelectItem>
                      <SelectItem value="care_plan_updated">
                        Care Plan Updated
                      </SelectItem>
                      <SelectItem value="form_submitted">
                        Form Submitted
                      </SelectItem>
                      <SelectItem value="threshold_exceeded">
                        Threshold Exceeded
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.signature_settings.auto_sign}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      signature_settings: {
                        ...formData.signature_settings,
                        auto_sign: e.target.checked,
                      },
                    })
                  }
                />
                <span className="text-sm">Auto-sign document</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.signature_settings.send_to_signers}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      signature_settings: {
                        ...formData.signature_settings,
                        send_to_signers: e.target.checked,
                      },
                    })
                  }
                />
                <span className="text-sm">Send to signers automatically</span>
              </label>

              {formData.signature_settings.send_to_signers && (
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Signer Email
                  </label>
                  <Input
                    type="email"
                    placeholder="Enter signer email"
                    onBlur={(e) => {
                      if (e.target.value) {
                        setFormData({
                          ...formData,
                          signature_settings: {
                            ...formData.signature_settings,
                            signer_emails: [
                              ...formData.signature_settings.signer_emails,
                              e.target.value,
                            ],
                          },
                        });
                        e.target.value = "";
                      }
                    }}
                  />
                </div>
              )}
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) =>
                  setFormData({ ...formData, is_active: e.target.checked })
                }
              />
              <span className="text-sm">Workflow is active</span>
            </label>

            {/* Conditional Branches & AI Enrichment */}
            <ConditionalWorkflowBuilder
              workflow={formData}
              onChange={setFormData}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {editingWorkflow ? "Update" : "Create"} Workflow
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {workflows.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-gray-500">
                No automation workflows yet. Create one to get started!
              </p>
            </CardContent>
          </Card>
        ) : (
          workflows.map((workflow) => (
            <Card key={workflow.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-lg">
                        {workflow.workflow_name}
                      </h3>
                      <Badge
                        className={
                          workflow.is_active
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }
                      >
                        {workflow.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    {workflow.description && (
                      <p className="text-sm text-gray-600 mb-2">
                        {workflow.description}
                      </p>
                    )}
                    <div className="text-xs text-gray-500 space-y-1">
                      <p>Trigger: {workflow.trigger_event}</p>
                      <p>
                        Triggered {workflow.trigger_count || 0} times
                        {workflow.last_triggered &&
                          ` • Last: ${new Date(
                            workflow.last_triggered
                          ).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(workflow)}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        window.confirm("Delete this workflow?") &&
                        deleteMutation.mutate(workflow.id)
                      }
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}