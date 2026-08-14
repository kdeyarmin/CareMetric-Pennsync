import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
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
  BookUser,
  Plus,
  Search,
  Edit2,
  Trash2,
  Building2,
  Phone,
  FileText,
  Upload,
  Download,
  Users
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import AIContactExtractor from "@/components/fax/AIContactExtractor";
import { toCsvRows } from "@/components/admin/csvExport";

/**
 * Minimal quote-aware RFC 4180 CSV parser. Handles quoted fields containing
 * embedded commas, escaped quotes ("" -> "), and embedded CR/LF, so a value like
 * "Smith, Jones & Co" does not shift subsequent columns. Returns an array of row
 * arrays (fields are not trimmed here — the caller trims as needed).
 */
function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = "";
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === '\r') {
      // Ignore stray CR outside quotes; the following LF terminates the row.
    } else {
      field += char;
    }
  }
  // Flush the trailing field/row (files may omit a final newline).
  row.push(field);
  rows.push(row);

  // Drop rows that are entirely empty (e.g. a trailing blank line).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export default function FaxContactsPage() {
  const confirm = useConfirm();
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    organization: "",
    fax_number: "",
    notes: ""
  });

  const queryClient = useQueryClient();

  const { data: contacts = [], isLoading } = useQuery({
    // Row limit is part of the identity — FaxAddressBook reads 500 under the
    // same root, and a shared entry truncated this directory to 500 contacts
    // whenever the address book loaded first.
    queryKey: ['fax-contacts', 1000],
    queryFn: () => base44.entities.FaxContact.list('-created_date', 1000),
    initialData: []
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FaxContact.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fax-contacts'] });
      setIsDialogOpen(false);
      resetForm();
      toast.success("Contact added");
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FaxContact.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fax-contacts'] });
      setIsDialogOpen(false);
      resetForm();
      toast.success("Contact updated");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FaxContact.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fax-contacts'] });
      toast.success("Contact deleted");
    }
  });

  const resetForm = () => {
    setFormData({ name: "", organization: "", fax_number: "", notes: "" });
    setEditingContact(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.fax_number.trim()) {
      toast.error("Name and fax number are required");
      return;
    }

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
    setIsDialogOpen(true);
  };

  const handleCSVUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const rows = parseCsv(text);

      if (rows.length < 2) {
        toast.error("CSV file is empty or invalid");
        return;
      }

      const headers = rows[0].map(h => h.trim().toLowerCase());
      const nameIndex = headers.findIndex(h => h.includes('name'));
      const faxIndex = headers.findIndex(h => h.includes('fax') || h.includes('number'));
      const orgIndex = headers.findIndex(h => h.includes('org') || h.includes('company') || h.includes('facility'));
      const notesIndex = headers.findIndex(h => h.includes('note'));

      if (nameIndex === -1 || faxIndex === -1) {
        toast.error("CSV must have 'name' and 'fax' columns");
        return;
      }

      // Strip the leading apostrophe our export adds to neutralize spreadsheet
      // formula injection (e.g. "'+12155550100" round-trips back to "+12155550100").
      // Applied to EVERY column, not just the fax number: the exporter guards any
      // cell starting with = + - @, so a note like "- calls before 3pm" otherwise
      // gained another apostrophe on each export→import cycle. The lookahead only
      // removes an apostrophe our exporter could have added, leaving a name like
      // "'Round the Clock Care" intact.
      const stripFormulaGuard = (raw) => (raw || "").replace(/^'(?=[=+\-@\t\r])/, "").trim();

      const contactsToAdd = [];
      for (let i = 1; i < rows.length; i++) {
        const values = rows[i].map(v => v.trim());
        const name = stripFormulaGuard(values[nameIndex]);
        // The fax column keeps the broader strip: a phone number is never
        // legitimately quoted, so any leading apostrophe there is an artifact.
        const faxNumber = (values[faxIndex] || "").replace(/^'/, "").trim();
        // Require a name and a fax number that actually contains digits so a
        // mangled/blank column can't persist a garbage contact.
        if (name && /\d/.test(faxNumber)) {
          contactsToAdd.push({
            name,
            fax_number: faxNumber,
            organization: orgIndex !== -1 ? stripFormulaGuard(values[orgIndex]) : "",
            notes: notesIndex !== -1 ? stripFormulaGuard(values[notesIndex]) : ""
          });
        }
      }

      if (contactsToAdd.length === 0) {
        toast.error("No valid contacts found in CSV");
        return;
      }

      await base44.entities.FaxContact.bulkCreate(contactsToAdd);
      queryClient.invalidateQueries({ queryKey: ['fax-contacts'] });
      toast.success(`Added ${contactsToAdd.length} contacts`);
    } catch (error) {
      toast.error("Failed to upload CSV: " + error.message);
    }
  };

  const handleExportCSV = () => {
    const csv = toCsvRows([
      ['Name', 'Fax Number', 'Organization', 'Notes'],
      ...filteredContacts.map(c => [c.name, c.fax_number, c.organization || '', c.notes || '']),
    ]);

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fax-contacts-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported to CSV");
  };

  const filteredContacts = contacts.filter(contact =>
    contact.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.organization?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.fax_number?.includes(searchTerm)
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Actions */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center">
              <Badge variant="outline" className="text-base px-3 py-1 whitespace-nowrap">
                <Users className="w-4 h-4 mr-2" />
                {contacts.length} contacts
              </Badge>
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by name, organization, or fax number..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Contact
            </Button>
            <Button variant="outline" asChild>
              <label className="cursor-pointer">
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCSVUpload}
                  className="hidden"
                />
              </label>
            </Button>
            {contacts.length > 0 && (
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Contacts Grid */}
      {isLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-slate-500">Loading contacts...</p>
          </CardContent>
        </Card>
      ) : filteredContacts.length === 0 ? (
        <EmptyState
          icon={BookUser}
          title={searchTerm ? "No contacts found" : "No contacts yet"}
          description={searchTerm ? "Try a different search term." : "Add your first contact or import from CSV."}
          action={!searchTerm && (
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add First Contact
            </Button>
          )}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContacts.map((contact) => (
            <Card key={contact.id} className="hover:shadow-lg transition-all duration-200">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg text-slate-900 mb-1">
                      {contact.name}
                    </h3>
                    {contact.organization && (
                      <div className="flex items-center gap-2 text-sm text-slate-600 mb-1">
                        <Building2 className="w-4 h-4" />
                        {contact.organization}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm text-indigo-600 font-medium">
                      <Phone className="w-4 h-4" />
                      {contact.fax_number}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit contact"
                      className="h-8 w-8"
                      onClick={() => handleEdit(contact)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete contact"
                      className="h-8 w-8 text-red-600 hover:text-red-700"
                      onClick={async () => {
                        if (await confirm({ title: "Delete contact?", description: `Delete ${contact.name}? This can't be undone.`, confirmText: "Delete", destructive: true })) {
                          deleteMutation.mutate(contact.id);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {contact.notes && (
                  <div className="bg-slate-50 rounded-lg p-2 mt-3">
                    <div className="flex items-start gap-2">
                      <FileText className="w-3 h-3 mt-0.5 text-slate-500" />
                      <p className="text-xs text-slate-600 line-clamp-2">
                        {contact.notes}
                      </p>
                    </div>
                  </div>
                )}

                <div className="text-xs text-slate-400 mt-3 pt-3 border-t">
                  Added {format(new Date(contact.created_date), 'MMM d, yyyy')}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingContact ? "Edit Contact" : "Add New Contact"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <AIContactExtractor
              onExtracted={(data) =>
                setFormData(prev => ({
                  ...prev,
                  name:         data.name         || prev.name,
                  organization: data.organization || prev.organization,
                  fax_number:   data.fax_number   || prev.fax_number,
                  notes:        data.notes        ? (prev.notes ? prev.notes + "\n" + data.notes : data.notes) : prev.notes
                }))
              }
            />
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="John Doe"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fax_number">Fax Number *</Label>
              <Input
                id="fax_number"
                type="tel"
                placeholder="+1234567890"
                value={formData.fax_number}
                onChange={(e) => setFormData({ ...formData, fax_number: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization">Organization</Label>
              <Input
                id="organization"
                placeholder="Hospital Name"
                value={formData.organization}
                onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Additional information about this contact..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                type="submit"
                className="flex-1"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {editingContact ? "Update" : "Add"} Contact
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}