import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Copy, FileText } from "lucide-react";

export default function AgencyTemplateManager() {
  const queryClient = useQueryClient();
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    visit_type: "",
    content: "",
    required_elements: "",
    tags: ""
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['documentationTemplates'],
    queryFn: () => base44.entities.DocumentationTemplate.list()
  });

  const createTemplateMutation = useMutation({
    mutationFn: (data) => base44.entities.DocumentationTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentationTemplates'] });
      toast.success('Template created successfully');
      resetForm();
    }
  });

  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.DocumentationTemplate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentationTemplates'] });
      toast.success('Template updated successfully');
      resetForm();
    }
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id) => base44.entities.DocumentationTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentationTemplates'] });
      toast.success('Template deleted');
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      category: "",
      visit_type: "",
      content: "",
      required_elements: "",
      tags: ""
    });
    setEditingTemplate(null);
    setShowForm(false);
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      category: template.category,
      visit_type: template.visit_type || "",
      content: template.content,
      required_elements: template.required_elements?.join(', ') || "",
      tags: template.tags?.join(', ') || ""
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    const data = {
      ...formData,
      required_elements: formData.required_elements.split(',').map(s => s.trim()).filter(Boolean),
      tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean)
    };

    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, data });
    } else {
      createTemplateMutation.mutate(data);
    }
  };

  const handleDuplicate = (template) => {
    createTemplateMutation.mutate({
      ...template,
      name: `${template.name} (Copy)`,
      id: undefined,
      created_date: undefined,
      updated_date: undefined
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Agency Templates</h2>
          <p className="text-slate-600">Shared documentation templates for your agency</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          New Template
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingTemplate ? 'Edit Template' : 'Create Template'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Template Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Skilled Nursing Visit Note"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                    <SelectItem value="physical_therapy">Physical Therapy</SelectItem>
                    <SelectItem value="occupational_therapy">Occupational Therapy</SelectItem>
                    <SelectItem value="speech_therapy">Speech Therapy</SelectItem>
                    <SelectItem value="social_work">Social Work</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Visit Type</Label>
                <Select value={formData.visit_type} onValueChange={(v) => setFormData({ ...formData, visit_type: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select visit type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admission">Admission</SelectItem>
                    <SelectItem value="routine">Routine Visit</SelectItem>
                    <SelectItem value="recertification">Recertification</SelectItem>
                    <SelectItem value="discharge">Discharge</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Template Content</Label>
              <Textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Enter template content with placeholders like {{patient_name}}, {{diagnosis}}"
                rows={8}
              />
            </div>

            <div>
              <Label>Required Elements (comma-separated)</Label>
              <Input
                value={formData.required_elements}
                onChange={(e) => setFormData({ ...formData, required_elements: e.target.value })}
                placeholder="e.g., Vital Signs, Assessment, Plan of Care"
              />
            </div>

            <div>
              <Label>Tags (comma-separated)</Label>
              <Input
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="e.g., Medicare, OASIS, Home Health"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!formData.name || !formData.content}>
                {editingTemplate ? 'Update' : 'Create'} Template
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{template.name}</CardTitle>
                  <div className="flex gap-2 mt-2">
                    <Badge>{template.category}</Badge>
                    {template.visit_type && <Badge variant="outline">{template.visit_type}</Badge>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => handleEdit(template)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDuplicate(template)}>
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteTemplateMutation.mutate(template.id)}>
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 line-clamp-3">{template.content}</p>
              {template.tags && template.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {template.tags.map((tag, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}