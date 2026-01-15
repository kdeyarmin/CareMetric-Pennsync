import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileText,
  Plus,
  Star,
  StarOff,
  Pencil,
  Trash2,
  Search,
  Filter,
  X,
  Save,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { toast } from "sonner";
import { getVisitTypesForProvider } from "@/components/utils/providerVisitTypeMapping";

export default function TemplateLibrary() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterVisitType, setFilterVisitType] = useState("all");
  const [filterProviderType, setFilterProviderType] = useState("all");
  const [filterDiagnosis, setFilterDiagnosis] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [expandedTemplate, setExpandedTemplate] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    visit_type: "",
    provider_type: "",
    diagnosis_tags: [],
    description: "",
    sections: []
  });
  const [newSection, setNewSection] = useState({ section_name: "", template_text: "", order: 1 });
  const [newDiagnosisTag, setNewDiagnosisTag] = useState("");

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["noteTemplates"],
    queryFn: async () => {
      return await base44.entities.NoteTemplate.list('-updated_date', 500);
    }
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ id, isFavorite }) => {
      return await base44.entities.NoteTemplate.update(id, { is_favorite: !isFavorite });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["noteTemplates"] });
      toast.success("Favorite updated");
    }
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.NoteTemplate.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["noteTemplates"] });
      toast.success("Template deleted");
    }
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async (data) => {
      if (editingTemplate) {
        return await base44.entities.NoteTemplate.update(editingTemplate.id, data);
      } else {
        return await base44.entities.NoteTemplate.create({
          ...data,
          is_system_template: false,
          is_favorite: false
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["noteTemplates"] });
      toast.success(editingTemplate ? "Template updated" : "Template created");
      resetForm();
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      visit_type: "",
      provider_type: "",
      diagnosis_tags: [],
      description: "",
      sections: []
    });
    setEditingTemplate(null);
    setShowCreateDialog(false);
  };

  const handleEdit = (template) => {
    if (template.is_system_template) {
      toast.error("Cannot edit system templates. Create a copy instead.");
      return;
    }
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      visit_type: template.visit_type,
      provider_type: template.provider_type,
      diagnosis_tags: template.diagnosis_tags || [],
      description: template.description || "",
      sections: template.sections || []
    });
    setShowCreateDialog(true);
  };

  const handleDelete = (template) => {
    if (template.is_system_template) {
      toast.error("Cannot delete system templates");
      return;
    }
    if (confirm(`Delete template "${template.name}"?`)) {
      deleteTemplateMutation.mutate(template.id);
    }
  };

  const handleSave = () => {
    if (!formData.name || !formData.visit_type || !formData.provider_type) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (formData.sections.length === 0) {
      toast.error("Please add at least one section");
      return;
    }
    saveTemplateMutation.mutate(formData);
  };

  const addSection = () => {
    if (!newSection.section_name || !newSection.template_text) {
      toast.error("Section name and text are required");
      return;
    }
    setFormData({
      ...formData,
      sections: [...formData.sections, { ...newSection, order: formData.sections.length + 1 }]
    });
    setNewSection({ section_name: "", template_text: "", order: 1 });
  };

  const removeSection = (index) => {
    setFormData({
      ...formData,
      sections: formData.sections.filter((_, i) => i !== index)
    });
  };

  const addDiagnosisTag = () => {
    if (newDiagnosisTag.trim() && !formData.diagnosis_tags.includes(newDiagnosisTag.trim())) {
      setFormData({
        ...formData,
        diagnosis_tags: [...formData.diagnosis_tags, newDiagnosisTag.trim()]
      });
      setNewDiagnosisTag("");
    }
  };

  const removeDiagnosisTag = (tag) => {
    setFormData({
      ...formData,
      diagnosis_tags: formData.diagnosis_tags.filter(t => t !== tag)
    });
  };

  // Filter templates
  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesVisitType = filterVisitType === "all" || template.visit_type === filterVisitType;
    const matchesProviderType = filterProviderType === "all" || template.provider_type === filterProviderType;
    const matchesDiagnosis = filterDiagnosis === "all" || 
                             template.diagnosis_tags?.includes(filterDiagnosis);
    return matchesSearch && matchesVisitType && matchesProviderType && matchesDiagnosis;
  });

  const favoriteTemplates = filteredTemplates.filter(t => t.is_favorite);
  const systemTemplates = filteredTemplates.filter(t => t.is_system_template && !t.is_favorite);
  const userTemplates = filteredTemplates.filter(t => !t.is_system_template && !t.is_favorite);

  // Get unique values for filters
  const allVisitTypes = [...new Set(templates.map(t => t.visit_type))];
  const allProviderTypes = [...new Set(templates.map(t => t.provider_type))];
  const allDiagnosisTags = [...new Set(templates.flatMap(t => t.diagnosis_tags || []))];

  const providerTypes = ["RN", "LPN", "NP", "PHYSICIAN", "THERAPIST", "MSW", "Chiropractor"];
  const visitTypes = ["admission", "routine", "recertification", "discharge", "prn", "initial_evaluation", 
                      "follow_up", "urgent_care", "preventive", "synchronous", "asynchronous"];

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Template Library</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Manage clinical note templates for faster documentation
            </p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4 mr-2" />
            Create Template
          </Button>
        </div>

        {/* Search and Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search templates..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <Select value={filterVisitType} onValueChange={setFilterVisitType}>
                <SelectTrigger>
                  <SelectValue placeholder="Visit Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Visit Types</SelectItem>
                  {visitTypes.map(vt => (
                    <SelectItem key={vt} value={vt}>{vt.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterProviderType} onValueChange={setFilterProviderType}>
                <SelectTrigger>
                  <SelectValue placeholder="Provider Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Provider Types</SelectItem>
                  {providerTypes.map(pt => (
                    <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {allDiagnosisTags.length > 0 && (
              <div className="mt-4">
                <Label className="text-xs mb-2 block">Filter by Diagnosis Tag:</Label>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant={filterDiagnosis === "all" ? "default" : "outline"}
                    onClick={() => setFilterDiagnosis("all")}
                  >
                    All
                  </Button>
                  {allDiagnosisTags.map(tag => (
                    <Button
                      key={tag}
                      size="sm"
                      variant={filterDiagnosis === tag ? "default" : "outline"}
                      onClick={() => setFilterDiagnosis(tag)}
                    >
                      {tag}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Favorites */}
        {favoriteTemplates.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
              Favorites ({favoriteTemplates.length})
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {favoriteTemplates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onToggleFavorite={() => toggleFavoriteMutation.mutate({ id: template.id, isFavorite: template.is_favorite })}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  expanded={expandedTemplate === template.id}
                  onToggleExpand={() => setExpandedTemplate(expandedTemplate === template.id ? null : template.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* System Templates */}
        {systemTemplates.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">System Templates ({systemTemplates.length})</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {systemTemplates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onToggleFavorite={() => toggleFavoriteMutation.mutate({ id: template.id, isFavorite: template.is_favorite })}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  expanded={expandedTemplate === template.id}
                  onToggleExpand={() => setExpandedTemplate(expandedTemplate === template.id ? null : template.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* User Templates */}
        {userTemplates.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">My Templates ({userTemplates.length})</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {userTemplates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onToggleFavorite={() => toggleFavoriteMutation.mutate({ id: template.id, isFavorite: template.is_favorite })}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  expanded={expandedTemplate === template.id}
                  onToggleExpand={() => setExpandedTemplate(expandedTemplate === template.id ? null : template.id)}
                />
              ))}
            </div>
          </div>
        )}

        {filteredTemplates.length === 0 && !isLoading && (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 mx-auto text-slate-400 mb-4" />
              <p className="text-slate-600 dark:text-slate-400">No templates found</p>
              <Button onClick={() => setShowCreateDialog(true)} className="mt-4">
                Create Your First Template
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Create/Edit Dialog */}
        {showCreateDialog && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{editingTemplate ? "Edit Template" : "Create New Template"}</CardTitle>
                  <Button size="icon" variant="ghost" onClick={resetForm}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Basic Info */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Template Name *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., RN Routine Follow-up"
                    />
                  </div>
                  <div>
                    <Label>Visit Type *</Label>
                    <Select value={formData.visit_type} onValueChange={(val) => setFormData({ ...formData, visit_type: val })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select visit type" />
                      </SelectTrigger>
                      <SelectContent>
                        {visitTypes.map(vt => (
                          <SelectItem key={vt} value={vt}>{vt.replace(/_/g, ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Provider Type *</Label>
                  <Select value={formData.provider_type} onValueChange={(val) => setFormData({ ...formData, provider_type: val })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select provider type" />
                    </SelectTrigger>
                    <SelectContent>
                      {providerTypes.map(pt => (
                        <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Brief description of when to use this template..."
                    className="h-20"
                  />
                </div>

                {/* Diagnosis Tags */}
                <div>
                  <Label>Diagnosis Tags</Label>
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={newDiagnosisTag}
                      onChange={(e) => setNewDiagnosisTag(e.target.value)}
                      placeholder="e.g., CHF, COPD"
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addDiagnosisTag())}
                    />
                    <Button type="button" onClick={addDiagnosisTag}>Add</Button>
                  </div>
                  {formData.diagnosis_tags.length > 0 && (
                    <div className="flex gap-2 flex-wrap mt-2">
                      {formData.diagnosis_tags.map(tag => (
                        <Badge key={tag} variant="outline" className="gap-1">
                          {tag}
                          <X className="w-3 h-3 cursor-pointer" onClick={() => removeDiagnosisTag(tag)} />
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Sections */}
                <div>
                  <Label>Template Sections *</Label>
                  {formData.sections.map((section, idx) => (
                    <Card key={idx} className="mt-2 bg-slate-50 dark:bg-slate-900">
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-medium text-sm">{section.section_name}</h4>
                          <Button size="icon" variant="ghost" onClick={() => removeSection(idx)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                          {section.template_text}
                        </p>
                      </CardContent>
                    </Card>
                  ))}

                  {/* Add New Section */}
                  <Card className="mt-4 border-dashed">
                    <CardContent className="pt-4 space-y-3">
                      <Input
                        placeholder="Section Name (e.g., Vital Signs)"
                        value={newSection.section_name}
                        onChange={(e) => setNewSection({ ...newSection, section_name: e.target.value })}
                      />
                      <Textarea
                        placeholder="Section template text..."
                        value={newSection.template_text}
                        onChange={(e) => setNewSection({ ...newSection, template_text: e.target.value })}
                        className="h-24"
                      />
                      <Button type="button" onClick={addSection} variant="outline" className="w-full">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Section
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4">
                  <Button variant="outline" className="flex-1" onClick={resetForm}>
                    Cancel
                  </Button>
                  <Button className="flex-1" onClick={handleSave} disabled={saveTemplateMutation.isPending}>
                    <Save className="w-4 h-4 mr-2" />
                    {editingTemplate ? "Update" : "Create"} Template
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateCard({ template, onToggleFavorite, onEdit, onDelete, expanded, onToggleExpand }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-base flex items-center gap-2">
              {template.name}
              {template.is_system_template && (
                <Badge variant="outline" className="text-xs">System</Badge>
              )}
            </CardTitle>
            {template.description && (
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{template.description}</p>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onToggleFavorite}
            className="flex-shrink-0"
          >
            {template.is_favorite ? (
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
            ) : (
              <StarOff className="w-4 h-4 text-slate-400" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline">{template.visit_type?.replace(/_/g, ' ')}</Badge>
          <Badge variant="outline">{template.provider_type}</Badge>
        </div>

        {template.diagnosis_tags?.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {template.diagnosis_tags.map(tag => (
              <Badge key={tag} className="text-xs bg-indigo-100 text-indigo-800">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <div className="text-xs text-slate-600 dark:text-slate-400">
          {template.sections?.length || 0} sections
        </div>

        {expanded && (
          <div className="space-y-2 pt-2 border-t">
            {template.sections?.map((section, idx) => (
              <div key={idx} className="text-xs">
                <div className="font-medium text-slate-900 dark:text-slate-100">{section.section_name}</div>
                <div className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap mt-1 line-clamp-3">
                  {section.template_text}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={onToggleExpand} className="flex-1">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          {!template.is_system_template && (
            <>
              <Button size="sm" variant="outline" onClick={() => onEdit(template)}>
                <Pencil className="w-3 h-3" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDelete(template)}>
                <Trash2 className="w-3 h-3 text-red-500" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}