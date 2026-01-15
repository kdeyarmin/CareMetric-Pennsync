import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, FileText, ChevronDown, ChevronUp } from "lucide-react";

export default function CarePlanTemplateSelector({ diagnosis, providerType, onSelectTemplate }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  const { data: templates = [] } = useQuery({
    queryKey: ['carePlanTemplates', diagnosis, providerType],
    queryFn: async () => {
      const allTemplates = await base44.entities.CarePlanTemplate.filter({ is_active: true });
      return allTemplates.filter(t => 
        (!diagnosis || t.diagnosis === diagnosis) &&
        (!providerType || t.provider_types?.includes(providerType))
      );
    }
  });

  const handleSelect = (template) => {
    setSelectedTemplate(template);
    onSelectTemplate(template);
    setExpanded(false);
  };

  if (templates.length === 0) return null;

  return (
    <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950">
      <CardHeader className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-600" />
            Care Plan Templates ({templates.length})
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </CardHeader>
      
      {expanded && (
        <CardContent className="space-y-3">
          {templates.map((template) => (
            <Card 
              key={template.id}
              className={`cursor-pointer hover:border-purple-400 transition-colors ${
                selectedTemplate?.id === template.id ? 'border-purple-600 bg-purple-100 dark:bg-purple-900' : ''
              }`}
              onClick={() => handleSelect(template)}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm truncate">{template.template_name}</h4>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">{template.diagnosis}</p>
                    
                    <div className="space-y-1 text-xs">
                      <p><strong>Problem:</strong> {template.problem}</p>
                      <p><strong>Goal:</strong> {template.goal}</p>
                      <p className="text-gray-600 dark:text-gray-400">
                        {template.interventions?.length || 0} interventions • 
                        {template.target_days} day target
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    {template.is_system_template && (
                      <Badge variant="outline" className="text-xs">System</Badge>
                    )}
                    {selectedTemplate?.id === template.id && (
                      <Badge className="bg-purple-600 text-xs">Selected</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      )}
    </Card>
  );
}