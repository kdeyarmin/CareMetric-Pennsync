import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Brain, Loader2, Lightbulb, RefreshCw } from "lucide-react";
import { toast } from 'sonner';

export default function AIErrorInterpreter({ errors, _onApplySuggestions }) {
  const ai = useAICall();
  const [analysis, setAnalysis] = useState(null);

  const analyzeErrors = async () => {
    
    try {
      // Group errors by type for more efficient analysis
      const errorSummary = errors.slice(0, 10).map(err => ({
        row: err.row,
        patient: err.patient,
        errors: err.errors.map(e => ({
          field: e.field,
          value: e.value,
          error: e.error,
          columnHeader: e.columnHeader
        }))
      }));

      const prompt = `You are a healthcare data import specialist. Analyze these patient import errors and provide actionable solutions.

Import Errors:
${JSON.stringify(errorSummary, null, 2)}

For each error pattern, provide:
1. Root cause explanation in simple terms
2. Step-by-step fix instructions
3. Common reasons this error occurs
4. Preventive measures for future imports

Focus on the most common errors first.`;

      const response = await ai.run({
        model: "claude_sonnet_4_6",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            error_patterns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  error_type: { type: "string" },
                  affected_rows: { type: "array", items: { type: "number" } },
                  root_cause: { type: "string" },
                  fix_instructions: { type: "array", items: { type: "string" } },
                  common_reasons: { type: "array", items: { type: "string" } },
                  prevention_tips: { type: "array", items: { type: "string" } }
                }
              }
            },
            overall_recommendation: { type: "string" }
          }
        }
      });

      setAnalysis(response);
    } catch (error) {
      console.error('AI analysis error:', error);
      toast.error('Failed to analyze errors: ' + error.message);
    }
    
  };

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-indigo-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-navy-900">
          <Brain className="w-5 h-5" />
          AI Error Interpreter
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!analysis ? (
          <div className="text-center py-6">
            <Brain className="w-12 h-12 text-navy-400 mx-auto mb-3" />
            <p className="text-sm text-slate-700 mb-4">
              Let AI analyze your import errors and provide intelligent solutions
            </p>
            <Button
              onClick={analyzeErrors}
              disabled={ai.loading || errors.length === 0}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {ai.loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing {errors.length} errors...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Analyze Errors with AI
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert className="bg-blue-50 border-blue-300">
              <Lightbulb className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-sm text-blue-900">
                <strong>Overall Recommendation:</strong> {analysis.overall_recommendation}
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              {analysis.error_patterns?.map((pattern, idx) => (
                <Card key={idx} className="bg-white">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <h4 className="font-semibold text-slate-900">{pattern.error_type}</h4>
                      <Badge className="bg-red-100 text-red-800">
                        {pattern.affected_rows?.length || 0} rows
                      </Badge>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-500 mb-1">ROOT CAUSE</p>
                        <p className="text-sm text-slate-700">{pattern.root_cause}</p>
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-slate-500 mb-1">HOW TO FIX</p>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-slate-700">
                          {pattern.fix_instructions?.map((instruction, iIdx) => (
                            <li key={iIdx}>{instruction}</li>
                          ))}
                        </ol>
                      </div>

                      {pattern.common_reasons && pattern.common_reasons.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 mb-1">COMMON CAUSES</p>
                          <ul className="space-y-1 text-xs text-slate-600">
                            {pattern.common_reasons.map((reason, rIdx) => (
                              <li key={rIdx}>• {reason}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {pattern.prevention_tips && pattern.prevention_tips.length > 0 && (
                        <div className="p-2 bg-green-50 rounded border border-green-200">
                          <p className="text-xs font-semibold text-green-800 mb-1">💡 PREVENTION TIPS</p>
                          <ul className="space-y-1 text-xs text-green-700">
                            {pattern.prevention_tips.map((tip, tIdx) => (
                              <li key={tIdx}>• {tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Button
              onClick={() => setAnalysis(null)}
              variant="outline"
              size="sm"
              className="w-full"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Re-analyze
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}