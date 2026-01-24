import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wand2, CheckCircle, AlertTriangle } from "lucide-react";

export default function OneClickComplianceFixes({ issues, visitId, onFixed }) {
  const queryClient = useQueryClient();

  const fixIssueMutation = useMutation({
    mutationFn: async ({ issue, fix }) => {
      // Apply the fix via AI
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Fix this compliance issue: "${issue.problem}"
        
Current content: ${issue.context || ''}

Suggestion: ${issue.suggestion}

Generate the corrected text that addresses this issue. Return only the fixed text, no explanations.`,
        response_json_schema: {
          type: "object",
          properties: {
            fixed_text: { type: "string" }
          }
        }
      });

      return result.fixed_text;
    },
    onSuccess: (fixedText, { issue }) => {
      toast.success(`Fixed: ${issue.element}`);
      if (onFixed) onFixed(issue, fixedText);
      queryClient.invalidateQueries({ queryKey: ['complianceAudit'] });
    },
    onError: () => {
      toast.error('Failed to apply fix');
    }
  });

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-blue-100 text-blue-800 border-blue-200';
    }
  };

  const fixableIssues = issues.filter(i => i.suggestion && i.severity !== 'low');

  if (fixableIssues.length === 0) {
    return (
      <Alert className="bg-green-50 border-green-200">
        <CheckCircle className="w-4 h-4 text-green-600" />
        <AlertDescription className="text-green-900">
          No compliance issues require fixes
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-blue-600" />
          One-Click Compliance Fixes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {fixableIssues.map((issue, idx) => (
          <div key={idx} className={`p-4 rounded-lg border-2 ${getSeverityColor(issue.severity)}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="font-semibold text-sm">{issue.element}</span>
                  <Badge variant="outline">{issue.severity}</Badge>
                </div>
                <p className="text-sm mb-2">{issue.problem}</p>
                <div className="bg-white/50 p-2 rounded text-xs">
                  <strong>Suggested fix:</strong> {issue.suggestion}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => fixIssueMutation.mutate({ issue })}
                disabled={fixIssueMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 flex-shrink-0"
              >
                <Wand2 className="w-3 h-3 mr-1" />
                {fixIssueMutation.isPending ? 'Fixing...' : 'Fix Now'}
              </Button>
            </div>
          </div>
        ))}

        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            fixableIssues.forEach(issue => {
              fixIssueMutation.mutate({ issue });
            });
          }}
          disabled={fixIssueMutation.isPending}
        >
          <Wand2 className="w-4 h-4 mr-2" />
          Fix All Issues ({fixableIssues.length})
        </Button>
      </CardContent>
    </Card>
  );
}