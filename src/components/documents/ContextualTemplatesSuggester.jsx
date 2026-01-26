import React, { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { Lightbulb, Loader2, X, Copy, Star } from "lucide-react";
import { toast } from "sonner";

export default function ContextualTemplatesSuggester({
  patientDiagnosis,
  visitType,
  existingContent = "",
  availableTemplates = [],
  onTemplateSelect = () => {},
  onPhraseInsert = () => {}
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Debounced suggestion generation
  useEffect(() => {
    if (dismissed || (!patientDiagnosis && !visitType && !existingContent)) {
      return;
    }

    const timer = setTimeout(() => {
      generateSuggestions();
    }, 1500); // Debounce by 1.5 seconds

    return () => clearTimeout(timer);
  }, [patientDiagnosis, visitType, existingContent, dismissed, availableTemplates]);

  const generateSuggestions = useCallback(async () => {
    if (availableTemplates.length === 0) return;

    setLoading(true);
    try {
      const response = await base44.functions.invoke('suggestRelevantTemplates', {
        patientDiagnosis,
        visitType,
        existingContent,
        availableTemplates
      });

      setSuggestions(response.suggestions || []);
    } catch (error) {
      console.error('Failed to generate suggestions:', error);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [patientDiagnosis, visitType, existingContent, availableTemplates]);

  const handleSelectTemplate = (templateName) => {
    const template = availableTemplates.find(t => t.template_name === templateName);
    if (template) {
      onTemplateSelect(template);
      toast.success(`Template "${templateName}" selected`);
    }
    setDismissed(true);
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  if (dismissed || suggestions.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-blue-500 bg-gradient-to-r from-blue-50 to-blue-100 shadow-md animate-in fade-in slide-in-from-top-2 duration-300">
      <CardHeader className="pb-3 flex flex-row items-start justify-between">
        <div className="flex items-start gap-2">
          <Lightbulb className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <CardTitle className="text-base">Suggested Templates</CardTitle>
            <p className="text-xs text-slate-600 mt-1">
              Based on diagnosis and visit type
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDismissed(true)}
          className="h-6 w-6 flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600 mr-2" />
            <span className="text-sm text-slate-600">Analyzing context...</span>
          </div>
        ) : (
          <div className="space-y-2">
            {suggestions.map((suggestion, idx) => (
              <div
                key={idx}
                className="p-3 bg-white rounded-lg border border-blue-200 hover:border-blue-400 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1">
                    <p className="font-medium text-sm text-slate-900 flex items-center gap-2">
                      {suggestion.template_name}
                      {suggestion.priority === 'high' && (
                        <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                      )}
                    </p>
                  </div>
                  <Badge className={getPriorityColor(suggestion.priority)}>
                    {suggestion.priority}
                  </Badge>
                </div>
                <p className="text-xs text-slate-600 mb-2">{suggestion.reason}</p>
                <Button
                  size="sm"
                  onClick={() => handleSelectTemplate(suggestion.template_name)}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-xs"
                >
                  Use This Template
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 text-xs text-slate-500 border-t pt-2 mt-2">
          <span>💡 Tip: Enter diagnosis or select visit type for better suggestions</span>
        </div>
      </CardContent>
    </Card>
  );
}