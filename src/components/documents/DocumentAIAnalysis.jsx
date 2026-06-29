import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Brain, AlertTriangle, TrendingUp, FileText, Loader2, Sparkles } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { analyzeDocument } from "@/functions/analyzeDocument";

export default function DocumentAIAnalysis({ document, compact = false }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const queryClient = useQueryClient();

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeDocument({ document_id: document.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['patient-documents'] });
      toast.success("Document analyzed successfully");
    },
    onError: (error) => {
      toast.error("Analysis failed: " + error.message);
    }
  });

  const analysis = document.ai_analysis;

  if (!analysis?.analyzed) {
    return (
      <Card className="border-navy-200 bg-navy-50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-navy-600" />
              <span className="text-sm font-medium text-navy-900">AI Analysis Available</span>
            </div>
            <Button
              size="sm"
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {analyzeMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Analyze Document
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasCriticalFlags = analysis.critical_flags?.some(f => f.severity === 'critical' || f.severity === 'high');

  if (compact) {
    return (
      <div className="space-y-2">
        {hasCriticalFlags && (
          <Alert className="bg-red-50 border-red-300">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-sm text-red-900">
              Critical findings detected
            </AlertDescription>
          </Alert>
        )}
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Brain className="w-4 h-4 text-navy-600" />
          <span>AI analyzed • Confidence: {analysis.confidence_score}%</span>
        </div>
      </div>
    );
  }

  return (
    <Card className="border-navy-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            AI Analysis
          </CardTitle>
          <Badge className="bg-navy-100 text-navy-800">
            Confidence: {analysis.confidence_score}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Critical Flags */}
        {analysis.critical_flags?.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              Critical Findings
            </h4>
            {analysis.critical_flags.map((flag, idx) => (
              <Alert key={idx} className={
                flag.severity === 'critical' ? 'bg-red-50 border-red-300' :
                flag.severity === 'high' ? 'bg-orange-50 border-orange-300' :
                'bg-yellow-50 border-yellow-300'
              }>
                <AlertDescription>
                  <div className="flex items-start gap-2">
                    <Badge className={
                      flag.severity === 'critical' ? 'bg-red-600 text-white' :
                      flag.severity === 'high' ? 'bg-orange-600 text-white' :
                      'bg-yellow-600 text-white'
                    }>
                      {(flag.severity || '').toUpperCase()}
                    </Badge>
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{flag.finding}</p>
                      <p className="text-sm text-slate-700 mt-1">{flag.details}</p>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Summary */}
        <div>
          <h4 className="font-semibold text-sm text-slate-900 mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            Summary
          </h4>
          <p className="text-sm text-slate-700 bg-blue-50 p-3 rounded-lg">{analysis.summary}</p>
        </div>

        {/* Extracted Data */}
        {analysis.extracted_data && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full">
                <TrendingUp className="w-4 h-4 mr-2" />
                {isExpanded ? 'Hide' : 'Show'} Extracted Data
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3">
              {Object.entries(analysis.extracted_data).map(([key, value]) => {
                if (!value || (Array.isArray(value) && value.length === 0)) return null;
                return (
                  <div key={key} className="bg-slate-50 p-3 rounded-lg">
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-1">
                      {key.replace(/_/g, ' ')}
                    </p>
                    <div className="text-sm text-slate-900">
                      {Array.isArray(value) ? (
                        <ul className="list-disc list-inside space-y-1">
                          {value.map((item, idx) => (
                            <li key={idx}>{typeof item === 'object' ? JSON.stringify(item) : item}</li>
                          ))}
                        </ul>
                      ) : typeof value === 'object' ? (
                        <pre className="text-xs">{JSON.stringify(value, null, 2)}</pre>
                      ) : (
                        <p>{value}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Suggested Category */}
        {analysis.suggested_category && analysis.suggested_category !== document.category && (
          <div className="flex items-center gap-2 p-3 bg-navy-50 rounded-lg border border-navy-200">
            <Sparkles className="w-4 h-4 text-navy-600" />
            <span className="text-sm text-navy-900">
              Suggested category: <strong>{analysis.suggested_category.replace(/_/g, ' ')}</strong>
            </span>
          </div>
        )}

        <p className="text-xs text-slate-500">
          Analyzed on {new Date(analysis.analyzed_date).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}