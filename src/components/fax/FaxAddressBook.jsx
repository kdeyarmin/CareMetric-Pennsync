import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Plus, Star, Trash2, Phone, Search, X, Building2 } from "lucide-react";
import { toast } from "sonner";

export default function FaxAddressBook({ userEmail, agencyId, onSelectContact }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [newContact, setNewContact] = useState({
    name: "", fax_number: "", company: "", department: "", notes: "", is_shared: false
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ['faxContacts', userEmail, agencyId],
    queryFn: async () => {
      const mine = await base44.entities.FaxContact.filter({ user_email: userEmail });
      if (agencyId) {
        const shared = await base44.entities.FaxContact.filter({ agency_id: agencyId, is_shared: true });
        const allContacts = [...mine];
        shared.forEach(s => {
          if (!allContacts.find(c => c.id === s.id)) allContacts.push(s);
        });
        return allContacts.sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0));
      }
      return mine.sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0));
    },
    enabled: !!userEmail
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FaxContact.create({
      ...data,
      user_email: userEmail,
      agency_id: data.is_shared ? agencyId : undefined
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxContacts'] });
      setShowForm(false);
      setNewContact({ name: "", fax_number: "", company: "", department: "", notes: "", is_shared: false });
      toast.success("Contact added");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FaxContact.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxContacts'] });
      toast.success("Contact deleted");
    }
  });

  const toggleFavorite = useMutation({
    mutationFn: ({ id, is_favorite }) => base44.entities.FaxContact.update(id, { is_favorite: !is_favorite }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['faxContacts'] })
  });

  const filtered = contacts.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.fax_number.includes(search) ||
    (c.company || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Card>
      <CardHeader className="pb-2 p-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Address Book ({contacts.length})
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            {showForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-2">
        {showForm && (
          <div className="bg-slate-50 rounded-lg p-3 space-y-2 border">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Name *</Label>
                <Input value={newContact.name} onChange={e => setNewContact({...newContact, name: e.target.value})} placeholder="Dr. Smith" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Fax Number *</Label>
                <Input value={newContact.fax_number} onChange={e => setNewContact({...newContact, fax_number: e.target.value})} placeholder="(555) 123-4567" className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Company</Label>
                <Input value={newContact.company} onChange={e => setNewContact({...newContact, company: e.target.value})} placeholder="Hospital" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Department</Label>
                <Input value={newContact.department} onChange={e => setNewContact({...newContact, department: e.target.value})} placeholder="Records" className="h-9 text-sm" />
              </div>
            </div>
            {agencyId && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={newContact.is_shared} onChange={e => setNewContact({...newContact, is_shared: e.target.checked})} className="rounded" />
                <Building2 className="w-3 h-3" /> Share with agency
              </label>
            )}
            <Button size="sm" onClick={() => createMutation.mutate(newContact)} disabled={!newContact.name || !newContact.fax_number} className="w-full">
              Save Contact
            </Button>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts..." className="h-8 text-xs pl-7" />
        </div>

        <div className="max-h-60 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No contacts yet</p>
          ) : filtered.map(contact => (
            <div
              key={contact.id}
              className="flex items-center gap-2 p-2 rounded-lg border hover:bg-blue-50 cursor-pointer transition-colors group"
              onClick={() => onSelectContact(contact)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-medium truncate">{contact.name}</p>
                  {contact.is_shared && <Badge className="text-[8px] px-1 py-0 bg-purple-100 text-purple-700">Shared</Badge>}
                  {contact.is_favorite && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                </div>
                <p className="text-[10px] text-slate-500 flex items-center gap-1">
                  <Phone className="w-2.5 h-2.5" /> {contact.fax_number}
                  {contact.company && <span>· {contact.company}</span>}
                </p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={e => { e.stopPropagation(); toggleFavorite.mutate({ id: contact.id, is_favorite: contact.is_favorite }); }}>
                  <Star className={`w-3 h-3 ${contact.is_favorite ? 'text-yellow-500 fill-yellow-500' : 'text-slate-400'}`} />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={e => { e.stopPropagation(); deleteMutation.mutate(contact.id); }}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}