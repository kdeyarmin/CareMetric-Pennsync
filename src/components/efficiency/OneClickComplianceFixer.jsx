import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, CheckCircle2, AlertCircle, Zap, FileCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function OneClickComplianceFixer({ 
  documentType = "visit_note",
  documentContent = "",
  _patientId,
  onContentFixed
}) {
  const ai = useAICall();
  const [complianceIssues, setComplianceIssues] = useState([]);
  const [fixedContent, setFixedContent] = useState(null);
  const [appliedFixes, setAppliedFixes] = useState(new Set());

  const checkCompliance = useCallback(async () => {
    if (!documentContent) return;

    try {
      const response = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Perform a comprehensive Medicare compliance check on this ${documentType}:

Document Content:
${documentContent}

Check for:
1. Medicare documentation requirements (skilled need, medical necessity, homebound status for home health)
2. Missing required elements (vital signs, assessment, interventions, patient response)
3. Vague or non-specific language
4. Missing time frames or measurements
5. Lack of skilled nursing justification
6. OASIS-related documentation gaps
7. Missing physician communication if needed
8. Incomplete medication reconciliation mentions
9. Lack of patient/caregiver education documentation
10. Missing safety assessments

For each issue found, provide:
- Issue description
- Severity (critical/high/moderate/low)
- Specific location in document
- Suggested fix (exact replacement text)
- Medicare guideline reference
- One-click fix availability (true/false)`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_compliance_score: { type: "number" },
            compliance_level: { type: "string" },
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue_id: { type: "string" },
                  description: { type: "string" },
                  severity: { type: "string" },
                  location: { type: "string" },
                  original_text: { type: "string" },
                  suggested_fix: { type: "string" },
                  guideline_reference: { type: "string" },
                  one_click_fixable: { type: "boolean" }
                }
              }
            },
            summary: { type: "string" }
          }
        }
      });

      const issues = response.issues || [];
      setComplianceIssues(issues);

      if (response.overall_compliance_score >= 95) {
        toast.success("Document is fully compliant!");
      } else if (issues.length === 0) {
        toast.success("No compliance issues found!");
      } else {
        toast.info(`Found ${issues.length} compliance issues`);
      }
    } catch (error) {
      console.error("Compliance check failed:", error);
      toast.error("Compliance check failed");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [documentContent, documentType]);

  const applyFix = async (issue) => {
    if (!issue.one_click_fixable) return;

    try {
      // Apply the fix to the content
      let updatedContent = documentContent;
      if (issue.original_text && issue.suggested_fix) {
        updatedContent = updatedContent.replace(issue.original_text, issue.suggested_fix);
      }

      setFixedContent(updatedContent);
      setAppliedFixes(prev => new Set([...prev, issue.issue_id]));
      
      if (onContentFixed) {
        onContentFixed({
          fixedContent: updatedContent,
          appliedFix: issue
        });
      }

      toast.success("Fix applied successfully!");
    } catch (error) {
      console.error("Failed to apply fix:", error);
      toast.error("Failed to apply fix");
    }
  };

  const applyAllFixes = async () => {
    const fixableIssues = complianceIssues.filter(i => i.one_click_fixable && !appliedFixes.has(i.issue_id));
    
    let updatedContent = fixedContent || documentContent;
    const newlyApplied = new Set(appliedFixes);

    for (const issue of fixableIssues) {
      if (issue.original_text && issue.suggested_fix) {
        updatedContent = updatedContent.replace(issue.original_text, issue.suggested_fix);
        newlyApplied.add(issue.issue_id);
      }
    }

    setFixedContent(updatedContent);
    setAppliedFixes(newlyApplied);

    if (onContentFixed) {
      onContentFixed({
        fixedContent: updatedContent,
        appliedAll: true
      });
    }

    toast.success(`Applied ${fixableIssues.length} compliance fixes!`);
  };

  useEffect(() => {
    if (documentContent && !ai.loading && complianceIssues.length === 0) {
      checkCompliance();
    }
  }, [documentContent, ai.loading, complianceIssues.length, checkCompliance]);

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'moderate': return 'bg-yellow-600 text-white';
      case 'low': return 'bg-blue-600 text-white';
      default: return 'bg-slate-600 text-white';
    }
  };

  const fixableCount = complianceIssues.filter(i => i.one_click_fixable && !appliedFixes.has(i.issue_id)).length;

  return (
    <Card className="border-2 border-blue-300 bg-blue-50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="w-5 h-5 text-blue-600" />
          One-Click Compliance Check
          {complianceIssues.length > 0 && (
            <Badge className="ml-auto bg-blue-600">
              {complianceIssues.length} issues found
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ai.loading && (
          <Alert className="bg-blue-50 border-blue-300">
            <Shield className="w-4 h-4 text-blue-600 animate-pulse" />
            <AlertDescription className="text-blue-900">
              <strong>Running compliance check...</strong>
              <p className="text-sm mt-1">Analyzing against Medicare guidelines and documentation requirements.</p>
            </AlertDescription>
          </Alert>
        )}

        {!ai.loading && complianceIssues.length === 0 && documentContent && (
          <Alert className="bg-green-50 border-green-300">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900">
              <strong>Document is compliant!</strong>
              <p className="text-sm mt-1">No issues found with current documentation.</p>
            </AlertDescription>
          </Alert>
        )}

        {complianceIssues.length > 0 && (
          <>
            {fixableCount > 0 && (
              <Button 
                onClick={applyAllFixes}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                <Zap className="w-4 h-4 mr-2" />
                Fix All {fixableCount} Issues with One Click
              </Button>
            )}

            <div className="space-y-2">
              {complianceIssues.map((issue) => (
                <Card 
                  key={issue.issue_id}
                  className={`${appliedFixes.has(issue.issue_id) ? 'bg-green-50 border-green-300' : 'hover:border-blue-300'}`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {appliedFixes.has(issue.issue_id) ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-orange-600" />
                          )}
                          <span className="font-medium text-sm">{issue.description}</span>
                          <Badge className={getSeverityColor(issue.severity)}>
                            {issue.severity}
                          </Badge>
                        </div>
                        
                        {issue.location && (
                          <p className="text-xs text-slate-600 mb-1">
                            <strong>Location:</strong> {issue.location}
                          </p>
                        )}
                        
                        {issue.guideline_reference && (
                          <p className="text-xs text-blue-700 bg-blue-50 p-1 rounded mb-2">
                            <strong>Medicare Guideline:</strong> {issue.guideline_reference}
                          </p>
                        )}

                        {issue.original_text && (
                          <div className="space-y-1 text-xs">
                            <div className="bg-red-50 border border-red-200 p-2 rounded">
                              <strong className="text-red-700">Original:</strong>
                              <p className="text-slate-700 mt-1">{issue.original_text}</p>
                            </div>
                            {issue.suggested_fix && (
                              <div className="bg-green-50 border border-green-200 p-2 rounded">
                                <strong className="text-green-700">Suggested Fix:</strong>
                                <p className="text-slate-700 mt-1">{issue.suggested_fix}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {issue.one_click_fixable && !appliedFixes.has(issue.issue_id) && (
                      <Button
                        size="sm"
                        onClick={() => applyFix(issue)}
                        className="w-full mt-2 bg-blue-600 hover:bg-blue-700"
                      >
                        <Sparkles className="w-3 h-3 mr-2" />
                        Apply This Fix
                      </Button>
                    )}

                    {appliedFixes.has(issue.issue_id) && (
                      <Alert className="bg-green-50 border-green-300 mt-2">
                        <CheckCircle2 className="w-3 h-3 text-green-600" />
                        <AlertDescription className="text-xs text-green-900">
                          Fix applied successfully
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {!documentContent && (
          <Alert>
            <FileCheck className="w-4 h-4" />
            <AlertDescription>
              Enter document content to check compliance
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}