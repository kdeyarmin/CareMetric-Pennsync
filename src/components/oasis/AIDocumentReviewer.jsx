import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileSearch,
  Loader2,
  Info,
  AlertOctagon,
  Shield
} from "lucide-react";

export default function AIDocumentReviewer({ oasisData, autoReview = true }) {
  const ai = useAICall();
  const [reviewResults, setReviewResults] = useState(null);
  const [error, setError] = useState(null);

  const performAIReview = useCallback(async () => {
    setError(null);

    try {
      const prompt = `You are a clinical documentation compliance expert reviewing an OASIS (Outcome and Assessment Information Set) document for home health care.

OASIS Data Extracted:
${JSON.stringify(oasisData, null, 2)}

Perform a comprehensive review and identify:

1. **Data Quality Issues**:
   - Missing required fields
   - Inconsistent or contradictory information
   - Invalid values or out-of-range entries
   - Incomplete assessments

2. **Clinical Logic Errors**:
   - Conflicting functional status scores
   - Medication reconciliation issues
   - Vital signs abnormalities
   - Diagnosis coding inconsistencies

3. **Compliance Issues**:
   - Medicare CoP (Conditions of Participation) violations
   - OASIS item completion requirements
   - Documentation gaps that affect reimbursement
   - Missing signatures or authentication

4. **Best Practice Recommendations**:
   - Areas needing more detail
   - Suggested clarifications
   - Additional documentation needed

Provide actionable, specific feedback for each issue found.`;

      const response = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_score: {
              type: "number",
              description: "Quality score 0-100"
            },
            compliance_status: {
              type: "string",
              enum: ["compliant", "minor_issues", "major_issues", "critical_issues"]
            },
            critical_errors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  issue: { type: "string" },
                  impact: { type: "string" },
                  action_required: { type: "string" }
                }
              }
            },
            warnings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  issue: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            },
            missing_information: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  reason_required: { type: "string" },
                  impact_if_missing: { type: "string" }
                }
              }
            },
            compliance_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  regulation: { type: "string" },
                  violation: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  remediation: { type: "string" }
                }
              }
            },
            best_practices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  current_status: { type: "string" },
                  recommendation: { type: "string" },
                  expected_benefit: { type: "string" }
                }
              }
            },
            strengths: {
              type: "array",
              items: { type: "string" }
            },
            summary: { type: "string" }
          }
        }
      });

      setReviewResults(response);
    } catch (err) {
      setError(err.message);
      console.error("AI review error:", err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [oasisData]);

  useEffect(() => {
    if (autoReview && oasisData && !reviewResults) {
      performAIReview();
    }
  }, [oasisData, autoReview, reviewResults, performAIReview]);

  const getSeverityColor = (severity) => {
    const colors = {
      critical: "bg-red-100 text-red-800 border-red-300",
      high: "bg-orange-100 text-orange-800 border-orange-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      low: "bg-blue-100 text-blue-800 border-blue-300"
    };
    return colors[severity] || colors.medium;
  };

  const getComplianceStatusColor = (status) => {
    const colors = {
      compliant: "bg-green-600",
      minor_issues: "bg-yellow-600",
      major_issues: "bg-orange-600",
      critical_issues: "bg-red-600"
    };
    return colors[status] || colors.major_issues;
  };

  if (!oasisData) {
    return null;
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-blue-50">
        <CardTitle className="flex items-center gap-2">
          <FileSearch className="w-6 h-6 text-navy-600" />
          AI Document Review
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {ai.loading && (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 animate-spin text-navy-600 mx-auto mb-4" />
            <p className="text-slate-600">AI is reviewing the OASIS document...</p>
          </div>
        )}

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <XCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {!ai.loading && !reviewResults && (
          <div className="text-center py-8">
            <FileSearch className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              AI Review Available
            </h3>
            <p className="text-slate-600 mb-4">
              Get AI-powered analysis of this OASIS document for errors and compliance issues
            </p>
            <Button onClick={performAIReview} className="bg-navy-600 hover:bg-navy-700">
              <FileSearch className="w-4 h-4 mr-2" />
              Start AI Review
            </Button>
          </div>
        )}

        {reviewResults && (
          <div className="space-y-6">
            {/* Overall Score & Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-slate-600 mb-2">Quality Score</p>
                  <div className="flex items-center gap-3">
                    <div className="text-4xl font-bold text-navy-600">
                      {reviewResults.overall_score}
                    </div>
                    <div className="flex-1">
                      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            reviewResults.overall_score >= 80 ? "bg-green-600" :
                            reviewResults.overall_score >= 60 ? "bg-yellow-600" :
                            "bg-red-600"
                          }`}
                          style={{ width: `${reviewResults.overall_score}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-slate-600 mb-2">Compliance Status</p>
                  <Badge className={`${getComplianceStatusColor(reviewResults.compliance_status)} text-white text-lg px-4 py-2`}>
                    {reviewResults.compliance_status?.replace(/_/g, ' ').toUpperCase()}
                  </Badge>
                </CardContent>
              </Card>
            </div>

            {/* Summary */}
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="w-4 h-4 text-blue-600" />
              <AlertDescription>
                <p className="font-semibold mb-1">Review Summary</p>
                <p className="text-sm">{reviewResults.summary}</p>
              </AlertDescription>
            </Alert>

            {/* Critical Errors */}
            {reviewResults.critical_errors?.length > 0 && (
              <Card className="border-2 border-red-300 bg-red-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2 text-red-900">
                    <AlertOctagon className="w-5 h-5" />
                    Critical Errors ({reviewResults.critical_errors.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {reviewResults.critical_errors.map((error, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border border-red-200">
                      <div className="flex items-start gap-2 mb-2">
                        <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold text-slate-900">{error.field}</p>
                          <p className="text-sm text-slate-700 mt-1">{error.issue}</p>
                        </div>
                      </div>
                      <div className="ml-6 space-y-1 text-sm">
                        <p className="text-red-700"><strong>Impact:</strong> {error.impact}</p>
                        <p className="text-blue-700"><strong>Action Required:</strong> {error.action_required}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Compliance Issues */}
            {reviewResults.compliance_issues?.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Shield className="w-5 h-5 text-orange-600" />
                    Compliance Issues ({reviewResults.compliance_issues.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {reviewResults.compliance_issues.map((issue, idx) => (
                    <div key={idx} className={`p-3 rounded border ${getSeverityColor(issue.severity)}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="font-semibold">{issue.regulation}</p>
                        <Badge variant="outline" className="text-xs">
                          {issue.severity}
                        </Badge>
                      </div>
                      <p className="text-sm mb-2">{issue.violation}</p>
                      <p className="text-sm text-blue-700">
                        <strong>Remediation:</strong> {issue.remediation}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Warnings */}
            {reviewResults.warnings?.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-600" />
                    Warnings ({reviewResults.warnings.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {reviewResults.warnings.map((warning, idx) => (
                    <div key={idx} className="p-3 bg-yellow-50 rounded border border-yellow-200">
                      <p className="font-semibold text-sm text-slate-900">{warning.field}</p>
                      <p className="text-sm text-slate-700 mt-1">{warning.issue}</p>
                      <p className="text-sm text-blue-700 mt-1">
                        <strong>Recommendation:</strong> {warning.recommendation}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Missing Information */}
            {reviewResults.missing_information?.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Info className="w-5 h-5 text-blue-600" />
                    Missing Information ({reviewResults.missing_information.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {reviewResults.missing_information.map((missing, idx) => (
                    <div key={idx} className="p-3 bg-blue-50 rounded border border-blue-200">
                      <p className="font-semibold text-sm text-slate-900">{missing.field}</p>
                      <p className="text-sm text-slate-700 mt-1">{missing.reason_required}</p>
                      <p className="text-sm text-orange-700 mt-1">
                        <strong>Impact:</strong> {missing.impact_if_missing}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Best Practices */}
            {reviewResults.best_practices?.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    Best Practice Recommendations ({reviewResults.best_practices.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {reviewResults.best_practices.map((practice, idx) => (
                    <div key={idx} className="p-3 bg-green-50 rounded border border-green-200">
                      <p className="font-semibold text-sm text-slate-900">{practice.area}</p>
                      <p className="text-sm text-slate-600 mt-1">
                        <strong>Current:</strong> {practice.current_status}
                      </p>
                      <p className="text-sm text-slate-700 mt-1">{practice.recommendation}</p>
                      <p className="text-sm text-green-700 mt-1">
                        <strong>Benefit:</strong> {practice.expected_benefit}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Strengths */}
            {reviewResults.strengths?.length > 0 && (
              <Card className="border-green-200 bg-green-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2 text-green-900">
                    <CheckCircle2 className="w-5 h-5" />
                    Strengths
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {reviewResults.strengths.map((strength, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-slate-900">{strength}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end pt-4 border-t">
              <Button onClick={performAIReview} variant="outline" size="sm">
                <FileSearch className="w-4 h-4 mr-2" />
                Re-run Review
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}