import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, X, Save, Eye, FileText, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function CustomTemplateEditor({ initialTemplate, onSave, onCancel }) {
  const [template, setTemplate] = useState({
    template_name: "",
    description: "",
    category: "",
    visit_type: "",
    content: "",
    required_elements: [],
    tags: [],
    placeholders: [],
    is_public: false,
    ...initialTemplate
  });

  const [newElement, setNewElement] = useState("");
  const [newTag, setNewTag] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  // Extract placeholders from content
  useEffect(() => {
    const placeholderRegex = /\{\{(\w+)\}\}/g;
    const matches = [...template.content.matchAll(placeholderRegex)];
    const uniquePlaceholders = [...new Set(matches.map(m => m[1]))];
    
    const detectedPlaceholders = uniquePlaceholders.map(key => ({
      key,
      label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      type: 'text'
    }));

    setTemplate(prev => ({ ...prev, placeholders: detectedPlaceholders }));
  }, [template.content]);

  const handleAddElement = () => {
    if (newElement.trim()) {
      setTemplate(prev => ({
        ...prev,
        required_elements: [...prev.required_elements, newElement.trim()]
      }));
      setNewElement("");
    }
  };

  const handleRemoveElement = (index) => {
    setTemplate(prev => ({
      ...prev,
      required_elements: prev.required_elements.filter((_, i) => i !== index)
    }));
  };

  const handleAddTag = () => {
    if (newTag.trim()) {
      setTemplate(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim().toLowerCase()]
      }));
      setNewTag("");
    }
  };

  const handleRemoveTag = (index) => {
    setTemplate(prev => ({
      ...prev,
      tags: prev.tags.filter((_, i) => i !== index)
    }));
  };

  const handleSave = () => {
    if (!template.template_name.trim()) {
      toast.error("Template name is required");
      return;
    }
    if (!template.category) {
      toast.error("Please select a category");
      return;
    }
    if (!template.content.trim()) {
      toast.error("Template content is required");
      return;
    }

    onSave(template);
    toast.success("Template saved successfully!");
  };

  const insertPlaceholder = (placeholder) => {
    const textarea = document.getElementById('template-content');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = template.content;
    const before = text.substring(0, start);
    const after = text.substring(end);
    
    setTemplate(prev => ({
      ...prev,
      content: before + `{{${placeholder}}}` + after
    }));
  };

  const commonPlaceholders = [
    'patient_name', 'visit_date', 'date_of_birth', 'medical_record_number',
    'bp_systolic', 'bp_diastolic', 'heart_rate', 'respiratory_rate', 
    'temperature', 'oxygen_saturation', 'pain_level', 'weight',
    'assessment_findings', 'skilled_interventions', 'patient_response',
    'education_provided', 'plan_of_care', 'nurse_signature', 'datetime'
  ];

  return (
    <div className="space-y-6">
      {/* Info Alert */}
      <Alert>
        <AlertCircle className="w-4 h-4" />
        <AlertDescription>
          Use <code className="bg-gray-200 px-1 rounded">{'{{placeholder_name}}'}</code> syntax to create dynamic fields that can be filled in when using the template.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Editor - 2 columns */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Template Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="name">Template Name *</Label>
                <Input
                  id="name"
                  value={template.template_name}
                  onChange={(e) => setTemplate({ ...template, template_name: e.target.value })}
                  placeholder="E.g., Skilled Nursing Routine Visit"
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={template.description}
                  onChange={(e) => setTemplate({ ...template, description: e.target.value })}
                  placeholder="Brief description of when to use this template"
                  className="mt-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Category *</Label>
                  <Select value={template.category} onValueChange={(value) => setTemplate({ ...template, category: value })}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Select category..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                      <SelectItem value="physical_therapy">Physical Therapy</SelectItem>
                      <SelectItem value="occupational_therapy">Occupational Therapy</SelectItem>
                      <SelectItem value="speech_therapy">Speech Therapy</SelectItem>
                      <SelectItem value="social_work">Social Work</SelectItem>
                      <SelectItem value="care_plan">Care Plan</SelectItem>
                      <SelectItem value="oasis">OASIS Assessment</SelectItem>
                      <SelectItem value="discharge">Discharge</SelectItem>
                      <SelectItem value="admission">Admission</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Visit Type</Label>
                  <Select value={template.visit_type} onValueChange={(value) => setTemplate({ ...template, visit_type: value })}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Select visit type..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admission">Admission</SelectItem>
                      <SelectItem value="routine">Routine</SelectItem>
                      <SelectItem value="recertification">Recertification</SelectItem>
                      <SelectItem value="discharge">Discharge</SelectItem>
                      <SelectItem value="reassessment">Reassessment</SelectItem>
                      <SelectItem value="follow_up">Follow-up</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Template Content *</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowPreview(!showPreview)}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  {showPreview ? 'Hide' : 'Show'} Preview
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Textarea
                id="template-content"
                value={template.content}
                onChange={(e) => setTemplate({ ...template, content: e.target.value })}
                placeholder="Enter your template content. Use {{placeholder_name}} for dynamic fields."
                className="min-h-96 font-mono text-sm"
              />
              
              {showPreview && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
                  <Label className="text-sm font-semibold mb-2 block">Preview:</Label>
                  <pre className="text-sm whitespace-pre-wrap">{template.content}</pre>
                </div>
              )}

              <div className="mt-4">
                <Label className="text-xs text-gray-600">Quick Insert Common Placeholders:</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {commonPlaceholders.map(ph => (
                    <Button
                      key={ph}
                      size="sm"
                      variant="outline"
                      onClick={() => insertPlaceholder(ph)}
                      className="text-xs"
                    >
                      {`{{${ph}}}`}
                    </Button>
                  ))}
                </div>
              </div>

              {template.placeholders.length > 0 && (
                <div className="mt-4">
                  <Label className="text-sm">Detected Placeholders ({template.placeholders.length}):</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {template.placeholders.map((p, idx) => (
                      <Badge key={idx} variant="outline">
                        {`{{${p.key}}}`}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - 1 column */}
        <div className="space-y-4">
          {/* Required Elements */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Required Elements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Add required element..."
                  value={newElement}
                  onChange={(e) => setNewElement(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddElement()}
                  className="flex-1"
                />
                <Button size="icon" onClick={handleAddElement}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-2">
                {template.required_elements.map((elem, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 p-2 bg-gray-50 rounded">
                    <span className="text-sm flex-1">{elem}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveElement(idx)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Tags */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Add tag..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                  className="flex-1"
                />
                <Button size="icon" onClick={handleAddTag}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                {template.tags.map((tag, idx) => (
                  <Badge key={idx} variant="outline" className="pr-1">
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(idx)}
                      className="ml-1 hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <Button onClick={handleSave} className="w-full bg-green-600 hover:bg-green-700">
                <Save className="w-4 h-4 mr-2" />
                Save Template
              </Button>
              {onCancel && (
                <Button onClick={onCancel} variant="outline" className="w-full">
                  Cancel
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}