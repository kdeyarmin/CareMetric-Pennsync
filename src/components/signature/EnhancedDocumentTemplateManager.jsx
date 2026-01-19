import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import VisualTemplateEditor from "./VisualTemplateEditor";
import { FileText, Plus, Edit, Trash2, Copy, Share2 } from "lucide-react";
import { toast } from "sonner";

export default function EnhancedDocumentTemplateManager() {
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [editorMode, setEditorMode] = useState("visual");
  const [formData, setFormData] = useState({
    template_name: "",
    description: "",
    document_type: "consent_form",
    category: "",
    content: "",
    placeholders: [],
    signature_fields: [],
    is_shared: false,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["documentTemplates"],
    queryFn: () =>
      base44.entities.DocumentSignatureTemplate.list("-created_date", 100),
  });

  const createMutation = useMutation({
    mutationFn: (data) =>
      base44.entities.DocumentSignatureTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documentTemplates"] });
      setIsCreateDialogOpen(false);
      resetForm();
      toast.success("Template created successfully");
    },
    onError: () => toast.error("Failed to create template"),
  });

  const updateMutation = useMutation({
    mutationFn: (data) =>
      base44.entities.DocumentSignatureTemplate.update(editingTemplate.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documentTemplates"] });
      setEditingTemplate(null);
      resetForm();
      toast.success("Template updated successfully");
    },
    onError: () => toast.error("Failed to update template"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.DocumentSignatureTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documentTemplates"] });
      toast.success("Template deleted successfully");
    },
    onError: () => toast.error("Failed to delete template"),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (template) => {
      const newTemplate = { ...template };
      delete newTemplate.id;
      newTemplate.template_name = `${template.template_name} (Copy)`;
      return base44.entities.DocumentSignatureTemplate.create(newTemplate);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documentTemplates"] });
      toast.success("Template duplicated successfully");
    },
    onError: () => toast.error("Failed to duplicate template"),
  });

  const resetForm = () => {
    setFormData({
      template_name: "",
      description: "",
      document_type: "consent_form",
      category: "",
      content: "",
      placeholders: [],
      signature_fields: [],
      is_shared: false,
    });
    setEditorMode("visual");
  };

  const handleSaveTemplate = () => {
    if (!formData.template_name || !formData.content) {
      toast.error("Please fill in required fields");
      return;
    }

    if (editingTemplate) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEditTemplate = (template) => {
    setEditingTemplate(template);
    setFormData(template);
    setIsCreateDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsCreateDialogOpen(false);
    setEditingTemplate(null);
    resetForm();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="w-6 h-6" />
          Document Templates
        </h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Create Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingTemplate ? "Edit Template" : "Create New Template"}
              </DialogTitle>
            </DialogHeader>

            <Tabs defaultValue="visual">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="visual">Visual Editor</TabsTrigger>
                <TabsTrigger value="basic">Basic Info</TabsTrigger>
              </TabsList>

              <TabsContent value="visual" className="space-y-4">
                <VisualTemplateEditor
                  initialContent={formData.content}
                  onContentChange={(content) =>
                    setFormData({ ...formData, content })
                  }
                  onPlaceholdersChange={(placeholders) =>
                    setFormData({ ...formData, placeholders })
                  }
                  onSignatureFieldsChange={(signatureFields) =>
                    setFormData({ ...formData, signature_fields: signatureFields })
                  }
                  initialPlaceholders={formData.placeholders}
                  initialSignatureFields={formData.signature_fields}
                />
              </TabsContent>

              <TabsContent value="basic" className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Template Name *
                  </label>
                  <Input
                    placeholder="e.g., Patient Consent Form"
                    value={formData.template_name}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        template_name: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Description
                  </label>
                  <Textarea
                    placeholder="Describe when this template is used"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        description: e.target.value,
                      })
                    }
                    className="h-20"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Document Type *
                    </label>
                    <Select
                      value={formData.document_type}
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          document_type: value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="consent_form">Consent Form</SelectItem>
                        <SelectItem value="agreement">Agreement</SelectItem>
                        <SelectItem value="authorization">
                          Authorization
                        </SelectItem>
                        <SelectItem value="disclosure">Disclosure</SelectItem>
                        <SelectItem value="release">Release</SelectItem>
                        <SelectItem value="waiver">Waiver</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Category
                    </label>
                    <Input
                      placeholder="e.g., Telehealth, Pain Management"
                      value={formData.category}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          category: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="shared"
                    checked={formData.is_shared}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        is_shared: e.target.checked,
                      })
                    }
                  />
                  <label htmlFor="shared" className="text-sm">
                    Share with team
                  </label>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleCloseDialog}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveTemplate}
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    {editingTemplate ? "Update" : "Create"} Template
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {templates.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-gray-500">
                No templates yet. Create your first one!
              </p>
            </CardContent>
          </Card>
        ) : (
          templates.map((template) => (
            <Card key={template.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-lg">
                        {template.template_name}
                      </h3>
                      <Badge variant="outline" className="text-xs">
                        {template.document_type.replace(/_/g, " ")}
                      </Badge>
                      {template.is_shared && (
                        <Badge className="bg-blue-100 text-blue-800 text-xs">
                          <Share2 className="w-3 h-3 mr-1" />
                          Shared
                        </Badge>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-sm text-gray-600 mb-2">
                        {template.description}
                      </p>
                    )}
                    {template.category && (
                      <p className="text-xs text-gray-500">
                        Category: {template.category}
                      </p>
                    )}
                    <div className="text-xs text-gray-500 mt-2">
                      {template.placeholders?.length || 0} placeholder(s) •{" "}
                      {template.signature_fields?.length || 0} signature field(s)
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => duplicateMutation.mutate(template)}
                      disabled={duplicateMutation.isPending}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEditTemplate(template)}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        window.confirm("Delete this template?") &&
                        deleteMutation.mutate(template.id)
                      }
                      disabled={deleteMutation.isPending}
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