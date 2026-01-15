import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Plus, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function CollaborationPanel({ carePlan, patientId }) {
  const queryClient = useQueryClient();
  const [showAddCollaborator, setShowAddCollaborator] = useState(false);
  const [showAddNote, setShowAddNote] = useState(null);
  const [newCollaborator, setNewCollaborator] = useState({
    email: "",
    name: "",
    provider_type: "RN",
    role: "collaborator",
    contribution: ""
  });
  const [newNote, setNewNote] = useState("");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: collaborators = [] } = useQuery({
    queryKey: ['carePlanCollaborators', carePlan.id],
    queryFn: () => base44.entities.CarePlanCollaboration.filter({
      care_plan_id: carePlan.id,
      is_active: true
    })
  });

  const addCollaboratorMutation = useMutation({
    mutationFn: (data) => base44.entities.CarePlanCollaboration.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carePlanCollaborators'] });
      
      // Update care plan collaborators list
      const currentCollabs = carePlan.collaborators || [];
      base44.entities.CarePlan.update(carePlan.id, {
        collaborators: [...currentCollabs, newCollaborator.email]
      });
      
      toast.success("Collaborator added");
      setShowAddCollaborator(false);
      setNewCollaborator({
        email: "",
        name: "",
        provider_type: "RN",
        role: "collaborator",
        contribution: ""
      });
    }
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ collaboratorId, note }) => {
      const collaborator = collaborators.find(c => c.id === collaboratorId);
      const existingNotes = collaborator.notes || [];
      
      return base44.entities.CarePlanCollaboration.update(collaboratorId, {
        notes: [
          ...existingNotes,
          {
            date: new Date().toISOString(),
            note: note
          }
        ],
        last_updated: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carePlanCollaborators'] });
      toast.success("Note added");
      setShowAddNote(null);
      setNewNote("");
    }
  });

  const removeCollaboratorMutation = useMutation({
    mutationFn: (collaboratorId) => 
      base44.entities.CarePlanCollaboration.update(collaboratorId, { is_active: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carePlanCollaborators'] });
      toast.success("Collaborator removed");
    }
  });

  const handleAddCollaborator = () => {
    if (!newCollaborator.email || !newCollaborator.name) {
      toast.error("Email and name are required");
      return;
    }

    addCollaboratorMutation.mutate({
      care_plan_id: carePlan.id,
      patient_id: patientId,
      provider_email: newCollaborator.email,
      provider_name: newCollaborator.name,
      provider_type: newCollaborator.provider_type,
      role: newCollaborator.role,
      contribution: newCollaborator.contribution,
      added_date: new Date().toISOString(),
      is_active: true,
      notes: []
    });
  };

  const handleAddNote = (collaboratorId) => {
    if (!newNote.trim()) return;
    addNoteMutation.mutate({ collaboratorId, note: newNote });
  };

  const getRoleColor = (role) => {
    const colors = {
      owner: "bg-purple-100 text-purple-800",
      collaborator: "bg-blue-100 text-blue-800",
      viewer: "bg-gray-100 text-gray-800"
    };
    return colors[role] || colors.viewer;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4" />
            Collaborators ({collaborators.length})
          </CardTitle>
          <Button 
            size="sm" 
            onClick={() => setShowAddCollaborator(!showAddCollaborator)}
          >
            <Plus className="w-3 h-3 mr-1" />
            Add
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {/* Add Collaborator Form */}
        {showAddCollaborator && (
          <Card className="bg-blue-50 dark:bg-blue-950">
            <CardContent className="p-3 space-y-2">
              <Input
                placeholder="Provider email"
                value={newCollaborator.email}
                onChange={(e) => setNewCollaborator({...newCollaborator, email: e.target.value})}
                className="h-9 text-sm"
              />
              <Input
                placeholder="Provider name"
                value={newCollaborator.name}
                onChange={(e) => setNewCollaborator({...newCollaborator, name: e.target.value})}
                className="h-9 text-sm"
              />
              <Select
                value={newCollaborator.provider_type}
                onValueChange={(value) => setNewCollaborator({...newCollaborator, provider_type: value})}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RN">RN</SelectItem>
                  <SelectItem value="LPN">LPN</SelectItem>
                  <SelectItem value="NP">NP</SelectItem>
                  <SelectItem value="PHYSICIAN">Physician</SelectItem>
                  <SelectItem value="THERAPIST">Therapist</SelectItem>
                  <SelectItem value="MSW">MSW</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Focus area (e.g., PT evaluation, medication management)"
                value={newCollaborator.contribution}
                onChange={(e) => setNewCollaborator({...newCollaborator, contribution: e.target.value})}
                className="h-9 text-sm"
              />
              <Button onClick={handleAddCollaborator} size="sm" className="w-full">
                Add Collaborator
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Collaborators List */}
        {collaborators.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4">No collaborators yet</p>
        ) : (
          collaborators.map((collab) => (
            <Card key={collab.id} className="bg-gray-50 dark:bg-gray-900">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium truncate">{collab.provider_name}</p>
                      <Badge className={`${getRoleColor(collab.role)} text-xs`}>
                        {collab.provider_type}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {collab.contribution || "General collaboration"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeCollaboratorMutation.mutate(collab.id)}
                    className="text-red-600 h-6 w-6 p-0"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>

                {/* Collaborative Notes */}
                <div className="mt-2 space-y-2">
                  {collab.notes?.slice(-3).map((note, idx) => (
                    <div key={idx} className="bg-white dark:bg-gray-800 p-2 rounded text-xs">
                      <p className="text-gray-700 dark:text-gray-300">{note.note}</p>
                      <p className="text-gray-500 text-[10px] mt-1">
                        {format(new Date(note.date), 'MMM d, h:mm a')}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Add Note */}
                {showAddNote === collab.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Add a collaborative note..."
                      className="text-xs h-16"
                    />
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        onClick={() => handleAddNote(collab.id)}
                        className="flex-1"
                      >
                        Save
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => setShowAddNote(null)}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAddNote(collab.id)}
                    className="w-full mt-2 text-xs"
                  >
                    <MessageSquare className="w-3 h-3 mr-1" />
                    Add Note
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </CardContent>
    </Card>
  );
}