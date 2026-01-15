import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Star, StarOff, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

export default function NoteTemplateSelector({ visitType, providerType, onSelectTemplate }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["noteTemplates", visitType, providerType],
    queryFn: async () => {
      const allTemplates = await base44.entities.NoteTemplate.filter({
        visit_type: visitType,
        provider_type: providerType
      });
      return allTemplates;
    },
    enabled: !!visitType && !!providerType
  });

  const handleSelectTemplate = (template) => {
    setSelectedTemplateId(template.id);
    
    // Build formatted text from template sections
    const formattedNote = template.sections
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(section => `${section.section_name}:\n${section.template_text}\n`)
      .join('\n');
    
    onSelectTemplate(formattedNote, template);
    toast.success(`Template "${template.name}" loaded`);
  };

  if (!visitType || !providerType) return null;

  return (
    <Card className="border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20">
      <CardHeader className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            Clinical Note Templates
            {templates.length > 0 && (
              <Badge variant="outline" className="ml-2">
                {templates.length} available
              </Badge>
            )}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>
      
      {expanded && (
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-600">Loading templates...</p>
          ) : templates.length === 0 ? (
            <div className="text-sm text-slate-600">
              <p>No templates available for this visit type and provider type.</p>
              <p className="text-xs mt-1">You can create custom templates from the Template Library.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedTemplateId === template.id
                      ? 'border-indigo-500 bg-indigo-100 dark:bg-indigo-900/30'
                      : 'border-slate-200 bg-white dark:bg-slate-900 hover:border-indigo-300'
                  }`}
                  onClick={() => handleSelectTemplate(template)}
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1">
                      <h4 className="font-medium text-sm flex items-center gap-2">
                        {template.name}
                        {template.is_system_template && (
                          <Badge variant="outline" className="text-xs">System</Badge>
                        )}
                        {template.is_favorite && (
                          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                        )}
                      </h4>
                      {template.description && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          {template.description}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {template.diagnosis_tags?.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {template.diagnosis_tags.map((tag, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                  
                  <div className="mt-2 text-xs text-slate-500">
                    Sections: {template.sections?.length || 0}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}