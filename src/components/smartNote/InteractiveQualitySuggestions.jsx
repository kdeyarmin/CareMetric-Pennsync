import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, CheckCircle2, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

export default function InteractiveQualitySuggestions({ 
  qualityAnalysis, 
  onApplySuggestion 
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

                  {suggestion.improved_text && (
                    <div className="bg-green-50 dark:bg-green-900/30 border-l-4 border-green-400 p-2 rounded">
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Suggested improvement:</p>
                      <p className="text-sm text-gray-800 dark:text-gray-200 mb-3">
                        "{suggestion.improved_text}"
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onApplySuggestion(suggestion.improved_text, suggestion.excerpt);
                            toast.success('Suggestion applied');
                          }}
                          className="bg-green-600 hover:bg-green-700 text-xs"
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Apply to Note
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(suggestion.improved_text);
                            toast.success('Copied to clipboard');
                          }}
                          className="text-xs"
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          Copy
                        </Button>
                      </div>
                    </div>
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