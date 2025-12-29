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
import { Plus, Edit, Trash2, GripVertical, BarChart, PieChart, Table as TableIcon, FileText, Save, Eye } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { toast } from "sonner";

export default function ReportTemplateBuilder() {
  const [showDialog, setShowDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    report_type: "custom",
    sections: [],
    styling: {
      theme: "default",
      colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"],
      fonts: {}
    },
    is_public: false
  });

  const queryClient = useQueryClient();

  const { data: templates = [] } = useQuery({
    queryKey: ['reportTemplates'],
    queryFn: () => base44.entities.ReportTemplate.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ReportTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportTemplates'] });
      setShowDialog(false);
      resetForm();
      toast.success("Template created");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ReportTemplate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportTemplates'] });
      setShowDialog(false);
      resetForm();
      toast.success("Template updated");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ReportTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportTemplates'] });
      toast.success("Template deleted");
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      report_type: "custom",
      sections: [],
      styling: {
        theme: "default",
        colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"],
        fonts: {}
      },
      is_public: false
    });
    setEditingTemplate(null);
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setFormData(template);
    setShowDialog(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const addSection = () => {
    const newSection = {
      id: `section-${Date.now()}`,
      title: "New Section",
      type: "table",
      data_source: "patients",
      visualization: "table",
      filters: {},
      order: formData.sections.length
    };
    setFormData({
      ...formData,
      sections: [...formData.sections, newSection]
    });
  };

  const updateSection = (id, updates) => {
    setFormData({
      ...formData,
      sections: formData.sections.map(s => s.id === id ? { ...s, ...updates } : s)
    });
  };

  const removeSection = (id) => {
    setFormData({
      ...formData,
      sections: formData.sections.filter(s => s.id !== id)
    });
  };

  const onDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(formData.sections);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    // Update order
    const updatedItems = items.map((item, index) => ({ ...item, order: index }));

    setFormData({
      ...formData,
      sections: updatedItems
    });
  };

  const getSectionIcon = (type) => {
    switch (type) {
      case 'chart': return BarChart;
      case 'table': return TableIcon;
      case 'text': return FileText;
      case 'metrics': return PieChart;
      default: return FileText;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Report Template Builder</h2>
          <p className="text-gray-600">Create custom report templates with drag-and-drop interface</p>
        </div>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setShowDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              New Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTemplate ? 'Edit Template' : 'Create New Template'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Template Name</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label>Report Type</Label>
                  <Select value={formData.report_type} onValueChange={(v) => setFormData({ ...formData, report_type: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="compliance">Compliance</SelectItem>
                      <SelectItem value="performance">Performance</SelectItem>
                      <SelectItem value="analytics">Analytics</SelectItem>
                      <SelectItem value="patient_outcomes">Patient Outcomes</SelectItem>
                      <SelectItem value="financial">Financial</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-4">
                  <Label className="text-base">Report Sections</Label>
                  <Button type="button" size="sm" onClick={addSection}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Section
                  </Button>
                </div>

                <DragDropContext onDragEnd={onDragEnd}>
                  <Droppable droppableId="sections">
                    {(provided) => (
                      <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                        {formData.sections.map((section, index) => {
                          const Icon = getSectionIcon(section.type);
                          return (
                            <Draggable key={section.id} draggableId={section.id} index={index}>
                              {(provided) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className="bg-gray-50 border rounded-lg p-4"
                                >
                                  <div className="flex items-center gap-3">
                                    <div {...provided.dragHandleProps}>
                                      <GripVertical className="w-5 h-5 text-gray-400" />
                                    </div>
                                    <Icon className="w-5 h-5 text-blue-600" />
                                    <div className="flex-1 grid grid-cols-3 gap-3">
                                      <Input
                                        value={section.title}
                                        onChange={(e) => updateSection(section.id, { title: e.target.value })}
                                        placeholder="Section title"
                                      />
                                      <Select value={section.type} onValueChange={(v) => updateSection(section.id, { type: v })}>
                                        <SelectTrigger>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="chart">Chart</SelectItem>
                                          <SelectItem value="table">Table</SelectItem>
                                          <SelectItem value="text">Text</SelectItem>
                                          <SelectItem value="metrics">Metrics</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      <Select value={section.data_source} onValueChange={(v) => updateSection(section.id, { data_source: v })}>
                                        <SelectTrigger>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="patients">Patients</SelectItem>
                                          <SelectItem value="visits">Visits</SelectItem>
                                          <SelectItem value="care_plans">Care Plans</SelectItem>
                                          <SelectItem value="compliance">Compliance</SelectItem>
                                          <SelectItem value="outcomes">Outcomes</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => removeSection(section.id)}
                                    >
                                      <Trash2 className="w-4 h-4 text-red-600" />
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  <Save className="w-4 h-4 mr-2" />
                  {editingTemplate ? 'Update' : 'Create'} Template
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((template) => (
          <Card key={template.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg">{template.name}</CardTitle>
                  <Badge className="mt-2">{template.report_type}</Badge>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(template)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm('Delete this template?')) {
                        deleteMutation.mutate(template.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-3">{template.description}</p>
              <div className="text-sm text-gray-500">
                <span>{template.sections?.length || 0} sections</span>
                {template.is_public && (
                  <Badge variant="outline" className="ml-2">Public</Badge>
                )}
              </div>
              <div className="mt-3 text-xs text-gray-400">
                Used {template.usage_count || 0} times
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}