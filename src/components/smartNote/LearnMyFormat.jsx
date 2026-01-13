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
      // Use the advanced pattern analysis function
      const currentUser = await base44.auth.me();
      const response = await base44.functions.invoke('analyzeEditPatterns', {
        original_note: originalNote,
        edited_note: editedNote,
        visit_type: visitType,
        diagnosis: diagnosis,
        provider_type: providerType
      });

      const result = response.data || response;

      if (!result.success) {
        throw new Error(result.error || 'Analysis failed');
      }

      // Convert patterns to template format
      const templateFormat = {
        sections: result.patterns.section_order?.map((section, idx) => ({
          section_name: section,
          template_text: result.patterns.phrasing_examples?.find(p => p.category === section)?.example || '',
          order: idx + 1
        })) || [],
        style_notes: result.patterns.overall_style_summary || "Learned from my edits",
        key_changes: [
          ...(result.patterns.added_elements || []).map(e => `Always includes: ${e}`),
          ...(result.patterns.removed_elements || []).map(e => `Avoids: ${e}`),
          ...(result.patterns.terminology_preferences || []).slice(0, 3).map(t => `Uses "${t.preferred_term}" instead of "${t.ai_term}"`)
        ]
      };

      setExtractedFormat(templateFormat);
      setTemplateDescription(result.patterns.overall_style_summary || "Custom template learned from my edits");
      setShowLearnDialog(true);
      
      toast.success(`🎯 Learned your style! (${result.personalization_data?.pattern_confidence || 60}% confidence)`);
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
            <span className="text-blue-900">You've customized this note! Want the AI to learn your format?</span>
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