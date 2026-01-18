import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, CheckCircle2, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

export default function InteractiveQualitySuggestions({ 
  qualityAnalysis, 
  onApplySuggestion,
  noteContent
}) {
  const [expandedSuggestion, setExpandedSuggestion] = useState(null);

  if (!qualityAnalysis?.suggestions || qualityAnalysis.suggestions.length === 0) {
    return null;
  }

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600';
      case 'important': return 'bg-orange-500';
      case 'minor': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <Card className="border-purple-300 bg-purple-50 dark:bg-purple-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-600" />
          Documentation Quality Improvements ({qualityAnalysis.suggestions.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {qualityAnalysis.suggestions.map((suggestion, idx) => {
          const isExpanded = expandedSuggestion === idx;
          
          return (
            <div 
              key={idx} 
              className="bg-white dark:bg-slate-900 rounded-lg border-2 border-purple-200 dark:border-purple-800 overflow-hidden"
            >
              <div 
                className="p-3 cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/50 transition-colors"
                onClick={() => setExpandedSuggestion(isExpanded ? null : idx)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge className={getSeverityColor(suggestion.severity)}>
                        {suggestion.severity}
                      </Badge>
                      <Badge variant="outline">{suggestion.category?.replace(/_/g, ' ')}</Badge>
                    </div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {suggestion.issue}
                    </p>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="p-3 bg-purple-50/50 dark:bg-purple-900/30 border-t border-purple-200 dark:border-purple-800 space-y-3">
                  {suggestion.excerpt && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/30 border-l-4 border-yellow-400 p-2 rounded">
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Current text:</p>
                      <p className="text-sm text-gray-800 dark:text-gray-200 italic">
                        "{suggestion.excerpt}"
                      </p>
                    </div>
                  )}

                  <div className="bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-400 p-2 rounded">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Recommendation:</p>
                    <p className="text-sm text-gray-800 dark:text-gray-200">
                      {suggestion.recommendation}
                    </p>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-400 p-2 rounded mb-2">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Suggestion:</p>
                    <p className="text-sm text-gray-800 dark:text-gray-200">
                      {suggestion.suggestion}
                    </p>
                  </div>

                  {suggestion.example && (
                    <div className="bg-green-50 dark:bg-green-900/30 border-l-4 border-green-400 p-2 rounded mb-2">
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Example:</p>
                      <p className="text-sm text-gray-800 dark:text-gray-200">
                        {suggestion.example}
                      </p>
                    </div>
                  )}

                  {noteContent && (
                    <ResolveQualitySuggestion
                      suggestion={suggestion}
                      noteContent={noteContent}
                      onResolved={(improvedNote, summary) => {
                        if (onApplySuggestion) {
                          onApplySuggestion(improvedNote);
                        }
                        toast.success(summary);
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}