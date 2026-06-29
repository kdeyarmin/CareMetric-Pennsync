import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, BookOpen, TrendingUp, Globe, User, Sparkles, BarChart3, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import ClinicalLibraryAIAssistant from "./ClinicalLibraryAIAssistant";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ClinicalLibraryAnalytics from "./ClinicalLibraryAnalytics";
import FolderTreeView from "./FolderTreeView";
import ClinicalLibraryIntro from "./ClinicalLibraryIntro";

export default function ClinicalLibraryManager() {
  const confirm = useConfirm();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [aiMode, setAIMode] = useState('generate'); // 'generate', 'improve', 'refine'
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState(new Set());
  const [formData, setFormData] = useState({
    phrase: '',
    category: 'education',
    template_type: 'generic',
    expanded_text: '',
    ai_prompt_instructions: '',
    requires_patient_data: false,
    patient_data_fields: [],
    is_agency_wide: false,
    folder_id: null
  });

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['clinical-templates'],
    queryFn: () => base44.entities.ClinicalLibraryTemplate.list('-usage_count', 200),
    initialData: []
  });

  const { data: folders = [] } = useQuery({
    queryKey: ['clinical-folders'],
    queryFn: () => base44.entities.ClinicalLibraryFolder.list('order', 200),
    initialData: []
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ClinicalLibraryTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinical-templates'] });
      toast.success('Template created successfully');
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ClinicalLibraryTemplate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinical-templates'] });
      toast.success('Template updated successfully');
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ClinicalLibraryTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinical-templates'] });
      toast.success('Template deleted');
    }
  });

  const createFolderMutation = useMutation({
    mutationFn: (data) => base44.entities.ClinicalLibraryFolder.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinical-folders'] });
      toast.success('Folder created');
    }
  });

  const updateFolderMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ClinicalLibraryFolder.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinical-folders'] });
      toast.success('Folder updated');
    }
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id) => base44.entities.ClinicalLibraryFolder.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinical-folders'] });
      toast.success('Folder deleted');
    }
  });

  const resetForm = () => {
    setFormData({
      phrase: '',
      category: 'education',
      template_type: 'generic',
      expanded_text: '',
      ai_prompt_instructions: '',
      requires_patient_data: false,
      patient_data_fields: [],
      is_agency_wide: false,
      folder_id: selectedFolderId
    });
    setEditingTemplate(null);
    setIsDialogOpen(false);
    setShowAIAssistant(false);
    setAIMode('generate');
  };

  const handleAISuggestion = (suggestion) => {
    setFormData({
      ...formData,
      phrase: suggestion.phrase || formData.phrase,
      category: suggestion.category || formData.category,
      template_type: suggestion.template_type || formData.template_type,
      expanded_text: suggestion.expanded_text || formData.expanded_text,
      ai_prompt_instructions: suggestion.ai_prompt_instructions || formData.ai_prompt_instructions,
      patient_data_fields: suggestion.patient_data_fields || formData.patient_data_fields,
      requires_patient_data: suggestion.template_type === 'patient_specific'
    });
    setShowAIAssistant(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const payload = {
      ...formData,
      phrase: formData.phrase.toLowerCase().trim(),
      created_by: currentUser?.email
    };

    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setFormData({
      phrase: template.phrase,
      category: template.category,
      template_type: template.template_type,
      expanded_text: template.expanded_text || '',
      ai_prompt_instructions: template.ai_prompt_instructions || '',
      requires_patient_data: template.requires_patient_data || false,
      patient_data_fields: template.patient_data_fields || [],
      is_agency_wide: template.is_agency_wide || false,
      folder_id: template.folder_id || null
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (await confirm({ title: "Delete template?", description: "Are you sure you want to delete this template?", confirmText: "Delete", destructive: true })) {
      deleteMutation.mutate(id);
    }
  };

  const handleCreateFolder = () => {
    const name = prompt('Enter folder name:');
    if (name?.trim()) {
      createFolderMutation.mutate({
        name: name.trim(),
        parent_folder_id: selectedFolderId,
        created_by: currentUser?.email,
        color: 'blue'
      });
    }
  };

  const handleRenameFolder = (folderId, newName) => {
    updateFolderMutation.mutate({ id: folderId, data: { name: newName } });
  };

  const handleDeleteFolder = async (folderId) => {
    const templatesInFolder = templates.filter(t => t.folder_id === folderId);
    if (templatesInFolder.length > 0) {
      if (!(await confirm({ title: "Delete folder?", description: `This folder contains ${templatesInFolder.length} template(s). Delete anyway? Templates will be moved to uncategorized.`, confirmText: "Delete anyway", destructive: true }))) {
        return;
      }
      // Move templates to uncategorized
      templatesInFolder.forEach(t => {
        updateMutation.mutate({ id: t.id, data: { folder_id: null } });
      });
      deleteFolderMutation.mutate(folderId);
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
      return;
    }
    if (await confirm({ title: "Delete folder?", description: "Delete this folder?", confirmText: "Delete", destructive: true })) {
      deleteFolderMutation.mutate(folderId);
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
    }
  };

  const handleChangeColor = (folderId, color) => {
    updateFolderMutation.mutate({ id: folderId, data: { color } });
  };

  const handleMoveTemplate = (templateId, newFolderId) => {
    updateMutation.mutate({ 
      id: templateId, 
      data: { folder_id: newFolderId } 
    });
  };

  const handleBulkMove = (folderId) => {
    const idsToMove = Array.from(selectedTemplateIds);
    idsToMove.forEach(id => {
      updateMutation.mutate({ id, data: { folder_id: folderId === "__uncategorized__" ? null : folderId } });
    });
    setSelectedTemplateIds(new Set());
    toast.success(`Moved ${idsToMove.length} template(s)`);
  };

  const toggleTemplateSelection = (templateId) => {
    const newSelection = new Set(selectedTemplateIds);
    if (newSelection.has(templateId)) {
      newSelection.delete(templateId);
    } else {
      newSelection.add(templateId);
    }
    setSelectedTemplateIds(newSelection);
  };

  const selectAllTemplates = () => {
    setSelectedTemplateIds(new Set(filteredTemplates.map(t => t.id)));
  };

  const clearSelection = () => {
    setSelectedTemplateIds(new Set());
  };

  const isAdmin = currentUser?.role === 'admin';
  const userTemplates = templates.filter(t => t.created_by === currentUser?.email || t.is_agency_wide);
  const userFolders = folders.filter(f => f.created_by === currentUser?.email || f.is_agency_wide);

  const filteredTemplates = useMemo(() => {
    if (selectedFolderId === null) {
      return userTemplates;
    }
    return userTemplates.filter(t => t.folder_id === selectedFolderId);
  }, [userTemplates, selectedFolderId]);

  const templatesCount = useMemo(() => {
    const counts = { uncategorized: userTemplates.filter(t => !t.folder_id).length };
    userFolders.forEach(folder => {
      counts[folder.id] = userTemplates.filter(t => t.folder_id === folder.id).length;
    });
    return counts;
  }, [userTemplates, userFolders]);

  return (
    <Tabs defaultValue="templates" className="space-y-4">
      <TabsList>
        <TabsTrigger value="templates">
          <BookOpen className="w-4 h-4 mr-2" />
          Templates
        </TabsTrigger>
        <TabsTrigger value="analytics">
          <BarChart3 className="w-4 h-4 mr-2" />
          Analytics
        </TabsTrigger>
      </TabsList>

      <TabsContent value="templates" className="space-y-6">
      <ClinicalLibraryIntro isAdmin={isAdmin} />
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Sidebar */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Organization</CardTitle>
          </CardHeader>
          <CardContent>
            <FolderTreeView
              folders={userFolders}
              selectedFolderId={selectedFolderId}
              onSelectFolder={setSelectedFolderId}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onChangeColor={handleChangeColor}
              templatesCount={templatesCount}
            />
          </CardContent>
        </Card>

        {/* Main Content */}
        <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {selectedFolderId ? (
                <>
                  <FolderOpen className="w-5 h-5" />
                  {userFolders.find(f => f.id === selectedFolderId)?.name || 'Folder'}
                </>
              ) : (
                <>
                  <BookOpen className="w-5 h-5" />
                  All Templates
                </>
              )}
            </CardTitle>
            <p className="text-sm text-slate-600 mt-1">
              {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Button onClick={() => {
            setFormData({ ...formData, folder_id: selectedFolderId });
            setIsDialogOpen(true);
          }}>
            <Plus className="w-4 h-4 mr-2" />
            New Template
          </Button>
        </CardHeader>
        <CardContent>
          {selectedTemplateIds.size > 0 && (
            <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-indigo-900">
                  {selectedTemplateIds.size} selected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearSelection}
                  className="h-7"
                >
                  Clear
                </Button>
              </div>
              <Select onValueChange={handleBulkMove}>
                <SelectTrigger className="w-48 h-8 text-sm">
                  <SelectValue placeholder="Move to folder..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__uncategorized__">Uncategorized</SelectItem>
                  {userFolders.map(folder => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {filteredTemplates.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectedTemplateIds.size === filteredTemplates.length ? clearSelection : selectAllTemplates}
                className="h-7 text-xs"
              >
                {selectedTemplateIds.size === filteredTemplates.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
          )}

          <div className="space-y-3">
            {filteredTemplates.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <BookOpen className="w-12 h-12 mx-auto mb-3 text-slate-400" />
                <p>No templates in this {selectedFolderId ? 'folder' : 'view'}. Create your first one!</p>
              </div>
            ) : (
              filteredTemplates.map((template) => (
                <Card key={template.id} className="border-l-4 border-l-indigo-500">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedTemplateIds.has(template.id)}
                        onChange={() => toggleTemplateSelection(template.id)}
                        className="mt-1 rounded"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <code className="bg-slate-100 px-2 py-1 rounded text-sm font-mono">
                            {template.phrase}
                          </code>
                          <Badge variant="outline">{template.category}</Badge>
                          {template.template_type === 'patient_specific' && (
                            <Badge className="bg-navy-100 text-navy-800">
                              <User className="w-3 h-3 mr-1" />
                              Patient-Specific
                            </Badge>
                          )}
                          {template.is_agency_wide && (
                            <Badge className="bg-green-100 text-green-800">
                              <Globe className="w-3 h-3 mr-1" />
                              Agency-Wide
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 line-clamp-2">
                          {template.expanded_text || template.ai_prompt_instructions}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />
                            Used {template.usage_count || 0} times
                          </span>
                          {userFolders.length > 0 && (
                            <Select
                              value={template.folder_id || 'none'}
                              onValueChange={(value) => handleMoveTemplate(template.id, value === 'none' ? null : value)}
                            >
                              <SelectTrigger className="h-6 text-xs w-auto border-0 bg-transparent hover:bg-slate-100">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Uncategorized</SelectItem>
                                {userFolders.map(folder => (
                                  <SelectItem key={folder.id} value={folder.id}>
                                    {folder.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(template)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        {(template.created_by === currentUser?.email || isAdmin) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(template.id)}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
        </Card>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="w-[95vw] sm:w-[90vw] max-w-5xl max-h-[90vh] overflow-visible">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-xl">
              {editingTemplate ? 'Edit Template' : 'Create New Template'}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto overflow-x-visible max-h-[65vh] pr-2">

          <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
            {/* AI Assistant Section */}
            <div className="border-b pb-3">
              {!showAIAssistant ? (
                <div className="flex gap-2 flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAIMode('generate');
                      setShowAIAssistant(true);
                    }}
                    className="border-navy-300 text-navy-700"
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    AI Generate
                  </Button>
                  {(formData.phrase || editingTemplate) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAIMode('improve');
                        setShowAIAssistant(true);
                      }}
                      className="border-navy-300 text-navy-700"
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      AI Suggestions
                    </Button>
                  )}
                  {formData.template_type === 'patient_specific' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAIMode('refine');
                        setShowAIAssistant(true);
                      }}
                      className="border-navy-300 text-navy-700"
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      Refine Instructions
                    </Button>
                  )}
                </div>
              ) : (
                <ClinicalLibraryAIAssistant
                  mode={aiMode}
                  currentTemplate={editingTemplate || formData}
                  onApplySuggestion={handleAISuggestion}
                />
              )}
            </div>

            <div>
              <Label className="text-sm">Quick Phrase</Label>
              <Input
                value={formData.phrase}
                onChange={(e) => setFormData({ ...formData, phrase: e.target.value })}
                placeholder="e.g., diabetic education"
                className="text-base"
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                This is what you'll type to trigger the expansion
              </p>
            </div>

            <div>
              <Label className="text-sm">Category</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger className="text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="education">Education</SelectItem>
                  <SelectItem value="assessment">Assessment</SelectItem>
                  <SelectItem value="intervention">Intervention</SelectItem>
                  <SelectItem value="wound_care">Wound Care</SelectItem>
                  <SelectItem value="medication">Medication</SelectItem>
                  <SelectItem value="vital_signs">Vital Signs</SelectItem>
                  <SelectItem value="safety">Safety</SelectItem>
                  <SelectItem value="communication">Communication</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm">Template Type</Label>
              <Select
                value={formData.template_type}
                onValueChange={(value) => setFormData({ ...formData, template_type: value })}
              >
                <SelectTrigger className="text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="generic">Generic (All Patients)</SelectItem>
                  <SelectItem value="patient_specific">Patient-Specific</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-1">
                {formData.template_type === 'generic' 
                  ? 'Same text for all patients' 
                  : 'Uses patient-specific data to generate personalized text'}
              </p>
            </div>

            {formData.template_type === 'generic' ? (
              <div>
                <Label className="text-sm">Expanded Text</Label>
                <Textarea
                  value={formData.expanded_text}
                  onChange={(e) => setFormData({ ...formData, expanded_text: e.target.value })}
                  placeholder="Full Medicare-compliant documentation text..."
                  rows={4}
                  className="text-base"
                  required
                />
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-sm">AI Instructions</Label>
                  <Textarea
                    value={formData.ai_prompt_instructions}
                    onChange={(e) => setFormData({ ...formData, ai_prompt_instructions: e.target.value })}
                    placeholder="Instructions for AI..."
                    rows={3}
                    className="text-base"
                    required
                  />
                </div>
                <div>
                  <Label className="text-sm">Patient Data Fields</Label>
                  <Input
                    value={formData.patient_data_fields.join(', ')}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      patient_data_fields: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    })}
                    placeholder="wounds, medications"
                    className="text-base"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Comma-separated field names
                  </p>
                </div>
              </>
            )}

            <div>
              <Label className="text-sm">Folder</Label>
              <Select
                value={formData.folder_id || 'none'}
                onValueChange={(value) => setFormData({ ...formData, folder_id: value === 'none' ? null : value })}
              >
                <SelectTrigger className="text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uncategorized</SelectItem>
                  {userFolders.map(folder => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="agency-wide"
                  checked={formData.is_agency_wide}
                  onChange={(e) => setFormData({ ...formData, is_agency_wide: e.target.checked })}
                  className="rounded"
                />
                <Label htmlFor="agency-wide">Make available agency-wide</Label>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editingTemplate ? 'Update' : 'Create'} Template
              </Button>
            </div>
          </form>
          </div>
        </DialogContent>
      </Dialog>
      </TabsContent>

      <TabsContent value="analytics">
        <ClinicalLibraryAnalytics />
      </TabsContent>
    </Tabs>
  );
}