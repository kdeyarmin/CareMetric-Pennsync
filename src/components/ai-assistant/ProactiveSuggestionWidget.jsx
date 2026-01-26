import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { Lightbulb, X } from "lucide-react";
import { toast } from "sonner";

const SUGGESTIONS_MAP = {
  SmartNoteAssistant: {
    triggers: ['note_started', 'missing_fields'],
    suggestions: [
      'Use AI to enhance your note with relevant clinical details',
      'Check for compliance gaps in your documentation',
      'Generate follow-up tasks based on this note'
    ]
  },
  DocumentGenerator: {
    triggers: ['template_selected'],
    suggestions: [
      'Use AI to auto-populate fields based on patient history',
      'Generate compliance-compliant document text',
      'Preview document before finalizing'
    ]
  },
  CarePlanManagement: {
    triggers: ['care_plan_opened'],
    suggestions: [
      'Get AI-suggested goals based on patient diagnosis',
      'Review care plan for compliance with regulations',
      'Generate evidence-based interventions'
    ]
  },
  OASIS: {
    triggers: ['form_opened'],
    suggestions: [
      'Get AI guidance on complex OASIS fields',
      'Validate your entries for accuracy',
      'Review CMS compliance requirements for this section'
    ]
  },
  Compliance: {
    triggers: ['page_opened'],
    suggestions: [
      'Check your agency for compliance risks',
      'Get training recommendations for your team',
      'Review recent regulatory changes'
    ]
  }
};

export default function ProactiveSuggestionWidget({ 
  currentPage, 
  triggerType = 'page_opened',
  onSuggestionClick = () => {} 
}) {
  const [suggestion, setSuggestion] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed) return;

    const pageConfig = SUGGESTIONS_MAP[currentPage];
    if (!pageConfig || !pageConfig.triggers.includes(triggerType)) {
      setSuggestion(null);
      return;
    }

    // Show random suggestion from the list
    const randomSuggestion = pageConfig.suggestions[
      Math.floor(Math.random() * pageConfig.suggestions.length)
    ];

    setSuggestion(randomSuggestion);
  }, [currentPage, triggerType, dismissed]);

  const handleDismiss = () => {
    setDismissed(true);
    setTimeout(() => setDismissed(false), 5000); // Re-enable after 5 seconds
  };

  if (!suggestion || dismissed) return null;

  return (
    <Card className="fixed bottom-20 right-6 max-w-xs bg-gradient-to-r from-amber-50 to-orange-50 border-l-4 border-l-amber-500 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Lightbulb className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-900">AI Suggestion</p>
            <p className="text-sm text-slate-700 mt-1">{suggestion}</p>
          </div>
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleDismiss}
            className="text-xs"
          >
            Dismiss
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onSuggestionClick(suggestion);
              handleDismiss();
            }}
            className="bg-amber-600 hover:bg-amber-700 text-xs"
          >
            Learn More
          </Button>
        </div>
      </div>
    </Card>
  );
}