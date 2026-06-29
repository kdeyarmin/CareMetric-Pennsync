import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  FileText, 
  Plus, 
  Edit, 
  Copy, 
  Eye,
  Trash2,
  History,
  Settings
} from "lucide-react";
import { toast } from "sonner";
import TemplateFieldMapper from "./TemplateFieldMapper";
import VisualPDFTemplateEditor from "./VisualPDFTemplateEditor";
import TemplateSearchFilter from "./TemplateSearchFilter";
import TemplateVersionHistory from "./TemplateVersionHistory";

export default function PDFTemplateManager() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [showFieldMapper, setShowFieldMapper] = useState(false);
  const [showVisualEditor, setShowVisualEditor] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(null);
  const [filteredTemplates, setFilteredTemplates] = useState([]);
  const [templateData, setTemplateData] = useState({
    template_name: '',
    template_category: 'consent',
    description: '',
    template_file_url: '',
    field_mappings: [],
    signature_fields: [
      { field_name: 'patient_signature', label: 'Patient Signature', role: 'Patient', required: true }
    ],
    version: '1.0',
    visual_elements: []
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['pdf-templates'],
    queryFn: () => base44.entities.PDFTemplate.list('-created_date'),
    initialData: []
  });

  // TemplateSearchFilter owns filteredTemplates: its effect re-emits the filtered
  // list whenever `templates` (or any filter) changes. A second writer here would
  // race it and momentarily replace an active filter with the unfiltered list.

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.PDFTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-templates'] });
      setDialogOpen(false);
      resetForm();
      toast.success("Template created successfully!");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PDFTemplate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-templates'] });
      setDialogOpen(false);
      resetForm();
      toast.success("Template updated successfully!");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PDFTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-templates'] });
      toast.success("Template deleted successfully!");
    }
  });

  const resetForm = () => {
    setTemplateData({
      template_name: '',
      template_category: 'consent',
      description: '',
      template_file_url: '',
      field_mappings: [],
      signature_fields: [
        { field_name: 'patient_signature', label: 'Patient Signature', role: 'Patient', required: true }
      ],
      version: '1.0',
      visual_elements: []
    });
    setEditingTemplate(null);
    setShowFieldMapper(false);
    setShowVisualEditor(false);
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setTemplateData(template);
    setDialogOpen(true);
  };

  const handleCreateVersion = (template) => {
    const newVersion = parseFloat(template.version) + 0.1;
    setTemplateData({
      ...template,
      version: newVersion.toFixed(1),
      parent_template_id: template.id,
      change_notes: ''
    });
    setEditingTemplate(null);
    setDialogOpen(true);
  };

  const handleUploadTemplate = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const result = await base44.integrations.Core.UploadFile({ file });
      setTemplateData(prev => ({ ...prev, template_file_url: result.file_url }));
      toast.success("Template uploaded successfully!");
    } catch {
      toast.error("Failed to upload template");
    }
  };

  const handleSave = () => {
    if (!templateData.template_name || !templateData.template_file_url) {
      toast.error("Please fill in required fields");
      return;
    }

    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: templateData });
    } else {
      createMutation.mutate(templateData);
    }
  };

  const _groupedTemplates = templates.reduce((acc, template) => {
    const category = template.template_category;
    if (!acc[category]) acc[category] = [];
    acc[category].push(template);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">PDF Template Library</h2>
          <p className="text-slate-600">Manage reusable PDF templates with custom field mappings</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Template
        </Button>
      </div>

      {/* Search & Filter */}
      <TemplateSearchFilter 
        templates={templates} 
        onFilter={setFilteredTemplates}
      />

      {/* Template List by Category */}
      <div className="space-y-6">
        {Object.entries(
          filteredTemplates.reduce((acc, template) => {
            const category = template.template_category;
            if (!acc[category]) acc[category] = [];
            acc[category].push(template);
            return acc;
          }, {})
        ).map(([category, categoryTemplates]) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="text-lg capitalize">{category} Templates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {categoryTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center gap-3 p-3 border rounded-lg hover:bg-slate-50"
                  >
                    <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-slate-900">
                          {template.template_name}
                        </h4>
                        <Badge variant="outline">v{template.version}</Badge>
                        {!template.is_active && (
                          <Badge className="bg-slate-100 text-slate-600">Inactive</Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-600">{template.description}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {template.field_mappings?.length || 0} field mappings • 
                        Used {template.usage_count || 0} times
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(template)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleCreateVersion(template)}>
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setShowVersionHistory(template.id)}
                        title="View version history"
                      >
                        <History className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={async () => {
                          if (await confirm({ title: "Delete template?", description: "Delete this template? This can't be undone.", confirmText: "Delete", destructive: true })) {
                            deleteMutation.mutate(template.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Version History Dialog */}
      {showVersionHistory && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white">
              <h3 className="text-lg font-semibold">Version History</h3>
              <button 
                onClick={() => setShowVersionHistory(null)}
                className="text-slate-500 hover:text-slate-700 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6">
              <TemplateVersionHistory parentTemplateId={showVersionHistory} />
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'Create Template'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Template Name *</Label>
                <Input
                  value={templateData.template_name}
                  onChange={(e) => setTemplateData(prev => ({ ...prev, template_name: e.target.value }))}
                  placeholder="Admission Consent Form"
                />
              </div>
              <div>
                <Label>Category *</Label>
                <Select
                  value={templateData.template_category}
                  onValueChange={(value) => setTemplateData(prev => ({ ...prev, template_category: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consent">Consent</SelectItem>
                    <SelectItem value="assessment">Assessment</SelectItem>
                    <SelectItem value="care_plan">Care Plan</SelectItem>
                    <SelectItem value="discharge">Discharge</SelectItem>
                    <SelectItem value="admission">Admission</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={templateData.description}
                onChange={(e) => setTemplateData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What is this template used for?"
                rows={2}
              />
            </div>

            <div>
              <Label>Version</Label>
              <Input
                value={templateData.version}
                onChange={(e) => setTemplateData(prev => ({ ...prev, version: e.target.value }))}
                placeholder="1.0"
              />
            </div>

            {templateData.parent_template_id && (
              <div>
                <Label>Change Notes</Label>
                <Textarea
                  value={templateData.change_notes || ''}
                  onChange={(e) => setTemplateData(prev => ({ ...prev, change_notes: e.target.value }))}
                  placeholder="What changed in this version?"
                  rows={2}
                />
              </div>
            )}

            <div>
              <Label>Template PDF File *</Label>
              <div className="flex gap-2">
                <Input
                  type="file"
                  accept=".pdf"
                  onChange={handleUploadTemplate}
                  className="flex-1"
                />
                {templateData.template_file_url && (
                  <Button
                    variant="outline"
                    onClick={() => window.open(templateData.template_file_url, '_blank')}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="border-t pt-4 space-y-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowVisualEditor(!showVisualEditor);
                  setShowFieldMapper(false);
                }}
                className="w-full bg-gradient-to-r from-navy-50 to-indigo-50 hover:from-navy-100 hover:to-indigo-100"
              >
                <Settings className="w-4 h-4 mr-2" />
                {showVisualEditor ? 'Hide' : 'Open'} Visual Editor ({templateData.visual_elements?.length || 0} elements)
              </Button>
              
              <Button
                variant="outline"
                onClick={() => {
                  setShowFieldMapper(!showFieldMapper);
                  setShowVisualEditor(false);
                }}
                className="w-full"
              >
                <Settings className="w-4 h-4 mr-2" />
                {showFieldMapper ? 'Hide' : 'Configure'} Field Mappings ({templateData.field_mappings?.length || 0})
              </Button>
            </div>

            {showVisualEditor && (
              <VisualPDFTemplateEditor
                templateElements={templateData.visual_elements || []}
                onElementsChange={(elements) => setTemplateData(prev => ({ ...prev, visual_elements: elements }))}
                pdfUrl={templateData.template_file_url}
              />
            )}

            {showFieldMapper && (
              <TemplateFieldMapper
                mappings={templateData.field_mappings || []}
                signatureFields={templateData.signature_fields || []}
                onMappingsChange={(mappings) => setTemplateData(prev => ({ ...prev, field_mappings: mappings }))}
                onSignatureFieldsChange={(fields) => setTemplateData(prev => ({ ...prev, signature_fields: fields }))}
              />
            )}

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                {editingTemplate ? 'Update' : 'Create'} Template
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}