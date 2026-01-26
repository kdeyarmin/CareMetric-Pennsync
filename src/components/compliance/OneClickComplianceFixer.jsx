import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, Loader2, CheckCircle2, Copy } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function OneClickComplianceFixer({ issue, documentContent, onFixed }) {
  const [isFixing, setIsFixing] = useState(false);
  const [fixedContent, setFixedContent] = useState(null);

  const handleAutoFix = async () => {
    setIsFixing(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical documentation expert. Fix the following compliance issue in the documentation.

COMPLIANCE ISSUE:
Rule: ${issue.rule_name}
Problem: ${issue.issue_description}
Severity: ${issue.severity}

CURRENT DOCUMENTATION:
${documentContent}

CORRECTIVE ACTION NEEDED:
${issue.corrective_action}

${issue.suggested_addition ? `SUGGESTED TEXT TO ADD:\n${issue.suggested_addition}` : ''}

Provide the COMPLETE corrected documentation with the compliance issue fixed. Maintain the original format and structure, only make necessary changes to resolve the compliance issue.`,
        response_json_schema: {
          type: "object",
          properties: {
            corrected_documentation: { type: "string" },
            changes_made: { type: "string" },
            compliance_verified: { type: "boolean" }
          }
        }
      });

      setFixedContent(response.corrected_documentation);
      toast.success("Compliance issue auto-fixed!");
      onFixed?.(response.corrected_documentation, response.changes_made);
    } catch (error) {
      toast.error("Failed to auto-fix: " + error.message);
    } finally {
      setIsFixing(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(fixedContent);
    toast.success("Fixed content copied!");
  };

  if (!issue.auto_fixable && !issue.suggested_addition) {
    return null;
  }

  return (
    <div className="space-y-3">
      <Button
        size="sm"
        onClick={handleAutoFix}
        disabled={isFixing}
        className="w-full bg-green-600 hover:bg-green-700"
      >
        {isFixing ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Auto-Fixing...
          </>
        ) : (
          <>
            <Wand2 className="w-4 h-4 mr-2" />
            One-Click Fix
          </>
        )}
      </Button>

      {fixedContent && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Fixed Documentation
              </CardTitle>
              <Button size="sm" variant="outline" onClick={handleCopy}>
                <Copy className="w-4 h-4 mr-1" />
                Copy
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-white p-3 rounded border max-h-48 overflow-y-auto">
              {fixedContent}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}