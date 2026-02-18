import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, GripVertical, Save, X, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

const VISIT_TYPES = [
  { id: "admission", label: "Admission/SOC" },
  { id: "routine_visit", label: "Routine Visit" },
  { id: "recertification", label: "Recertification" },
  { id: "discharge", label: "Discharge" },
  { id: "prn", label: "PRN Visit" },
];

const PROVIDER_TYPES = ["RN", "LPN", "NP", "MD", "DO", "PT", "OT", "ST", "MSW"];

const DEFAULT_SECTIONS = [
  { section_name: "Subjective / Patient Report", template_text: "", order: 1 },
  { section_name: "Objective / Assessment Findings", template_text: "", order: 2 },
  { section_name: "Vital Signs", template_text: "", order: 3 },
  { section_name: "Plan of Care", template_text: "", order: 4 },
];

export default function CustomTemplateCreator({ onClose, onSaved, initialData, visitType, providerType, diagnosis }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [aiPopulating, setAiPopulating] = useState(false);

  const [template, setTemplate] = useState({
    name: initialData?.template_name || initialData?.name || "",
    description: initialData?.description || "",
    visit_type: initialData?.visit_type || visitType || "",
    provider_type: initialData?.provider_type || providerType || "",
    diagnosis_tags: initialData?.diagnosis_tags || (diagnosis ? [diagnosis.split(" - ")[0]] : []),
    sections: initialData?.sections || [...DEFAULT_SECTIONS],
    is_system_template: false,
    is_favorite: false,
  });

  const [newTag, setNewTag] = useState("");

  const addSection = () => {
    setTemplate({
      ...template,
      sections: [...template.sections, { section_name: "", template_text: "", order: template.sections.length + 1 }],
    });
  };

  const removeSection = (index) => {
    setTemplate({ ...template, sections: template.sections.filter((_, i) => i !== index) });
  };

  const updateSection = (index, field, value) => {
    const updated = [...template.sections];
    updated[index] = { ...updated[index], [field]: value };
    setTemplate({ ...template, sections: updated });
  };

  const addTag = () => {
    if (newTag.trim() && !template.diagnosis_tags.includes(newTag.trim())) {
      setTemplate({ ...template, diagnosis_tags: [...template.diagnosis_tags, newTag.trim()] });
      setNewTag("");
    }
  };

  const removeTag = (tag) => {
    setTemplate({ ...template, diagnosis_tags: template.diagnosis_tags.filter((t) => t !== tag) });
  };

  const aiPopulateSections = async () => {
    if (!template.visit_type || !template.provider_type) {
      toast.error("Select visit type and provider type first");
      return;
    }
    setAiPopulating(true);
    try {
      const diagContext = template.diagnosis_tags.length > 0 ? `Diagnosis context: ${template.diagnosis_tags.join(", ")}` : "";
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate clinical documentation template content for home health/hospice nursing.

Visit Type: ${template.visit_type}
Provider Type: ${template.provider_type}
${diagContext}

For each of these sections, provide realistic placeholder/guide text that helps a nurse document properly. The text should include specific prompts, checkboxes-style items, and Medicare-compliant documentation cues.

Sections to populate:
${template.sections.map((s, i) => `${i + 1}. ${s.section_name}`).join("\n")}

Make the text practical and diagnosis-specific where possible. Include measurement prompts, assessment scales, and clinical decision points.`,
        response_json_schema: {
          type: "object",
          properties: {
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  section_name: { type: "string" },
                  template_text: { type: "string" },
                },
              },
            },
          },
        },
      });

      if (result?.sections) {
        const updated = template.sections.map((s, i) => {
          const aiSection = result.sections.find((a) => a.section_name === s.section_name) || result.sections[i];
          return { ...s, template_text: aiSection?.template_text || s.template_text };
        });
        setTemplate({ ...template, sections: updated });
        toast.success("AI populated section content");
      }
    } catch (err) {
      console.error("AI populate error:", err);
      toast.error("Failed to populate sections");
    } finally {
      setAiPopulating(false);
    }
  };

  const saveTemplate = async () => {
    if (!template.name.trim()) { toast.error("Template name required"); return; }
    if (!template.visit_type) { toast.error("Visit type required"); return; }
    if (!template.provider_type) { toast.error("Provider type required"); return; }
    if (template.sections.length === 0 || !template.sections[0].section_name) { toast.error("At least one section required"); return; }

    setSaving(true);
    try {
      const data = {
        name: template.name.trim(),
        description: template.description.trim(),
        visit_type: template.visit_type,
        provider_type: template.provider_type,
        diagnosis_tags: template.diagnosis_tags,
        sections: template.sections.map((s, i) => ({ ...s, order: i + 1 })),
        is_system_template: false,
        is_favorite: template.is_favorite,
      };

      await base44.entities.NoteTemplate.create(data);
      queryClient.invalidateQueries({ queryKey: ["noteTemplates"] });
      toast.success("Custom template saved! AI will use it for future suggestions.");
      onSaved?.(data);
      onClose?.();
    } catch (err) {
      console.error("Save template error:", err);
      toast.error("Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="sticky top-0 bg-white z-10 border-b p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <Plus className="w-4 h-4" />
              {initialData ? "Save AI Template as Custom" : "Create Custom Template"}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 space-y-4">
          {/* Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Template Name *</Label>
              <Input value={template.name} onChange={(e) => setTemplate({ ...template, name: e.target.value })} placeholder="e.g., CHF Routine Visit" className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input value={template.description} onChange={(e) => setTemplate({ ...template, description: e.target.value })} placeholder="When to use this template" className="h-9 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Visit Type *</Label>
              <Select value={template.visit_type} onValueChange={(v) => setTemplate({ ...template, visit_type: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {VISIT_TYPES.map((vt) => <SelectItem key={vt.id} value={vt.id}>{vt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Provider Type *</Label>
              <Select value={template.provider_type} onValueChange={(v) => setTemplate({ ...template, provider_type: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {PROVIDER_TYPES.map((pt) => <SelectItem key={pt} value={pt}>{pt}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Diagnosis Tags */}
          <div>
            <Label className="text-xs">Diagnosis Tags (helps AI match this template)</Label>
            <div className="flex gap-1 flex-wrap mb-2">
              {template.diagnosis_tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs gap-1">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="text-red-400 hover:text-red-600">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="e.g., CHF, COPD, Wound Care" className="h-8 text-xs flex-1" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
              <Button size="sm" variant="outline" onClick={addTag} className="h-8 text-xs">Add</Button>
            </div>
          </div>

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold">Template Sections</Label>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={aiPopulateSections} disabled={aiPopulating} className="h-7 text-[10px] gap-1">
                  {aiPopulating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  AI Fill Content
                </Button>
                <Button size="sm" variant="outline" onClick={addSection} className="h-7 text-[10px]">
                  <Plus className="w-3 h-3 mr-0.5" /> Section
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {template.sections.map((section, idx) => (
                <Card key={idx} className="bg-slate-50">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <Input
                        value={section.section_name}
                        onChange={(e) => updateSection(idx, "section_name", e.target.value)}
                        placeholder="Section name (e.g., Assessment Findings)"
                        className="h-8 text-xs flex-1"
                      />
                      <Button size="sm" variant="ghost" onClick={() => removeSection(idx)} className="h-7 w-7 p-0 text-red-400 hover:text-red-600">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <Textarea
                      value={section.template_text}
                      onChange={(e) => updateSection(idx, "template_text", e.target.value)}
                      placeholder="Template content / guide text for this section..."
                      className="text-xs min-h-[60px]"
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 sticky bottom-0 bg-white border-t -mx-3 sm:-mx-4 px-3 sm:px-4 py-3">
            <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button onClick={saveTemplate} disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Save Template
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}