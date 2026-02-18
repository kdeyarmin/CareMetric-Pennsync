import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import { Users, Plus, X, Loader2, Send, CheckCircle2, AlertCircle, List, UserPlus } from "lucide-react";
import { toast } from "sonner";

export default function BatchFaxDialog({ open, onOpenChange, documents, coverData, fromFaxNumber, userEmail }) {
  const [recipients, setRecipients] = useState([{ name: "", number: "" }]);
  const [selectedGroupContacts, setSelectedGroupContacts] = useState([]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);

  const addRecipient = () => {
    setRecipients([...recipients, { name: "", number: "" }]);
  };

  const removeRecipient = (idx) => {
    setRecipients(recipients.filter((_, i) => i !== idx));
  };

  const updateRecipient = (idx, field, value) => {
    const updated = [...recipients];
    updated[idx][field] = value;
    setRecipients(updated);
  };

  const { data: contactGroups = [] } = useQuery({
    queryKey: ['faxContactGroups', userEmail],
    queryFn: () => base44.entities.FaxContactGroup.filter({ user_email: userEmail }),
    enabled: !!userEmail && open
  });

  const { data: allContacts = [] } = useQuery({
    queryKey: ['faxContacts', userEmail],
    queryFn: () => base44.entities.FaxContact.filter({ user_email: userEmail }),
    enabled: !!userEmail && open
  });

  const validRecipients = [
    ...recipients.filter(r => r.number.trim()),
    ...selectedGroupContacts
  ];

  const handleSend = async () => {
    if (validRecipients.length === 0) {
      toast.error("Add at least one recipient with a fax number");
      return;
    }
    if (documents.length === 0) {
      toast.error("No documents to send");
      return;
    }

    setSending(true);
    const mediaUrls = documents.map(d => d.url);

    const { data } = await base44.functions.invoke('sendBatchFax', {
      to_numbers: validRecipients.map(r => ({ number: r.number, name: r.name })),
      media_urls: mediaUrls,
      document_name: documents[0]?.name || 'Documents',
      cover_page_details: coverData || {},
      from_fax_number: fromFaxNumber || undefined
    });

    setResults(data);
    setSending(false);

    if (data?.success) {
      toast.success(`Batch sent: ${data.success_count} succeeded, ${data.failure_count} failed`);
    } else {
      toast.error(data?.error || "Batch send failed");
    }
  };

  const handleClose = () => {
    setResults(null);
    setRecipients([{ name: "", number: "" }]);
    onOpenChange(false);
  };

  const toggleGroupContact = (contact) => {
    setSelectedGroupContacts(prev => {
      const exists = prev.find(c => c.number === contact.fax_number);
      if (exists) {
        return prev.filter(c => c.number !== contact.fax_number);
      } else {
        return [...prev, { name: contact.name, number: contact.fax_number }];
      }
    });
  };

  const selectAllFromGroup = (group) => {
    const groupContacts = allContacts.filter(c => group.contact_ids?.includes(c.id));
    const newContacts = groupContacts.map(c => ({ name: c.name, number: c.fax_number }));
    setSelectedGroupContacts(prev => {
      const existing = prev.filter(pc => !newContacts.find(nc => nc.number === pc.number));
      return [...existing, ...newContacts];
    });
    toast.success(`Added ${groupContacts.length} contacts from ${group.group_name}`);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Batch Fax — Send to Multiple Recipients
          </DialogTitle>
          <DialogDescription>
            Send the same {documents.length} document{documents.length !== 1 ? "s" : ""} to multiple fax numbers at once.
          </DialogDescription>
        </DialogHeader>

        {!results ? (
          <Tabs defaultValue="manual" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-3">
              <TabsTrigger value="manual" className="text-xs gap-1">
                <UserPlus className="w-3 h-3" /> Manual Entry
              </TabsTrigger>
              <TabsTrigger value="groups" className="text-xs gap-1">
                <Users className="w-3 h-3" /> Contact Groups
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="space-y-3">
            {recipients.map((r, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={r.name}
                    onChange={e => updateRecipient(i, 'name', e.target.value)}
                    placeholder="Dr. Smith"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Fax Number *</Label>
                  <Input
                    value={r.number}
                    onChange={e => updateRecipient(i, 'number', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="h-9 text-sm"
                    type="tel"
                  />
                </div>
                {recipients.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeRecipient(i)}>
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
            ))}

            <Button variant="outline" size="sm" className="w-full gap-1 text-xs" onClick={addRecipient}>
              <Plus className="w-3 h-3" /> Add Recipient
            </Button>
            </TabsContent>

            <TabsContent value="groups" className="space-y-3">
              {contactGroups.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">No contact groups yet.</p>
                  <p className="text-xs text-slate-400">Create groups in the Address Book to quickly send to multiple contacts.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {contactGroups.map(group => {
                    const groupContacts = allContacts.filter(c => group.contact_ids?.includes(c.id));
                    return (
                      <div key={group.id} className="border rounded-lg p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{group.group_name}</p>
                            <p className="text-xs text-slate-500">{groupContacts.length} contacts</p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => selectAllFromGroup(group)}
                          >
                            Select All
                          </Button>
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {groupContacts.map(contact => {
                            const isSelected = selectedGroupContacts.find(c => c.number === contact.fax_number);
                            return (
                              <label key={contact.id} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer">
                                <Checkbox
                                  checked={!!isSelected}
                                  onCheckedChange={() => toggleGroupContact(contact)}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium truncate">{contact.name}</p>
                                  <p className="text-xs text-slate-500 truncate">{contact.fax_number}</p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <div className="flex justify-between items-center pt-3 border-t">
              <p className="text-xs text-slate-500">
                {validRecipients.length} recipient{validRecipients.length !== 1 ? "s" : ""}
                {selectedGroupContacts.length > 0 && ` (${selectedGroupContacts.length} from groups)`}
              </p>
              <Button onClick={handleSend} disabled={sending || validRecipients.length === 0} className="gap-2">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? "Sending..." : `Send to ${validRecipients.length}`}
              </Button>
            </div>
          </Tabs>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50">
              <div>
                <p className="text-sm font-medium">Batch ID: <span className="font-mono text-xs">{results.batch_id}</span></p>
                <p className="text-xs text-slate-500">
                  {results.success_count} sent, {results.failure_count} failed
                  {results.priority && results.priority !== 'normal' && ` • Priority: ${results.priority}`}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              {results.results?.map((r, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded border text-xs">
                  <div>
                    <p className="font-medium">{r.name || r.recipient}</p>
                    <p className="text-slate-500">{r.recipient}</p>
                  </div>
                  {r.status === 'sent' ? (
                    <Badge className="bg-green-100 text-green-700 text-[10px]">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Sent
                    </Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-700 text-[10px]">
                      <AlertCircle className="w-3 h-3 mr-1" /> Failed
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            <Button onClick={handleClose} variant="outline" className="w-full">Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}