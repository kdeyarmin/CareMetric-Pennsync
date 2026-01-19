import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function AITemplateGenerator({ onGenerateComplete }) {
  const [isLoading, setIsLoading] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [description, setDescription] = useState("");
  const [documentType, setDocumentType] = useState("consent_form");
  const [generatedContent, setGeneratedContent] = useState(null);

  const generateTemplate = async () => {
    if (!templateName || !description) {
      toast.error("Enter template name and description");
      return;
    }

    setIsLoading(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Create a professional ${documentType.replace(/_/g, " ")} document template.

Template Name: ${templateName}
Description: ${description}

Generate comprehensive HTML content with:
1. Professional formatting and structure
2. Clear sections and paragraphs
3. Include placeholders like {{patient_name}}, {{date}}, {{provider_name}} where appropriate
4. Professional language suitable for healthcare

Return ONLY the HTML content wrapped in a div, no explanations.`,
        response_json_schema: {
          type: "object",
          properties: {
            html_content: { type: "string" },
            suggested_placeholders: {
              type: "array",
              items: { type: "string" },
            },
            suggested_signature_fields: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      });

      setGeneratedContent({
        html: response.html_content,
        placeholders: response.suggested_placeholders || [],
        signatureFields: response.suggested_signature_fields || [],
      });
      toast.success("Template generated successfully");
    } catch (error) {
      toast.error("Failed to generate template");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseTemplate = () => {
    if (!generatedContent) return;

    onGenerateComplete?.({
      template_name: templateName,
      description: description,
      document_type: documentType,
      content: generatedContent.html,
      placeholders: generatedContent.placeholders.map((key) => ({
        key: key.toLowerCase().replace(/\s+/g, "_"),
        label: key,
        type: "text",
        required: true,
      })),
      signature_fields: generatedContent.signatureFields.map((label, idx) => ({
        field_id: `sig_${idx}`,
        label,
        required_role: idx === 0 ? "patient" : "provider",
        date_field: true,
        optional: false,
      })),
    });

    setGeneratedContent(null);
    setTemplateName("");
    setDescription("");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            AI Template Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Template Name *
            </label>
            <Input
              placeholder="e.g., Telehealth Consent"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              What should this template include? *
            </label>
            <Textarea
              placeholder="Describe the key elements, purpose, and any specific requirements for this document..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
              className="h-32"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Document Type
            </label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 border rounded-md text-sm"
            >
              <option value="consent_form">Consent Form</option>
              <option value="agreement">Agreement</option>
              <option value="authorization">Authorization</option>
              <option value="disclosure">Disclosure</option>
            </select>
          </div>

          <Button
            onClick={generateTemplate}
            disabled={isLoading}
            className="w-full gap-2"
          >
            {isLoading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Template
              </>
            )}
          </Button>

          {generatedContent && (
            <div className="border-t pt-4 space-y-3">
              <div className="bg-blue-50 p-3 rounded max-h-64 overflow-y-auto">
                <p className="text-xs font-medium text-gray-600 mb-2">
                  Generated Content Preview:
                </p>
                <div
                  className="prose prose-sm max-w-none text-xs"
                  dangerouslySetInnerHTML={{
                    __html: generatedContent.html.substring(0, 500) + "...",
                  }}
                />
              </div>

              {generatedContent.placeholders.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">
                    Detected Placeholders:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {generatedContent.placeholders.map((ph) => (
                      <Badge key={ph} variant="secondary" className="text-xs">
                        {`{{${ph}}}`}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Button onClick={handleUseTemplate} className="w-full">
                Use This Template
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}