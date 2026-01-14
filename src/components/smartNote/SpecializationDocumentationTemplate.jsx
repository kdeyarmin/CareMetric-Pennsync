import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Copy, Loader2, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function SpecializationDocumentationTemplate({
  providerEmail,
  specialtyCode,
  diagnosis,
  visitType,
  onTemplateApplied
}) {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generatingContent, setGeneratingContent] = useState(false);
  const [filledSections, setFilledSections] = useState({});

  useEffect(() => {
    if (specialtyCode) {
      loadTemplates();
    }
  }, [specialtyCode]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const results = await base44.entities.DocumentationTemplate.filter({
        specialty_code: specialtyCode,
        is_active: true
      });
      setTemplates(results);
      if (results.length > 0) {
        setSelectedTemplate(results[0]);
        setFilledSections({});
      }
    } catch (error) {
      console.error('Error loading templates:', error);
    }
    setLoading(false);
  };

  const generateSectionContent = async (section) => {
    setGeneratingContent(true);
    try {
      const prompt = `You are a medical documentation expert for ${specialtyCode} specialization.
      
Generate concise clinical documentation for the following section:
Section: ${section.section_name}
Diagnosis: ${diagnosis}
Visit Type: ${visitType}
Guidance: ${section.prompt}

Provide 2-3 sentences of realistic clinical content that follows best practices for ${specialtyCode} documentation.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            content: { type: 'string' }
          }
        }
      });

      setFilledSections(prev => ({
        ...prev,
        [section.section_name]: result.content || ''
      }));
    } catch (error) {
      console.error('Error generating content:', error);
      toast.error('Failed to generate section content');
    }
    setGeneratingContent(false);
  };

  const applyTemplateToNote = () => {
    if (!selectedTemplate || Object.keys(filledSections).length === 0) {
      toast.error('Please generate content for at least one section');
      return;
    }

    const templateContent = selectedTemplate.sections
      .map(section => {
        const content = filledSections[section.section_name];
        return `## ${section.section_name}\n${content || `[${section.placeholder}]`}`;
      })
      .join('\n\n');

    onTemplateApplied?.(templateContent);
    toast.success('Template applied to note');
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm text-gray-600">Loading templates...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (templates.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="w-5 h-5 text-blue-600" />
          Documentation Template
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Template Selection */}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">
            Select Template
          </label>
          <select
            value={selectedTemplate?.id || ''}
            onChange={(e) => {
              const template = templates.find(t => t.id === e.target.value);
              setSelectedTemplate(template);
              setFilledSections({});
            }}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          >
            {templates.map(template => (
              <option key={template.id} value={template.id}>
                {template.template_name}
              </option>
            ))}
          </select>
        </div>

        {selectedTemplate && (
          <>
            {/* Key Elements */}
            {selectedTemplate.key_elements?.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-blue-900 mb-2">
                  Key Elements to Document:
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedTemplate.key_elements.map((element, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs bg-white">
                      {element}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Sections */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">
                Template Sections ({selectedTemplate.sections?.length})
              </p>
              <Tabs defaultValue={selectedTemplate.sections?.[0]?.section_name} className="w-full">
                <TabsList className="grid w-full gap-1 bg-gray-100 p-1">
                  {selectedTemplate.sections?.map((section, idx) => (
                    <TabsTrigger
                      key={idx}
                      value={section.section_name}
                      className="text-xs"
                    >
                      {filledSections[section.section_name] ? '✓' : '○'} {section.section_name}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {selectedTemplate.sections?.map((section) => (
                  <TabsContent key={section.section_name} value={section.section_name} className="space-y-3 mt-3">
                    <div className="bg-gray-50 border rounded-lg p-3 space-y-2">
                      <p className="text-xs text-gray-600">{section.prompt}</p>
                      {section.required && (
                        <Badge className="bg-red-100 text-red-800 text-xs">Required</Badge>
                      )}
                    </div>

                    <textarea
                      value={filledSections[section.section_name] || ''}
                      onChange={(e) =>
                        setFilledSections(prev => ({
                          ...prev,
                          [section.section_name]: e.target.value
                        }))
                      }
                      placeholder={section.placeholder}
                      className="w-full h-24 p-2 border rounded text-sm resize-none"
                    />

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => generateSectionContent(section)}
                      disabled={generatingContent}
                      className="w-full gap-1"
                    >
                      {generatingContent ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          AI Generate
                        </>
                      )}
                    </Button>
                  </TabsContent>
                ))}
              </Tabs>
            </div>

            {/* Apply Button */}
            <Button
              onClick={applyTemplateToNote}
              disabled={Object.keys(filledSections).length === 0}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              <Copy className="w-4 h-4 mr-2" />
              Apply Template to Note
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}