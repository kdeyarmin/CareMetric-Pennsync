import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Users, Plus, Trash2, Send, Star } from "lucide-react";
import { toast } from "sonner";

export default function ContactGroupManager({ userEmail, onSendToGroup }) {
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [selectedContacts, setSelectedContacts] = useState([]);

  const { data: groups = [] } = useQuery({
    queryKey: ['faxContactGroups', userEmail],
    queryFn: () => base44.entities.FaxContactGroup.filter({ user_email: userEmail }),
    enabled: !!userEmail
  });

  const { data: allContacts = [] } = useQuery({
    queryKey: ['faxContacts', userEmail],
    queryFn: () => base44.entities.FaxContact.filter({ user_email: userEmail }),
    enabled: !!userEmail
  });

  const createGroupMutation = useMutation({
    mutationFn: (data) => base44.entities.FaxContactGroup.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxContactGroups'] });
      resetForm();
      toast.success("Contact group created");
    }
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id) => base44.entities.FaxContactGroup.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxContactGroups'] });
      toast.success("Group deleted");
    }
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ id, isFavorite }) => 
      base44.entities.FaxContactGroup.update(id, { is_favorite: !isFavorite }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxContactGroups'] });
    }
  });

  const resetForm = () => {
    setShowCreateDialog(false);
    setGroupName("");
    setGroupDescription("");
    setSelectedContacts([]);
  };

  const handleCreateGroup = () => {
    if (!groupName.trim()) {
      toast.error("Group name is required");
      return;
    }
    if (selectedContacts.length === 0) {
      toast.error("Add at least one contact");
      return;
    }

    createGroupMutation.mutate({
      user_email: userEmail,
      group_name: groupName,
      description: groupDescription,
      contact_ids: selectedContacts,
      tags: []
    });
  };

  const getGroupContacts = (group) => {
    return allContacts.filter(c => group.contact_ids?.includes(c.id));
  };

  return (
    <Card>
      <CardHeader className="pb-3 p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4" />
            Contact Groups
          </CardTitle>
          <Button size="sm" onClick={() => setShowCreateDialog(true)} className="h-7 text-xs gap-1">
            <Plus className="w-3 h-3" /> New Group
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 pt-0">
        {groups.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No groups yet. Create one to send faxes to multiple contacts.</p>
        ) : (
          <div className="space-y-2">
            {groups.map(group => {
              const contacts = getGroupContacts(group);
              return (
                <div key={group.id} className="flex items-center gap-2 p-2 rounded-lg border bg-white hover:border-blue-300 transition-colors">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => toggleFavoriteMutation.mutate({ id: group.id, isFavorite: group.is_favorite })}
                  >
                    <Star className={`w-3.5 h-3.5 ${group.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-slate-400'}`} />
                  </Button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{group.group_name}</p>
                    <p className="text-xs text-slate-500">{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => onSendToGroup?.(contacts)}
                  >
                    <Send className="w-3 h-3" /> Send
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-red-500 hover:text-red-700"
                    onClick={() => {
                      if (confirm(`Delete "${group.group_name}"?`)) {
                        deleteGroupMutation.mutate(group.id);
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Create Group Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Contact Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Group Name *</Label>
              <Input
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="e.g. Local Hospitals"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input
                value={groupDescription}
                onChange={e => setGroupDescription(e.target.value)}
                placeholder="Description..."
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs mb-2 block">Select Contacts ({selectedContacts.length})</Label>
              <div className="border rounded-lg max-h-48 overflow-y-auto p-2 space-y-1.5">
                {allContacts.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-3">No contacts saved. Add contacts in the Address Book first.</p>
                ) : (
                  allContacts.map(contact => (
                    <label key={contact.id} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer">
                      <Checkbox
                        checked={selectedContacts.includes(contact.id)}
                        onCheckedChange={(checked) => {
                          setSelectedContacts(prev =>
                            checked ? [...prev, contact.id] : prev.filter(id => id !== contact.id)
                          );
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{contact.name}</p>
                        <p className="text-xs text-slate-500 truncate">{contact.fax_number}</p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={resetForm} size="sm">Cancel</Button>
            <Button onClick={handleCreateGroup} disabled={createGroupMutation.isPending} size="sm">
              {createGroupMutation.isPending ? "Creating..." : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}