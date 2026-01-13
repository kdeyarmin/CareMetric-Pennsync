import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, CheckCircle2, Lightbulb } from "lucide-react";
import { toast } from "sonner";

export default function LearnMyFormat({ 
  originalNote, 
  editedNote, 
  visitType, 
  providerType,
  diagnosis,
  onTemplateSaved 
}) {
  const [showLearnDialog, setShowLearnDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedFormat, setExtractedFormat] = useState(null);

  // Detect if user has made significant edits
  const hasSignificantEdits = editedNote && originalNote && 
    editedNote !== originalNote && 
    editedNote.length > 100;

  const analyzeFormat = async () => {
    setIsAnalyzing(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze how this clinician edited the AI-generated note to understand their preferred format and style.

ORIGINAL AI NOTE:
${originalNote}

CLINICIAN'S EDITED VERSION:
${editedNote}

Analyze the edits to extract:
1. Structural preferences (sections added/removed, order changes)
2. Phrasing preferences (clinical language style, terminology choices)
3. Level of detail preferences (verbose vs concise)
4. Format preferences (bullets vs paragraphs, headers, etc.)

Create a reusable template structure with section names and example text that captures this provider's style.

Return JSON:
{
  "sections": [
    {"section_name": "Section Name", "template_text": "Example format/phrasing", "order": 1}
  ],
  "style_notes": "Brief description of provider's preferred style",
  "key_changes": ["Change 1", "Change 2"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  section_name: { type: "string" },
                  template_text: { type: "string" },
                  order: { type: "number" }
                }
              }
            },
            style_notes: { type: "string" },
            key_changes: { type: "array", items: { type: "string" } }
          }
        }
      });

      setExtractedFormat(result);
      setTemplateDescription(result.style_notes || "Custom template learned from my edits");
      setShowLearnDialog(true);
    } catch (error) {
      toast.error("Failed to analyze format");
    }
    setIsAnalyzing(false);
  };

  const saveAsTemplate = async () => {
    if (!templateName.trim() || !extractedFormat) {
      toast.error("Please enter a template name");
      return;
    }

    try {
      const newTemplate = await base44.entities.NoteTemplate.create({
        name: templateName,
        visit_type: visitType,
        provider_type: providerType,
        diagnosis_tags: diagnosis ? [diagnosis.split(' ')[0]] : [],
        sections: extractedFormat.sections,
        description: templateDescription,
        is_system_template: false,
        is_favorite: true
      });

      toast.success(`Template "${templateName}" saved! ⭐`);
      setShowLearnDialog(false);
      setTemplateName("");
      onTemplateSaved?.(newTemplate);
    } catch (error) {
      toast.error("Failed to save template");
    }
  };

  if (!hasSignificantEdits) return null;

  if (!showLearnDialog) {
    return (
      <Alert className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <Lightbulb className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-sm">
          <div className="flex items-center justify-between">
            <span className="text-blue-900">You've customized this note! Want Freed to learn your format?</span>
            <Button 
              size="sm" 
              onClick={analyzeFormat}
              disabled={isAnalyzing}
              className="bg-blue-600 hover:bg-blue-700 ml-2"
            >
              {isAnalyzing ? (
                <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1" /> Analyzing...</>
              ) : (
                <><Sparkles className="w-3 h-3 mr-1" /> Learn My Format</>
              )}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-2 border-blue-400 bg-gradient-to-br from-blue-50 to-indigo-50">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-600" />
          Save Your Format as Template
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-white rounded-lg p-3 space-y-2">
          <p className="text-sm font-semibold text-gray-900">Detected Changes:</p>
          <ul className="space-y-1 text-xs text-gray-700">
            {extractedFormat?.key_changes?.slice(0, 4).map((change, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <CheckCircle2 className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                <span>{change}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium mb-1 block">Template Name</label>
            <Input
              placeholder="e.g., My CHF Routine Visit Format"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <Textarea
              placeholder="Describe when to use this template..."
              value={templateDescription}
              onChange={(e) => setTemplateDescription(e.target.value)}
              className="h-20"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={saveAsTemplate}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Save Template
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowLearnDialog(false)}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}