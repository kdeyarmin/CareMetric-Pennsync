import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { FileText, Plus, Pencil, Trash2, Star, Copy, Info } from "lucide-react";
import { toast } from "sonner";

const URGENCY_OPTIONS = {
  normal: "Normal",
  urgent: "🔴 URGENT",
  for_review: "📋 For Review",
  please_reply: "↩️ Please Reply",
  confidential: "🔒 Confidential"
};

const PLACEHOLDERS = [
  { tag: "{{recipient_name}}", label: "Recipient Name" },
  { tag: "{{recipient_fax}}", label: "Recipient Fax" },
  { tag: "{{sender_name}}", label: "Sender Name" },
  { tag: "{{sender_company}}", label: "Sender Company" },
  { tag: "{{sender_phone}}", label: "Sender Phone" },
  { tag: "{{date}}", label: "Current Date" },
  { tag: "{{time}}", label: "Current Time" },
];

const EMPTY_TEMPLATE = {
  name: "",
  sender_name: "",
  sender_company: "",
  sender_phone: "",
  sender_fax: "",
  subject_line: "",
  message_body: "",
  urgency: "normal",
  include_hipaa_notice: true,
  is_default: false,
};

export default function FaxTemplateManager({ userEmail, open, onOpenChange, onSelectTemplate }) {
  const queryClient = useQueryClient();
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [formData, setFormData] = useState(EMPTY_TEMPLATE);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['faxCoverTemplates', userEmail],
    queryFn: () => base44.entities.FaxCoverTemplate.filter({ user_email: userEmail }),
    enabled: !!userEmail
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FaxCoverTemplate.create({ ...data, user_email: userEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxCoverTemplates'] });
      resetForm();
      toast.success("Template created");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FaxCoverTemplate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxCoverTemplates'] });
      resetForm();
      toast.success("Template updated");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FaxCoverTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxCoverTemplates'] });
      setShowDeleteConfirm(null);
      toast.success("Template deleted");
    }
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (templateId) => {
      // Unset current defaults
      const currentDefaults = templates.filter(t => t.is_default);
      for (const t of currentDefaults) {
        await base44.entities.FaxCoverTemplate.update(t.id, { is_default: false });
      }
      await base44.entities.FaxCoverTemplate.update(templateId, { is_default: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxCoverTemplates'] });
      toast.success("Default template set");
    }
  });

  const resetForm = () => {
    setEditingTemplate(null);
    setFormData(EMPTY_TEMPLATE);
  };

  const startEdit = (template) => {
    setEditingTemplate(template.id);
    setFormData({
      name: template.name || "",
      sender_name: template.sender_name || "",
      sender_company: template.sender_company || "",
      sender_phone: template.sender_phone || "",
      sender_fax: template.sender_fax || "",
      subject_line: template.subject_line || "",
      message_body: template.message_body || "",
      urgency: template.urgency || "normal",
      include_hipaa_notice: template.include_hipaa_notice !== false,
      is_default: template.is_default || false,
    });
  };

  const startNew = () => {
    setEditingTemplate("new");
    setFormData(EMPTY_TEMPLATE);
  };

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast.error("Template name is required");
      return;
    }
    if (editingTemplate === "new") {
      createMutation.mutate(formData);
    } else {
      updateMutation.mutate({ id: editingTemplate, data: formData });
    }
  };

  const insertPlaceholder = (tag) => {
    setFormData(prev => ({
      ...prev,
      message_body: (prev.message_body || "") + tag
    }));
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isEditing = editingTemplate !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {isEditing
              ? editingTemplate === "new" ? "Create Template" : "Edit Template"
              : "Cover Sheet Templates"
            }
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Use placeholders like {{recipient_name}} for dynamic content."
              : "Manage your reusable fax cover sheet templates."
            }
          </DialogDescription>
        </DialogHeader>

        {!isEditing ? (
          /* Template List */
          <div className="space-y-3">
            <Button onClick={startNew} className="w-full" size="sm">
              <Plus className="w-4 h-4 mr-2" /> New Template
            </Button>

            {isLoading ? (
              <p className="text-sm text-slate-500 text-center py-4">Loading...</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No templates yet. Create your first one!</p>
            ) : (
              <div className="space-y-2">
                {templates.map(t => (
                  <div key={t.id} className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors bg-white">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{t.name}</span>
                        {t.is_default && <Badge className="bg-blue-100 text-blue-700 text-[10px]">Default</Badge>}
                      </div>
                      {t.subject_line && <p className="text-xs text-slate-500 truncate mt-0.5">{t.subject_line}</p>}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {onSelectTemplate && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-7 px-2 text-xs" 
                          onClick={() => {
                            onSelectTemplate(t);
                            onOpenChange(false);
                          }}
                        >
                          Use
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDefaultMutation.mutate(t.id)} title="Set as default">
                        <Star className={`w-3.5 h-3.5 ${t.is_default ? 'fill-blue-500 text-blue-500' : 'text-slate-400'}`} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(t)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={() => setShowDeleteConfirm(t.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Delete confirmation */}
            {showDeleteConfirm && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                <p className="text-sm text-red-800">Delete this template? This cannot be undone.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(showDeleteConfirm)} disabled={deleteMutation.isPending}>
                    Delete
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowDeleteConfirm(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Template Form */
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Template Name *</Label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Referral Cover Sheet" className="h-9 text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Default Sender Name</Label>
                <Input value={formData.sender_name} onChange={e => setFormData({...formData, sender_name: e.target.value})} placeholder="Your Name" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Default Company/Agency</Label>
                <Input value={formData.sender_company} onChange={e => setFormData({...formData, sender_company: e.target.value})} placeholder="Company" className="h-9 text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Default Phone</Label>
                <Input value={formData.sender_phone} onChange={e => setFormData({...formData, sender_phone: e.target.value})} placeholder="(555) 123-4567" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Urgency</Label>
                <Select value={formData.urgency} onValueChange={v => setFormData({...formData, urgency: v})}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(URGENCY_OPTIONS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Default Subject</Label>
              <Input value={formData.subject_line} onChange={e => setFormData({...formData, subject_line: e.target.value})} placeholder="e.g. Patient Referral for {{recipient_name}}" className="h-9 text-sm" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Message Body</Label>
                <div className="flex items-center gap-1">
                  <Info className="w-3 h-3 text-slate-400" />
                  <span className="text-[10px] text-slate-500">Click to insert placeholders</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {PLACEHOLDERS.map(p => (
                  <button
                    key={p.tag}
                    type="button"
                    onClick={() => insertPlaceholder(p.tag)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <Textarea
                value={formData.message_body}
                onChange={e => setFormData({...formData, message_body: e.target.value})}
                placeholder="Dear {{recipient_name}},&#10;&#10;Please find the attached documents regarding..."
                rows={5}
                className="text-sm"
              />
            </div>

            <div className="flex items-center gap-3">
              <Label className="text-xs flex items-center gap-2">
                <Switch checked={formData.include_hipaa_notice} onCheckedChange={v => setFormData({...formData, include_hipaa_notice: v})} />
                Include HIPAA Notice
              </Label>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button variant="outline" onClick={resetForm} size="sm">Cancel</Button>
              <Button onClick={handleSave} disabled={isSaving} size="sm">
                {isSaving ? "Saving..." : editingTemplate === "new" ? "Create Template" : "Save Changes"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export { PLACEHOLDERS };