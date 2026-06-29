import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles,
  Loader2,
  Lightbulb,
  RefreshCw
} from "lucide-react";
import { toast } from 'sonner';

export default function AIValidationHelper({ validationErrors, _onApplySuggestions }) {
  const ai = useAICall();
  const [suggestions, setSuggestions] = useState(null);

  const generateSuggestions = async () => {
    try {
      const response = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `Analyze these patient data validation errors and provide specific correction suggestions:

${JSON.stringify(validationErrors, null, 2)}

For each error, provide:
1. A clear explanation of what's wrong
2. A specific correction suggestion
3. The corrected value (if possible to infer)

Return a JSON array with this structure:
[
  {
    "row": <row_number>,
    "patient": "<patient_name>",
    "error": "<original_error>",
    "explanation": "<why_this_is_wrong>",
    "suggestion": "<how_to_fix_it>",
    "corrected_value": "<suggested_value_if_applicable>"
  }
]`,
        response_json_schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  row: { type: "number" },
                  patient: { type: "string" },
                  error: { type: "string" },
                  explanation: { type: "string" },
                  suggestion: { type: "string" },
                  corrected_value: { type: "string" }
                }
              }
            }
          }
        }
      });

      setSuggestions(response.suggestions || []);
    } catch (error) {
      console.error('Failed to generate AI suggestions:', error);
      toast.error('Failed to generate suggestions. Please try again.');
    }
  };

  const getSeverityColor = (error) => {
    if (error.includes('required') || error.includes('Invalid') || error.includes('must')) {
      return 'destructive';
    }
    if (error.includes('recommended') || error.includes('unusual')) {
      return 'warning';
    }
    return 'default';
  };

  return (
    <Card className="border-navy-300 bg-gradient-to-br from-navy-50 to-gold-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" />
          AI Validation Assistant
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!suggestions ? (
          <div className="text-center py-6">
            <p className="text-slate-600 mb-4">
              Get AI-powered suggestions to fix validation errors automatically
            </p>
            <Button
              onClick={generateSuggestions}
              disabled={ai.loading}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {ai.loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing Errors...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate AI Suggestions
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">
                AI Analysis Complete • {suggestions.length} Suggestion{suggestions.length !== 1 ? 's' : ''}
              </p>
              <Button
                onClick={generateSuggestions}
                variant="outline"
                size="sm"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Regenerate
              </Button>
            </div>

            <ScrollArea className="h-96">
              <div className="space-y-3 pr-4">
                {suggestions.map((suggestion, idx) => (
                  <Alert key={idx} className="bg-white border-navy-200">
                    <Lightbulb className="w-4 h-4 text-navy-600" />
                    <AlertDescription>
                      <div className="space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold text-sm">
                              Row {suggestion.row} • {suggestion.patient}
                            </p>
                            <Badge variant={getSeverityColor(suggestion.error)} className="mt-1">
                              {suggestion.error}
                            </Badge>
                          </div>
                        </div>

                        <div className="pl-4 border-l-2 border-navy-200 space-y-1">
                          <p className="text-xs text-slate-600">
                            <strong>Issue:</strong> {suggestion.explanation}
                          </p>
                          <p className="text-xs text-green-700 bg-green-50 p-2 rounded">
                            <strong>Suggestion:</strong> {suggestion.suggestion}
                          </p>
                          {suggestion.corrected_value && (
                            <p className="text-xs text-blue-700 bg-blue-50 p-2 rounded font-mono">
                              <strong>Corrected:</strong> {suggestion.corrected_value}
                            </p>
                          )}
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            </ScrollArea>

            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-sm">
                💡 Review these suggestions carefully before applying. You may need to manually correct the data in your CSV file.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  );
}