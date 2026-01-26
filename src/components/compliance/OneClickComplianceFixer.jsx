import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, Loader2, CheckCircle2, Copy, ThumbsUp, ThumbsDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { applyComplianceFix } from "@/functions/applyComplianceFix";

export default function OneClickComplianceFixer({ issue, documentContent, onFixed, violationId, applyToEntity = false }) {
  const [isFixing, setIsFixing] = useState(false);
  const [fixedContent, setFixedContent] = useState(null);
  const [fixApplied, setFixApplied] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState(false);

  const handleAutoFix = async () => {
    setIsFixing(true);
    try {
      if (violationId && applyToEntity) {
        // Use backend function to apply fix to entity
        const response = await applyComplianceFix({ 
          violation_id: violationId,
          apply_to_entity: true 
        });

        if (response.data.success) {
          setFixedContent(response.data.fixed_content);
          setFixApplied(true);
          toast.success("Compliance fix applied to documentation!");
          onFixed?.(response.data.fixed_content, response.data.changes_made);
        } else {
          throw new Error(response.data.message || 'Fix failed');
        }
      } else {
        // Generate fix preview only
        const response = await base44.integrations.Core.InvokeLLM({
          prompt: `You are a clinical documentation expert. Fix the following compliance issue in the documentation.

COMPLIANCE ISSUE:
Rule: ${issue.rule_name || issue.issue_description}
Problem: ${issue.violation_description || issue.issue_description}
Severity: ${issue.severity}

CURRENT DOCUMENTATION:
${documentContent}

CORRECTIVE ACTION NEEDED:
${issue.recommended_action || issue.corrective_action}

${issue.suggested_fix ? `SUGGESTED FIX:\n${issue.suggested_fix}` : ''}

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
        toast.success("Compliance fix generated!");
        onFixed?.(response.corrected_documentation, response.changes_made);
      }
    } catch (error) {
      toast.error("Failed to auto-fix: " + error.message);
    } finally {
      setIsFixing(false);
    }
  };

  const handleFeedback = async (helpful) => {
    try {
      await base44.entities.ComplianceViolation.update(violationId, {
        ai_feedback: helpful ? 'helpful' : 'not_helpful',
        ai_feedback_date: new Date().toISOString()
      });
      setFeedbackGiven(true);
      toast.success(helpful ? "Thank you for your feedback!" : "We'll improve our suggestions");
    } catch (error) {
      console.error('Feedback error:', error);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(fixedContent);
    toast.success("Fixed content copied!");
  };

  if (!issue.auto_fix_available && !issue.auto_fixable && !issue.suggested_fix && !issue.suggested_addition) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Suggested Fix Preview */}
      {(issue.suggested_fix || issue.suggested_addition) && !fixedContent && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-blue-600" />
              AI Suggested Fix
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-white p-3 rounded border">
              {issue.suggested_fix || issue.suggested_addition}
            </pre>
            <p className="text-xs text-blue-700 mt-2">
              Click "One-Click Fix" below to apply this correction automatically
            </p>
          </CardContent>
        </Card>
      )}

      <Button
        size="sm"
        onClick={handleAutoFix}
        disabled={isFixing || fixApplied}
        className="w-full bg-green-600 hover:bg-green-700"
      >
        {isFixing ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {applyToEntity ? 'Applying Fix...' : 'Generating Fix...'}
          </>
        ) : fixApplied ? (
          <>
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Fix Applied
          </>
        ) : (
          <>
            <Wand2 className="w-4 h-4 mr-2" />
            {applyToEntity ? 'Apply One-Click Fix' : 'Generate Fix Preview'}
          </>
        )}
      </Button>

      {fixedContent && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                {fixApplied ? 'Fix Applied to Documentation' : 'Fixed Documentation Preview'}
              </CardTitle>
              <Button size="sm" variant="outline" onClick={handleCopy}>
                <Copy className="w-4 h-4 mr-1" />
                Copy
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-white p-3 rounded border max-h-48 overflow-y-auto">
              {typeof fixedContent === 'string' ? fixedContent : JSON.stringify(fixedContent, null, 2)}
            </pre>

            {/* AI Feedback */}
            {violationId && !feedbackGiven && (
              <div className="mt-4 pt-4 border-t border-green-200">
                <p className="text-xs text-gray-700 mb-2">Was this AI suggestion helpful?</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleFeedback(true)}
                    className="flex-1"
                  >
                    <ThumbsUp className="w-3 h-3 mr-1" />
                    Yes
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleFeedback(false)}
                    className="flex-1"
                  >
                    <ThumbsDown className="w-3 h-3 mr-1" />
                    No
                  </Button>
                </div>
              </div>
            )}
            {feedbackGiven && (
              <p className="text-xs text-green-700 mt-3 text-center">Thank you for your feedback!</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}