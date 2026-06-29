import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Plus,
  Trash2,
  Edit2,
  Star,
  BookTemplate,
  Phone,
  User,
  Building2,
  FileText,
  Loader2,
  Copy
} from "lucide-react";
import { toast } from "sonner";

export default function FaxTemplateManager({ onApplyTemplate }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());

  function emptyForm() {
    return {
      name: "",
      description: "",
      recipient_name: "",
      recipient_fax_number: "",
      recipient_organization: "",
      subject: "",
      notes: "",
      is_default: false
    };
  }

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["fax-templates"],
    queryFn: () => base44.entities.FaxTemplate.list("-created_date", 50),
    initialData: []
  });

  const openNew = () => {
    setEditingTemplate(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (tpl) => {
    setEditingTemplate(tpl);
    setForm({
      name: tpl.name || "",
      description: tpl.description || "",
      recipient_name: tpl.recipient_name || "",
      recipient_fax_number: tpl.recipient_fax_number || "",
      recipient_organization: tpl.recipient_organization || "",
      subject: tpl.subject || "",
      notes: tpl.notes || "",
      is_default: tpl.is_default || false
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Template name is required");
      return;
    }
    setSaving(true);
    try {
      if (editingTemplate) {
        await base44.entities.FaxTemplate.update(editingTemplate.id, form);
        toast.success("Template updated");
      } else {
        await base44.entities.FaxTemplate.create({ ...form, use_count: 0 });
        toast.success("Template saved");
      }
      queryClient.invalidateQueries({ queryKey: ["fax-templates"] });
      setShowForm(false);
    } catch (e) {
      toast.error("Failed to save template: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tpl) => {
    if (!(await confirm({ title: "Delete template?", description: `Delete template "${tpl.name}"? This can't be undone.`, confirmText: "Delete", destructive: true }))) return;
    try {
      await base44.entities.FaxTemplate.delete(tpl.id);
      queryClient.invalidateQueries({ queryKey: ["fax-templates"] });
      toast.success("Template deleted");
    } catch (e) {
      toast.error("Failed to delete: " + e.message);
    }
  };

  const handleApply = async (tpl) => {
    // Increment use count
    base44.entities.FaxTemplate.update(tpl.id, { use_count: (tpl.use_count || 0) + 1 })
      .catch((e) => console.warn("Failed to increment template use_count:", e?.message));
    queryClient.invalidateQueries({ queryKey: ["fax-templates"] });
    if (onApplyTemplate) onApplyTemplate(tpl);
    toast.success(`Template "${tpl.name}" applied`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookTemplate className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-slate-900">Fax Templates</h2>
          <Badge variant="secondary">{templates.length}</Badge>
        </div>
        <Button onClick={openNew} size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          New Template
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading templates...
        </div>
      ) : templates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <BookTemplate className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No templates yet</p>
            <p className="text-sm text-slate-400 mt-1">Save common fax configurations for quick reuse</p>
            <Button onClick={openNew} variant="outline" size="sm" className="mt-4 gap-2">
              <Plus className="w-4 h-4" /> Create First Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {templates.map((tpl) => (
            <Card key={tpl.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-900 truncate">{tpl.name}</h3>
                      {tpl.is_default && (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1 text-xs">
                          <Star className="w-3 h-3" /> Default
                        </Badge>
                      )}
                      {tpl.use_count > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          Used {tpl.use_count}×
                        </Badge>
                      )}
                    </div>
                    {tpl.description && (
                      <p className="text-sm text-slate-500 mb-2">{tpl.description}</p>
                    )}
                    <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                      {tpl.recipient_name && (
                        <span className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-full">
                          <User className="w-3 h-3" /> {tpl.recipient_name}
                        </span>
                      )}
                      {tpl.recipient_organization && (
                        <span className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-full">
                          <Building2 className="w-3 h-3" /> {tpl.recipient_organization}
                        </span>
                      )}
                      {tpl.recipient_fax_number && (
                        <span className="flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                          <Phone className="w-3 h-3" /> {tpl.recipient_fax_number}
                        </span>
                      )}
                      {tpl.subject && (
                        <span className="flex items-center gap-1 bg-navy-50 text-navy-700 px-2 py-0.5 rounded-full">
                          <FileText className="w-3 h-3" /> {tpl.subject}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleApply(tpl)}
                      className="gap-1 text-xs h-8"
                    >
                      <Copy className="w-3 h-3" /> Apply
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-indigo-600"
                      onClick={() => openEdit(tpl)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-red-600"
                      onClick={() => handleDelete(tpl)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Save/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template" : "New Fax Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Template Name *</Label>
              <Input
                placeholder="e.g. Penn Hospice – CHCS Referral"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                placeholder="Brief description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium text-slate-700 mb-3">Pre-filled Recipient Info</p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Recipient Name</Label>
                  <Input
                    placeholder="Dr. Jane Smith"
                    value={form.recipient_name}
                    onChange={(e) => setForm({ ...form, recipient_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Organization</Label>
                  <Input
                    placeholder="Memorial Hospital"
                    value={form.recipient_organization}
                    onChange={(e) => setForm({ ...form, recipient_organization: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Fax Number</Label>
                  <Input
                    type="tel"
                    placeholder="+12155551234"
                    value={form.recipient_fax_number}
                    onChange={(e) => setForm({ ...form, recipient_fax_number: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium text-slate-700 mb-3">Cover Sheet Defaults</p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Subject</Label>
                  <Input
                    placeholder="Fax subject line"
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes / Message</Label>
                  <Textarea
                    placeholder="Standard message to include on cover sheet..."
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_default"
                checked={form.is_default}
                onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                className="rounded"
              />
              <Label htmlFor="is_default" className="cursor-pointer">Set as default template</Label>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button className="flex-1 gap-2" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {editingTemplate ? "Save Changes" : "Create Template"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}