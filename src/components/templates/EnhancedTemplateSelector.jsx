import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ChevronRight } from "lucide-react";
import TemplateEducationSuggestions from "@/components/education/TemplateEducationSuggestions";

export default function EnhancedTemplateSelector({
  category,
  visitType,
  open,
  onOpenChange,
  onSelectTemplate,
  patientDiagnosis
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  const { data: templates = [] } = useQuery({
    queryKey: ['templates', category, visitType],
    queryFn: async () => {
      const allTemplates = await base44.entities.DocumentTemplate.filter({
        category,
        visit_type: visitType
      });
      return allTemplates || [];
    },
    enabled: !!(category && visitType)
  });

  const filtered = templates.filter(t =>
    t.template_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Select Template</DialogTitle>
        </DialogHeader>

        {!selectedTemplate ? (
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search templates..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Templates list */}
            <div className="space-y-2">
              {filtered.map((template) => (
                <Card
                  key={template.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setSelectedTemplate(template)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <h4 className="font-medium text-slate-900">{template.template_name}</h4>
                        <p className="text-sm text-slate-600 mt-1">{template.description}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {template.tags?.map(tag => (
                            <Badge key={tag} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Back button and template name */}
            <div>
              <Button
                variant="ghost"
                onClick={() => setSelectedTemplate(null)}
                className="mb-2"
              >
                ← Back
              </Button>
              <h3 className="text-lg font-semibold text-slate-900">
                {selectedTemplate.template_name}
              </h3>
              <p className="text-sm text-slate-600">{selectedTemplate.description}</p>
            </div>

            {/* Education suggestions */}
            <TemplateEducationSuggestions
              templateId={selectedTemplate.id}
              patientDiagnosis={patientDiagnosis}
            />

            {/* Template preview */}
            <Card className="bg-slate-50">
              <CardContent className="p-3">
                <p className="text-xs font-semibold text-slate-700 mb-2">Preview:</p>
                <div
                  className="text-xs text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto"
                  dangerouslySetInnerHTML={{
                    __html: selectedTemplate.content
                      .replace(/{{(\w+)}}/g, '<span class="bg-yellow-100 px-1 rounded">{{$1}}</span>')
                  }}
                />
              </CardContent>
            </Card>

            {/* Select button */}
            <Button
              onClick={() => {
                onSelectTemplate(selectedTemplate);
                onOpenChange(false);
              }}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              Use This Template
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}