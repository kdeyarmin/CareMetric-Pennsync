import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Plus, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";
import { LANGUAGES } from "./LanguageSelector";

export default function TerminologyGlossaryManager({ userEmail, selectedLanguage = "en" }) {
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState(null);
  const [formData, setFormData] = useState({
    term: "",
    preferred_translation: "",
    context: ""
  });

  const { data: glossary = [] } = useQuery({
    queryKey: ['terminologyGlossary', userEmail, selectedLanguage],
    queryFn: () => base44.entities.TerminologyGlossary.filter({
      user_email: userEmail,
      language: selectedLanguage,
      is_active: true
    }),
    enabled: !!userEmail
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TerminologyGlossary.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminologyGlossary'] });
      toast.success('Term added to glossary');
      setIsAddOpen(false);
      setFormData({ term: "", preferred_translation: "", context: "" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TerminologyGlossary.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminologyGlossary'] });
      toast.success('Term updated');
      setEditingTerm(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TerminologyGlossary.update(id, { is_active: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminologyGlossary'] });
      toast.success('Term removed');
    }
  });

  const handleSave = () => {
    if (!formData.term) {
      toast.error('Term is required');
      return;
    }

    if (editingTerm) {
      updateMutation.mutate({
        id: editingTerm.id,
        data: formData
      });
    } else {
      createMutation.mutate({
        user_email: userEmail,
        language: selectedLanguage,
        ...formData
      });
    }
  };

  const handleEdit = (term) => {
    setEditingTerm(term);
    setFormData({
      term: term.term,
      preferred_translation: term.preferred_translation || "",
      context: term.context || ""
    });
    setIsAddOpen(true);
  };

  const languageName = LANGUAGES.find(l => l.code === selectedLanguage)?.name || selectedLanguage;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-purple-600" />
            Medical Terminology ({languageName})
          </span>
          <Dialog open={isAddOpen} onOpenChange={(open) => {
            setIsAddOpen(open);
            if (!open) {
              setEditingTerm(null);
              setFormData({ term: "", preferred_translation: "", context: "" });
            }
          }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="w-4 h-4 mr-1" />
                Add Term
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingTerm ? 'Edit' : 'Add'} Medical Term</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Medical Term</Label>
                  <Input
                    placeholder="e.g., Blood pressure"
                    value={formData.term}
                    onChange={(e) => setFormData({ ...formData, term: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Preferred Translation/Phrasing</Label>
                  <Input
                    placeholder="e.g., Presión arterial"
                    value={formData.preferred_translation}
                    onChange={(e) => setFormData({ ...formData, preferred_translation: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Context (Optional)</Label>
                  <Textarea
                    placeholder="When to use this term..."
                    value={formData.context}
                    onChange={(e) => setFormData({ ...formData, context: e.target.value })}
                    className="h-20"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSave} className="flex-1">
                    Save
                  </Button>
                  <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {glossary.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-4">
            No custom terms yet. Add medical terminology to improve AI accuracy.
          </p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {glossary.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between p-2 bg-purple-50 rounded border border-purple-200">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-900">{entry.term}</p>
                  {entry.preferred_translation && (
                    <p className="text-xs text-purple-700 mt-1">→ {entry.preferred_translation}</p>
                  )}
                  {entry.context && (
                    <p className="text-xs text-gray-600 mt-1 italic">{entry.context}</p>
                  )}
                </div>
                <div className="flex gap-1 ml-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleEdit(entry)}
                    className="h-7 w-7 p-0"
                  >
                    <Edit className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(entry.id)}
                    className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}