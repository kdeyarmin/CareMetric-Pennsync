import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, X, Save } from "lucide-react";
import { toast } from "sonner";

const VISIT_TYPES = ["admission", "routine_visit", "recertification", "discharge", "prn"];
const PROVIDER_TYPES = ["RN", "LPN", "NP", "MD", "DO", "PT", "OT", "ST", "MSW", "Chiropractor"];

export default function TemplateEditor() {
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    visit_type: "routine_visit",
    provider_type: "RN",
    description: "",
    diagnosis_tags: [],
    sections: [{ section_name: "", template_text: "", order: 0 }]
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['myTemplates'],
    queryFn: async () => {
      const all = await base44.entities.NoteTemplate.list();
      return all.filter(t => !t.is_system_template);
    }
  });

  const handleAddSection = () => {
    setFormData({
      ...formData,
      sections: [...formData.sections, { section_name: "", template_text: "", order: formData.sections.length }]
    });
  };

  const handleUpdateSection = (idx, field, value) => {
    const newSections = [...formData.sections];
    newSections[idx] = { ...newSections[idx], [field]: value };
    setFormData({ ...formData, sections: newSections });
  };

  const handleRemoveSection = (idx) => {
    setFormData({
      ...formData,
      sections: formData.sections.filter((_, i) => i !== idx)
    });
  };

  const handleSave = async () => {
    if (!formData.name || formData.sections.some(s => !s.section_name)) {
      toast.error("Fill in all required fields");
      return;
    }

    try {
      if (editingId) {
        await base44.entities.NoteTemplate.update(editingId, formData);
        toast.success("Template updated");
      } else {
        await base44.entities.NoteTemplate.create(formData);
        toast.success("Template created");
      }
      queryClient.invalidateQueries({ queryKey: ['myTemplates'] });
      setOpenDialog(false);
      resetForm();
    } catch (error) {
      toast.error("Failed to save template");
    }
  };

  const handleEdit = (template) => {
    setFormData(template);
    setEditingId(template.id);
    setOpenDialog(true);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      visit_type: "routine_visit",
      provider_type: "RN",
      description: "",
      diagnosis_tags: [],
      sections: [{ section_name: "", template_text: "", order: 0 }]
    });
    setEditingId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">My Templates</h2>
        <Button onClick={() => { resetForm(); setOpenDialog(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> New Template
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map(template => (
          <Card key={template.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{template.name}</CardTitle>
              <p className="text-xs text-gray-600">{template.visit_type}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-gray-700">{template.description}</p>
              <p className="text-xs text-gray-500">{template.sections.length} sections</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleEdit(template)}
                className="w-full text-xs"
              >
                Edit
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent className="max-h-96 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium">Template Name</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., CHF Admission"
                className="text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium">Visit Type</label>
                <Select value={formData.visit_type} onValueChange={(v) => setFormData({ ...formData, visit_type: v })}>
                  <SelectTrigger className="text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIT_TYPES.map(vt => (
                      <SelectItem key={vt} value={vt} className="text-sm">{vt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium">Provider Type</label>
                <Select value={formData.provider_type} onValueChange={(v) => setFormData({ ...formData, provider_type: v })}>
                  <SelectTrigger className="text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_TYPES.map(pt => (
                      <SelectItem key={pt} value={pt} className="text-sm">{pt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium">Description</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="When to use this template"
                className="text-sm h-16"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium">Sections</label>
                <Button size="sm" variant="outline" onClick={handleAddSection} className="text-xs h-7">
                  <Plus className="w-3 h-3 mr-1" /> Add Section
                </Button>
              </div>

              <div className="space-y-3 max-h-48 overflow-y-auto">
                {formData.sections.map((section, idx) => (
                  <div key={idx} className="border p-2 rounded space-y-2">
                    <Input
                      value={section.section_name}
                      onChange={(e) => handleUpdateSection(idx, "section_name", e.target.value)}
                      placeholder="Section title (Assessment, Plan, etc.)"
                      className="text-xs h-8"
                    />
                    <Textarea
                      value={section.template_text}
                      onChange={(e) => handleUpdateSection(idx, "template_text", e.target.value)}
                      placeholder="Template text for this section"
                      className="text-xs h-20"
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleRemoveSection(idx)}
                      className="w-full text-xs h-7"
                    >
                      <X className="w-3 h-3 mr-1" /> Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={handleSave} className="w-full gap-2 text-sm">
              <Save className="w-4 h-4" /> Save Template
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}