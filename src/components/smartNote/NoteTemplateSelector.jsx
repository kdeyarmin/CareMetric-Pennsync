import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Star, Copy, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function NoteTemplateSelector({ 
  visitType, 
  providerType, 
  onTemplateSelect,
  onTemplateApply 
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [editingTemplate, setEditingTemplate] = useState(null);

  const { data: templates = [] } = useQuery({
    queryKey: ['templates', visitType, providerType],
    queryFn: async () => {
      const results = await base44.entities.NoteTemplate.filter({
        visit_type: visitType,
        provider_type: providerType
      });
      return results.sort((a, b) => (b.is_favorite - a.is_favorite));
    },
    enabled: !!visitType && !!providerType
  });

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  const handleApplyTemplate = () => {
    if (!selectedTemplate) {
      toast.error('Select a template first');
      return;
    }
    onTemplateApply(selectedTemplate);
    toast.success(`Applied template: ${selectedTemplate.name}`);
  };

  const handleToggleFavorite = async (templateId) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      await base44.entities.NoteTemplate.update(templateId, {
        is_favorite: !template.is_favorite
      });
    }
  };

  const handleDeleteTemplate = async (templateId) => {
    if (window.confirm('Delete this template?')) {
      await base44.entities.NoteTemplate.delete(templateId);
      toast.success('Template deleted');
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Note Templates</CardTitle>
        <p className="text-xs text-gray-600 mt-1">Select a template to auto-populate sections</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
          <SelectTrigger className="h-10 text-sm">
            <SelectValue placeholder="Choose a template..." />
          </SelectTrigger>
          <SelectContent>
            {templates.map(template => (
              <SelectItem key={template.id} value={template.id} className="text-sm">
                {template.is_favorite && '⭐ '}{template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedTemplate && (
          <div className="space-y-3">
            <p className="text-xs text-gray-600">{selectedTemplate.description}</p>
            
            <div className="space-y-2 max-h-48 overflow-y-auto bg-gray-50 p-3 rounded">
              {selectedTemplate.sections?.map((section, idx) => (
                <div key={idx} className="text-xs border-b last:border-b-0 pb-2">
                  <p className="font-semibold text-gray-700">{section.section_name}</p>
                  <p className="text-gray-600 whitespace-pre-wrap">{section.template_text}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleApplyTemplate}
                size="sm"
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                <Copy className="w-3 h-3 mr-1" /> Apply Template
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleToggleFavorite(selectedTemplate.id)}
              >
                <Star className={`w-3 h-3 ${selectedTemplate.is_favorite ? 'fill-yellow-400' : ''}`} />
              </Button>
            </div>
          </div>
        )}

        {templates.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">No templates for this visit type</p>
        )}
      </CardContent>
    </Card>
  );
}