import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Save, Edit, X } from "lucide-react";
import { toast } from "sonner";

export default function CustomTemplateBuilder({ userEmail, onTemplateCreated }) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  
  const [templateData, setTemplateData] = useState({
    name: "",
    specialty: "",
    sections: [],
    ai_prompt_instructions: "",
    common_icd10_codes: "",
    common_cpt_codes: ""
  });

  const [newSection, setNewSection] = useState("");

  const { data: customTemplates = [] } = useQuery({
    queryKey: ['customTemplates', userEmail],
    queryFn: () => base44.entities.DocumentationTemplate.filter({
      created_by: userEmail
    }),
    enabled: !!userEmail
  });

  const createTemplateMutation = useMutation({
    mutationFn: (data) => base44.entities.DocumentationTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['customTemplates']);
      resetForm();
      toast.success("Template created successfully");
      onTemplateCreated?.();
    }
  });

  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.DocumentationTemplate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['customTemplates']);
      resetForm();
      toast.success("Template updated successfully");
    }
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id) => base44.entities.DocumentationTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['customTemplates']);
      toast.success("Template deleted");
    }
  });

  const resetForm = () => {
    setTemplateData({
      name: "",
      specialty: "",
      sections: [],
      ai_prompt_instructions: "",
      common_icd10_codes: "",
      common_cpt_codes: ""
    });
    setNewSection("");
    setIsCreating(false);
    setEditingTemplate(null);
  };

  const handleAddSection = () => {
    if (newSection.trim()) {
      setTemplateData(prev => ({
        ...prev,
        sections: [...prev.sections, newSection.trim()]
      }));
      setNewSection("");
    }
  };

  const handleRemoveSection = (index) => {
    setTemplateData(prev => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== index)
    }));
  };

  const handleSaveTemplate = () => {
    if (!templateData.name.trim()) {
      toast.error("Template name is required");
      return;
    }

    const saveData = {
      template_name: templateData.name,
      specialty: templateData.specialty || "General",
      sections: templateData.sections,
      ai_instructions: templateData.ai_prompt_instructions,
      common_codes: {
        icd10: templateData.common_icd10_codes.split(",").map(c => c.trim()).filter(Boolean),
        cpt: templateData.common_cpt_codes.split(",").map(c => c.trim()).filter(Boolean)
      },
      is_active: true
    };

    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, data: saveData });
    } else {
      createTemplateMutation.mutate(saveData);
    }
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setTemplateData({
      name: template.template_name,
      specialty: template.specialty || "",
      sections: template.sections || [],
      ai_prompt_instructions: template.ai_instructions || "",
      common_icd10_codes: template.common_codes?.icd10?.join(", ") || "",
      common_cpt_codes: template.common_codes?.cpt?.join(", ") || ""
    });
    setIsCreating(true);
  };

  if (isCreating) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {editingTemplate ? "Edit Template" : "Create Custom Template"}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Template Name *</Label>
            <Input
              value={templateData.name}
              onChange={(e) => setTemplateData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Cardiac Consultation"
            />
          </div>

          <div className="space-y-2">
            <Label>Specialty (optional)</Label>
            <Input
              value={templateData.specialty}
              onChange={(e) => setTemplateData(prev => ({ ...prev, specialty: e.target.value }))}
              placeholder="e.g., Cardiology"
            />
          </div>

          <div className="space-y-2">
            <Label>Sections</Label>
            <div className="flex gap-2">
              <Input
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                placeholder="Add section name"
                onKeyPress={(e) => e.key === "Enter" && handleAddSection()}
              />
              <Button onClick={handleAddSection} size="icon">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {templateData.sections.map((section, idx) => (
                <Badge key={idx} variant="outline" className="flex items-center gap-1">
                  {section}
                  <button
                    onClick={() => handleRemoveSection(idx)}
                    className="ml-1 hover:text-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>AI Prompt Instructions</Label>
            <Textarea
              value={templateData.ai_prompt_instructions}
              onChange={(e) => setTemplateData(prev => ({ ...prev, ai_prompt_instructions: e.target.value }))}
              placeholder="Describe what the AI should focus on when using this template..."
              className="min-h-20"
            />
          </div>

          <div className="space-y-2">
            <Label>Common ICD-10 Codes (comma separated)</Label>
            <Input
              value={templateData.common_icd10_codes}
              onChange={(e) => setTemplateData(prev => ({ ...prev, common_icd10_codes: e.target.value }))}
              placeholder="e.g., I25.10, I50.9, I48.91"
            />
          </div>

          <div className="space-y-2">
            <Label>Common CPT Codes (comma separated)</Label>
            <Input
              value={templateData.common_cpt_codes}
              onChange={(e) => setTemplateData(prev => ({ ...prev, common_cpt_codes: e.target.value }))}
              placeholder="e.g., 93000, 93306, 99244"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSaveTemplate} className="flex-1">
              <Save className="w-4 h-4 mr-2" />
              Save Template
            </Button>
            <Button onClick={resetForm} variant="outline">
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">My Custom Templates</CardTitle>
          <Button onClick={() => setIsCreating(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            New Template
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {customTemplates.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">No custom templates yet.</p>
            <p className="text-xs mt-1">Create your first template to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {customTemplates.map((template) => (
              <div
                key={template.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <div>
                  <p className="font-medium text-sm">{template.template_name}</p>
                  {template.specialty && (
                    <p className="text-xs text-gray-600">{template.specialty}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    {template.sections?.length || 0} sections
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleEdit(template)}
                  >
                    <Edit className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Delete this template?")) {
                        deleteTemplateMutation.mutate(template.id);
                      }
                    }}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}