import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Edit3, Save, X, Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export default function CustomPhrasesManager({ onInsertPhrase, compact = false }) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ trigger: '', phrase: '', category: 'general' });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const customPhrases = currentUser?.custom_phrases || [];

  const handleSave = async () => {
    if (!formData.trigger || !formData.phrase) return;

    try {
      const updatedPhrases = editingId
        ? customPhrases.map(p => p.id === editingId ? { ...formData, id: editingId } : p)
        : [...customPhrases, { ...formData, id: Date.now().toString() }];

      await base44.auth.updateMe({ custom_phrases: updatedPhrases });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      setIsAdding(false);
      setEditingId(null);
      setFormData({ trigger: '', phrase: '', category: 'general' });
    } catch (error) {
      console.error('Error saving phrase:', error);
    }
  };

  const handleDelete = async (id) => {
    try {
      const updatedPhrases = customPhrases.filter(p => p.id !== id);
      await base44.auth.updateMe({ custom_phrases: updatedPhrases });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    } catch (error) {
      console.error('Error deleting phrase:', error);
    }
  };

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-semibold">Quick Phrases</Label>
          <Button size="sm" variant="outline" onClick={() => setIsAdding(!isAdding)} className="h-7 text-xs">
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
        </div>
        {isAdding && (
          <div className="space-y-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <Input
              placeholder="Trigger (e.g., lungs)"
              value={formData.trigger}
              onChange={(e) => setFormData({ ...formData, trigger: e.target.value })}
              className="h-8 text-xs"
            />
            <Textarea
              placeholder="Phrase to insert..."
              value={formData.phrase}
              onChange={(e) => setFormData({ ...formData, phrase: e.target.value })}
              className="text-xs h-20"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} className="h-7 text-xs bg-blue-600">
                <Save className="w-3 h-3 mr-1" /> Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsAdding(false)} className="h-7 text-xs">
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-1">
          {customPhrases.slice(0, 5).map((phrase) => (
            <Button
              key={phrase.id}
              size="sm"
              variant="outline"
              onClick={() => onInsertPhrase?.(phrase.phrase)}
              className="w-full justify-start text-xs h-8"
            >
              <Zap className="w-3 h-3 mr-1" />
              {phrase.trigger}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-600" />
            My Custom Phrases
          </CardTitle>
          <Button size="sm" onClick={() => setIsAdding(!isAdding)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Phrase
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdding && (
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4 space-y-3">
              <div>
                <Label>Trigger Word</Label>
                <Input
                  placeholder="e.g., lungs, wound, chf"
                  value={formData.trigger}
                  onChange={(e) => setFormData({ ...formData, trigger: e.target.value })}
                />
              </div>
              <div>
                <Label>Phrase Text</Label>
                <Textarea
                  placeholder="The full phrase to insert when triggered..."
                  value={formData.phrase}
                  onChange={(e) => setFormData({ ...formData, phrase: e.target.value })}
                  className="h-24"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSave} className="bg-blue-600">
                  <Save className="w-4 h-4 mr-2" /> Save
                </Button>
                <Button variant="outline" onClick={() => {
                  setIsAdding(false);
                  setFormData({ trigger: '', phrase: '', category: 'general' });
                }}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-2">
          {customPhrases.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              No custom phrases yet. Add your frequently used phrases for quick access.
            </p>
          ) : (
            customPhrases.map((phrase) => (
              <Card key={phrase.id} className="border-l-4 border-l-purple-500">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <Badge variant="outline" className="mb-2">{phrase.trigger}</Badge>
                      <p className="text-sm text-gray-700">{phrase.phrase}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onInsertPhrase?.(phrase.phrase)}
                        className="h-8"
                      >
                        <Zap className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(phrase.id)}
                        className="h-8 text-red-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}