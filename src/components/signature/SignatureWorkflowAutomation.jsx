import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Plus, Zap, Trash2, Play } from "lucide-react";
import { toast } from "sonner";

export default function SignatureWorkflowAutomation() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    trigger_event: "document_created",
    signers: [{ role: "patient", email_template: "patient_email" }],
    auto_send_delay_minutes: 0,
    send_reminders: true,
    reminder_interval_days: 1,
  });

  const { data: workflows = [] } = useQuery({
    queryKey: ["signatureWorkflows"],
    queryFn: async () => {
      try {
        return await base44.entities.OASISAutomationRule.filter(
          { description: "signature_workflow" },
          "-created_date",
          50
        );
      } catch {
        return [];
      }
    },
  });

  const createMutation = useMutation({
    mutationFn: (data) =>
      base44.entities.OASISAutomationRule.create({
        ...data,
        description: "signature_workflow",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signatureWorkflows"] });
      setIsDialogOpen(false);
      resetForm();
      toast.success("Workflow created");
    },
    onError: () => toast.error("Failed to create workflow"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.OASISAutomationRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signatureWorkflows"] });
      toast.success("Workflow deleted");
    },
    onError: () => toast.error("Failed to delete workflow"),
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      trigger_event: "document_created",
      signers: [{ role: "patient", email_template: "patient_email" }],
      auto_send_delay_minutes: 0,
      send_reminders: true,
      reminder_interval_days: 1,
    });
    setEditingWorkflow(null);
  };

  const handleAddSigner = () => {
    setFormData({
      ...formData,
      signers: [
        ...formData.signers,
        { role: "provider", email_template: "provider_email" },
      ],
    });
  };

  const handleRemoveSigner = (idx) => {
    setFormData({
      ...formData,
      signers: formData.signers.filter((_, i) => i !== idx),
    });
  };

  const handleSaveWorkflow = () => {
    if (!formData.name || formData.signers.length === 0) {
      toast.error("Fill in required fields");
      return;
    }

    createMutation.mutate({
      name: formData.name,
      trigger_event: formData.trigger_event,
      signers: formData.signers,
      auto_send_delay_minutes: formData.auto_send_delay_minutes,
      send_reminders: formData.send_reminders,
      reminder_interval_days: formData.reminder_interval_days,
      is_active: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5 text-blue-500" />
          Signature Workflows
        </h3>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              New Workflow
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Signature Workflow</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Workflow Name *
                </label>
                <Input
                  placeholder="e.g., Patient Consent Auto-Request"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Trigger Event
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
                    <SelectItem value="document_created">
                      Document Created
                    </SelectItem>
                    <SelectItem value="document_sent">Document Sent</SelectItem>
                    <SelectItem value="document_viewed">
                      Document Viewed
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Auto-Send Delay (minutes)
                </label>
                <Input
                  type="number"
                  min="0"
                  value={formData.auto_send_delay_minutes}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      auto_send_delay_minutes: parseInt(e.target.value),
                    })
                  }
                  placeholder="0 for immediate"
                />
              </div>

              <div className="border-t pt-3">
                <div className="flex justify-between items-center mb-3">
                  <label className="text-sm font-medium">Signers</label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddSigner}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Signer
                  </Button>
                </div>

                <div className="space-y-2">
                  {formData.signers.map((signer, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <Select
                        value={signer.role}
                        onValueChange={(value) => {
                          const updated = [...formData.signers];
                          updated[idx].role = value;
                          setFormData({ ...formData, signers: updated });
                        }}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="patient">Patient</SelectItem>
                          <SelectItem value="provider">Provider</SelectItem>
                          <SelectItem value="witness">Witness</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveSigner(idx)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="reminders"
                  checked={formData.send_reminders}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      send_reminders: e.target.checked,
                    })
                  }
                />
                <label htmlFor="reminders" className="text-sm">
                  Send reminder emails
                </label>
              </div>

              {formData.send_reminders && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Reminder every (days)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    value={formData.reminder_interval_days}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        reminder_interval_days: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveWorkflow}
                  disabled={createMutation.isPending}
                >
                  Create Workflow
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {workflows.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-gray-500 text-center">
                No workflows yet. Create one to automate signature requests.
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
                      <h4 className="font-semibold">{workflow.name}</h4>
                      <Badge className="bg-green-100 text-green-800 text-xs">
                        Active
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 mb-2">
                      Triggers on: {workflow.trigger_event?.replace(/_/g, " ")}
                    </p>
                    <div className="text-xs text-gray-500">
                      {workflow.signers?.length || 0} signer(s)
                      {workflow.send_reminders && " • Reminders enabled"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      window.confirm("Delete workflow?") &&
                      deleteMutation.mutate(workflow.id)
                    }
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}