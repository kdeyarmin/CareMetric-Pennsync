import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileText, Plus, Trash2, Star, Copy, Send } from "lucide-react";
import { toast } from "sonner";

const TEMPLATE_TYPES = {
  referral: "Referral Letter",
  consent_form: "Consent Form",
  lab_request: "Lab Request",
  prescription: "Prescription",
  insurance_auth: "Insurance Authorization",
  medical_records_request: "Medical Records Request",
  discharge_summary: "Discharge Summary",
  progress_note: "Progress Note",
  custom: "Custom Document"
};

const COMMON_PLACEHOLDERS = [
  { key: "patient_name", label: "Patient Name", type: "text" },
  { key: "patient_dob", label: "Patient DOB", type: "date" },
  { key: "patient_mrn", label: "MRN", type: "text" },
  { key: "provider_name", label: "Provider Name", type: "text" },
  { key: "date", label: "Date", type: "date" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "diagnosis", label: "Diagnosis", type: "text" },
  { key: "medication", label: "Medication", type: "text" }
];

export default function DocumentTemplateBuilder({ userEmail, open, onOpenChange, onUseTemplate }) {
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showUseDialog, setShowUseDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [placeholderValues, setPlaceholderValues] = useState({});
  const [formData, setFormData] = useState({
    template_name: "",
    template_type: "referral",
    document_content: "",
    placeholders: []
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['faxDocumentTemplates', userEmail],
    queryFn: () => base44.entities.FaxDocumentTemplate.filter({}, '-created_date'),
    enabled: !!userEmail && open
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FaxDocumentTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxDocumentTemplates'] });
      resetForm();
      toast.success("Template created");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FaxDocumentTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxDocumentTemplates'] });
      toast.success("Template deleted");
    }
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ id, isFavorite }) => 
      base44.entities.FaxDocumentTemplate.update(id, { 
        is_favorite: !isFavorite,
        times_used: templates.find(t => t.id === id)?.times_used || 0
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxDocumentTemplates'] });
    }
  });

  const incrementUsageMutation = useMutation({
    mutationFn: ({ id, timesUsed }) => 
      base44.entities.FaxDocumentTemplate.update(id, { times_used: timesUsed + 1 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxDocumentTemplates'] });
    }
  });

  const resetForm = () => {
    setShowCreateDialog(false);
    setFormData({
      template_name: "",
      template_type: "referral",
      document_content: "",
      placeholders: []
    });
  };

  const handleCreate = () => {
    if (!formData.template_name.trim() || !formData.document_content.trim()) {
      toast.error("Template name and content are required");
      return;
    }

    createMutation.mutate({
      ...formData,
      user_email: userEmail,
      times_used: 0,
      is_favorite: false
    });
  };

  const handleUseTemplate = (template) => {
    setSelectedTemplate(template);
    const initialValues = {};
    template.placeholders?.forEach(p => {
      initialValues[p.key] = "";
    });
    setPlaceholderValues(initialValues);
    setShowUseDialog(true);
  };

  const handleGenerateDocument = async () => {
    let content = selectedTemplate.document_content;
    Object.entries(placeholderValues).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      content = content.replace(regex, value || `[${key}]`);
    });

    // Convert to PDF-like format
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    // Upload to get file URL
    const formData = new FormData();
    formData.append('file', blob, `${selectedTemplate.template_name}.txt`);
    
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: blob });
      
      incrementUsageMutation.mutate({
        id: selectedTemplate.id,
        timesUsed: selectedTemplate.times_used || 0
      });

      onUseTemplate?.({
        name: selectedTemplate.template_name,
        url: file_url
      });
      
      setShowUseDialog(false);
      toast.success("Document generated and ready to send");
    } catch (error) {
      toast.error("Failed to generate document");
    }
  };

  const insertPlaceholder = (placeholder) => {
    setFormData({
      ...formData,
      document_content: formData.document_content + `{{${placeholder.key}}}`,
      placeholders: [...(formData.placeholders || []), placeholder].filter((p, i, arr) => 
        arr.findIndex(x => x.key === p.key) === i
      )
    });
  };

  const favoriteTemplates = templates.filter(t => t.is_favorite);
  const otherTemplates = templates.filter(t => !t.is_favorite);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Document Templates
            </DialogTitle>
            <Button size="sm" onClick={() => setShowCreateDialog(true)} className="gap-1">
              <Plus className="w-3 h-3" /> Create Template
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {favoriteTemplates.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-2">Favorites</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {favoriteTemplates.map(template => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onUse={() => handleUseTemplate(template)}
                    onToggleFavorite={() => toggleFavoriteMutation.mutate({ id: template.id, isFavorite: template.is_favorite })}
                    onDelete={() => {
                      if (confirm(`Delete "${template.template_name}"?`)) {
                        deleteMutation.mutate(template.id);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {otherTemplates.length > 0 && (
            <div>
              {favoriteTemplates.length > 0 && <p className="text-xs font-medium text-slate-500 mb-2">All Templates</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {otherTemplates.map(template => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onUse={() => handleUseTemplate(template)}
                    onToggleFavorite={() => toggleFavoriteMutation.mutate({ id: template.id, isFavorite: template.is_favorite })}
                    onDelete={() => {
                      if (confirm(`Delete "${template.template_name}"?`)) {
                        deleteMutation.mutate(template.id);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {templates.length === 0 && (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No templates yet</p>
              <p className="text-xs text-slate-400">Create templates for referrals, consents, and more</p>
            </div>
          )}
        </div>
      </DialogContent>

      {/* Create Template Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Document Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Template Name *</Label>
                <Input
                  value={formData.template_name}
                  onChange={e => setFormData({...formData, template_name: e.target.value})}
                  placeholder="e.g. Cardiology Referral"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Template Type</Label>
                <Select value={formData.template_type} onValueChange={v => setFormData({...formData, template_type: v})}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TEMPLATE_TYPES).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Document Content *</Label>
              <Textarea
                value={formData.document_content}
                onChange={e => setFormData({...formData, document_content: e.target.value})}
                placeholder="Enter document content. Use {{placeholder}} for dynamic fields."
                className="h-48 text-sm font-mono"
              />
            </div>

            <div>
              <Label className="text-xs mb-2 block">Insert Placeholders</Label>
              <div className="flex flex-wrap gap-1">
                {COMMON_PLACEHOLDERS.map(p => (
                  <Button
                    key={p.key}
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs"
                    onClick={() => insertPlaceholder(p)}
                  >
                    + {p.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={resetForm} size="sm">Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} size="sm">
              {createMutation.isPending ? "Creating..." : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Use Template Dialog */}
      <Dialog open={showUseDialog} onOpenChange={setShowUseDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fill Template: {selectedTemplate?.template_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {selectedTemplate?.placeholders?.map(placeholder => (
              <div key={placeholder.key}>
                <Label className="text-xs">{placeholder.label}</Label>
                {placeholder.type === 'dropdown' ? (
                  <Select 
                    value={placeholderValues[placeholder.key] || ""} 
                    onValueChange={v => setPlaceholderValues({...placeholderValues, [placeholder.key]: v})}
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {placeholder.options?.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={placeholder.type || 'text'}
                    value={placeholderValues[placeholder.key] || ""}
                    onChange={e => setPlaceholderValues({...placeholderValues, [placeholder.key]: e.target.value})}
                    placeholder={`Enter ${placeholder.label}`}
                    className="h-9 text-sm"
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowUseDialog(false)} size="sm">Cancel</Button>
            <Button onClick={handleGenerateDocument} className="gap-1" size="sm">
              <Send className="w-3 h-3" /> Generate & Attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function TemplateCard({ template, onUse, onToggleFavorite, onDelete }) {
  return (
    <div className="border rounded-lg p-3 bg-white hover:border-blue-300 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{template.template_name}</p>
          <Badge className="bg-blue-50 text-blue-700 text-[10px] mt-1">
            {TEMPLATE_TYPES[template.template_type]}
          </Badge>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 flex-shrink-0"
          onClick={onToggleFavorite}
        >
          <Star className={`w-3.5 h-3.5 ${template.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-slate-400'}`} />
        </Button>
      </div>
      <p className="text-xs text-slate-500 line-clamp-2 mb-2">{template.document_content.substring(0, 80)}...</p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{template.times_used || 0} uses</span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs gap-1" onClick={onUse}>
            <Send className="w-3 h-3" /> Use
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500 hover:text-red-700" onClick={onDelete}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}