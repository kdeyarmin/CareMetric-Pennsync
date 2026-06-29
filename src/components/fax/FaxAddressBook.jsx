import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Upload, Search, Edit, Trash2, Building2, Phone, FileText } from "lucide-react";
import { toast } from "sonner";
import PhysicianSelector from '../physician/PhysicianSelector';
import ProviderCsvImport from '../physician/ProviderCsvImport';

export default function FaxAddressBook({ onSelectContact }) {
  const confirm = useConfirm();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    organization: "",
    fax_number: "",
    notes: ""
  });

  const queryClient = useQueryClient();

  const { data: contacts = [] } = useQuery({
    queryKey: ['fax-contacts'],
    queryFn: () => base44.entities.FaxContact.list('-created_date', 500),
    initialData: []
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FaxContact.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fax-contacts'] });
      setIsAddDialogOpen(false);
      resetForm();
      toast.success("Contact added successfully");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FaxContact.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fax-contacts'] });
      setEditingContact(null);
      resetForm();
      toast.success("Contact updated successfully");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FaxContact.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fax-contacts'] });
      toast.success("Contact deleted successfully");
    }
  });

  const resetForm = () => {
    setFormData({ name: "", organization: "", fax_number: "", notes: "" });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingContact) {
      updateMutation.mutate({ id: editingContact.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (contact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name,
      organization: contact.organization || "",
      fax_number: contact.fax_number,
      notes: contact.notes || ""
    });
    setIsAddDialogOpen(true);
  };

  const handleCSVUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

      const nameIndex = headers.findIndex(h => h.includes('name'));
      const faxIndex = headers.findIndex(h => h.includes('fax') || h.includes('number'));
      const orgIndex = headers.findIndex(h => h.includes('org') || h.includes('facility'));

      if (nameIndex === -1 || faxIndex === -1) {
        toast.error("CSV must contain 'name' and 'fax' columns");
        return;
      }

      const contactsToAdd = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values[nameIndex] && values[faxIndex]) {
          contactsToAdd.push({
            name: values[nameIndex],
            fax_number: values[faxIndex],
            organization: orgIndex !== -1 ? values[orgIndex] : ""
          });
        }
      }

      await base44.entities.FaxContact.bulkCreate(contactsToAdd);
      queryClient.invalidateQueries({ queryKey: ['fax-contacts'] });
      toast.success(`Added ${contactsToAdd.length} contacts`);
    } catch (error) {
      toast.error("Failed to upload CSV: " + error.message);
    }
  };

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.organization?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.fax_number.includes(searchTerm)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search contacts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-11"
          />
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
          setIsAddDialogOpen(open);
          if (!open) {
            setEditingContact(null);
            resetForm();
          }
        }}>
          <DialogTrigger asChild>
            <Button className="h-11 rounded-xl bg-gradient-to-r from-indigo-600 to-navy-600 text-white shadow-sm hover:from-indigo-700 hover:to-navy-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Contact
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingContact ? "Edit Contact" : "Add Contact"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Organization</Label>
                <Input
                  value={formData.organization}
                  onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                />
              </div>
              <div>
                <Label>Fax Number *</Label>
                <Input
                  type="tel"
                  placeholder="+1234567890"
                  value={formData.fax_number}
                  onChange={(e) => setFormData({ ...formData, fax_number: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" className="flex-1 h-11 rounded-xl bg-slate-900 text-white hover:bg-slate-800">
                  {editingContact ? "Update" : "Add"} Contact
                </Button>
                <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)} className="h-11 rounded-xl border-slate-300 bg-white">
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <ProviderCsvImport onImported={() => {
          queryClient.invalidateQueries({ queryKey: ['fax-contacts'] });
          queryClient.invalidateQueries({ queryKey: ['physicians'] });
        }} />
        <Button variant="outline" asChild className="h-11 rounded-xl border-slate-300 bg-white">
          <label className="cursor-pointer">
            <Upload className="w-4 h-4 mr-2" />
            Upload Contacts CSV
            <input type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
          </label>
        </Button>
      </div>

      <PhysicianSelector onSelectPhysician={(provider) => {
        onSelectContact?.({
          name: `${provider.full_name}${provider.credentials ? ', ' + provider.credentials : ''}`,
          organization: provider.practice_name || '',
          fax_number: provider.fax_number
        });
      }} />

      <div className="grid gap-3 max-h-96 overflow-y-auto pr-2">
        {filteredContacts.map((contact) => (
          <Card key={contact.id} className="cursor-pointer border-slate-200 bg-white hover:-translate-y-0.5 hover:shadow-lg transition-all" onClick={() => onSelectContact?.(contact)}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-semibold text-slate-900">{contact.name}</div>
                  {contact.organization && (
                    <div className="flex items-center gap-1 text-sm text-slate-600 mt-1">
                      <Building2 className="w-3 h-3" />
                      {contact.organization}
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-sm text-slate-600 mt-1">
                    <Phone className="w-3 h-3" />
                    {contact.fax_number}
                  </div>
                  {contact.notes && (
                    <div className="flex items-start gap-1 text-sm text-slate-500 mt-2">
                      <FileText className="w-3 h-3 mt-0.5" />
                      <span className="text-xs">{contact.notes}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(contact);
                    }}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirm({ title: "Delete contact?", description: `Delete ${contact.name}? This can't be undone.`, confirmText: "Delete", destructive: true })) {
                        deleteMutation.mutate(contact.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filteredContacts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-slate-500">
            <p className="text-sm leading-relaxed break-words">No contacts found. Add your first contact, import a provider CSV, or upload a contacts CSV file.</p>
          </div>
        )}
      </div>
    </div>
  );
}