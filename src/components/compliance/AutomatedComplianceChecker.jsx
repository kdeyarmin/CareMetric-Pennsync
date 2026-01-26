import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Shield, AlertTriangle, CheckCircle2, XCircle, Loader2, 
  FileText, Copy, Lightbulb, TrendingUp, Eye, EyeOff
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import OneClickComplianceFixer from "./OneClickComplianceFixer";

export default function AutomatedComplianceChecker({ 
  documentContent, 
  documentType = "clinical note",
  patientId,
  visitId,
  entityId,
  autoCheck = false,
  onIssuesDetected 
}) {
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [expandedIssues, setExpandedIssues] = useState({});

  useEffect(() => {
    if (autoCheck && documentContent && documentContent.length > 100) {
      handleCheck();
    }
  }, [autoCheck, documentContent]);

  const handleCheck = async () => {
    if (!documentContent || documentContent.trim().length < 50) {
      toast.error("Document content is too short to analyze");
      return;
    }

    setIsChecking(true);
    try {
      const response = await base44.functions.invoke('automatedComplianceCheck', {
        document_content: documentContent,
        document_type: documentType,
        patient_id: patientId,
        visit_id: visitId,
        entity_id: entityId
      });

      const data = response?.data;
      if (data?.success) {
        setResult(data.compliance_result);
        onIssuesDetected?.(data.compliance_result);
        
        if (data.compliance_result.compliance_level === 'compliant') {
          toast.success("✓ Documentation is compliant!");
        } else if (data.critical_issues_count > 0) {
          toast.error(`Found ${data.critical_issues_count} critical compliance issue(s)`);
        } else {
          toast.warning("Compliance issues detected - review recommendations");
        }
      } else {
        toast.error(data?.error || "Compliance check failed");
      }
    } catch (error) {
      toast.error("Failed to check compliance: " + error.message);
    } finally {
      setIsChecking(false);
    }
  };

  const toggleIssue = (index) => {
    setExpandedIssues(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const handleCopySuggestion = (suggestion) => {
    navigator.clipboard.writeText(suggestion);
    toast.success("Suggestion copied to clipboard");
  };

  const severityConfig = {
    critical: { color: 'bg-red-600', icon: XCircle, label: 'Critical' },
    high: { color: 'bg-orange-600', icon: AlertTriangle, label: 'High' },
    medium: { color: 'bg-yellow-600', icon: AlertTrile, label: 'Medium' },
    low: { color: 'bg-blue-600', icon: FileText, label: 'Low' }
  };

  const complianceColors = {
    compliant: 'from-green-50 to-green-100 border-green-200',
    minor_issues: 'from-yellow-50 to-yellow-100 border-yellow-200',
    major_issues: 'from-orange-50 to-orange-100 border-orange-200',
    critical_issues: 'from-red-50 to-red-100 border-red-200'
  };

  if (!documentContent) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Check Button */}
      {!autoCheck && (
        <Button
          onClick={handleCheck}
          disabled={isChecking}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {isChecking ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing Documentation...
            </>
          ) : (
            <>
              <Shield className="w-4 h-4 mr-2" />
              Run Compliance Check
            </>
          )}
        </Button>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Overall Score Card */}
          <Card className={`border-2 bg-gradient-to-br ${complianceColors[result.compliance_level]}`}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold mb-1">Compliance Score</h3>
                  <p className="text-3xl font-bold text-gray-900">
                    {result.overall_compliance_score}%
                  </p>
                  <p className="text-sm text-gray-700 mt-1 capitalize">
                    {result.compliance_level.replace(/_/g, ' ')}
                  </p>
                </div>
                <div className="text-right">
                  {result.compliance_level === 'compliant' ? (
                    <CheckCircle2 className="w-16 h-16 text-green-600" />
                  ) : (
                    <AlertTriangle className="w-16 h-16 text-orange-600" />
                  )}
                  <p className="text-sm text-gray-700 mt-2">
                    {result.total_issues_found} issue{result.total_issues_found !== 1 ? 's' : ''} found
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Strengths */}
          {result.strengths && result.strengths.length > 0 && (
            <Card className="border-green-200 bg-green-50">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Documentation Strengths
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.strengths.map((strength, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="text-green-600">✓</span>
                      <span>{strength}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Issues Found */}
          {result.issues && result.issues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  Compliance Issues ({result.issues.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.issues.map((issue, idx) => {
                  const config = severityConfig[issue.severity] || severityConfig.medium;
                  const Icon = config.icon;

                  return (
                    <Collapsible
                      key={idx}
                      open={expandedIssues[idx]}
                      onOpenChange={() => toggleIssue(idx)}
                    >
                      <Card className="border-l-4 border-l-orange-400">
                        <CollapsibleTrigger className="w-full">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 flex-1">
                                <Icon className={`w-5 h-5 mt-0.5 text-${issue.severity === 'critical' ? 'red' : issue.severity === 'high' ? 'orange' : 'yellow'}-600`} />
                                <div className="flex-1 text-left">
                                  <div className="flex items-center gap-2 mb-1">
                                    <h4 className="font-semibold text-sm">{issue.rule_name}</h4>
                                    <Badge className={config.color}>{config.label}</Badge>
                                    {issue.auto_fixable && (
                                      <Badge className="bg-blue-600">Auto-fixable</Badge>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-600">{issue.issue_description}</p>
                                  {issue.category && (
                                    <Badge variant="outline" className="mt-2 text-xs">
                                      {issue.category}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <Button size="sm" variant="ghost">
                                {expandedIssues[idx] ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </CardContent>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <CardContent className="pt-0 pb-4 px-4 space-y-3">
                            {issue.document_quote && (
                              <div>
                                <Label className="text-xs font-semibold text-gray-700">
                                  Document Reference:
                                </Label>
                                <div className="mt-1 p-3 bg-gray-100 rounded text-sm italic border-l-2 border-gray-400">
                                  "{issue.document_quote}"
                                </div>
                              </div>
                            )}

                            <div>
                              <Label className="text-xs font-semibold text-gray-700">
                                Corrective Action:
                              </Label>
                              <p className="mt-1 text-sm text-gray-800">{issue.corrective_action}</p>
                            </div>

                            {issue.suggested_addition && (
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <Label className="text-xs font-semibold text-green-700">
                                    Suggested Addition:
                                  </Label>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleCopySuggestion(issue.suggested_addition)}
                                  >
                                    <Copy className="w-3 h-3 mr-1" />
                                    Copy
                                  </Button>
                                </div>
                                <div className="p-3 bg-green-50 rounded border border-green-200">
                                  <pre className="text-sm whitespace-pre-wrap">{issue.suggested_addition}</pre>
                                </div>
                              </div>
                            )}

                            {/* One-Click Fix */}
                            <OneClickComplianceFixer
                              issue={issue}
                              documentContent={documentContent}
                              onFixed={(fixedContent, changes) => {
                                toast.success("Applied fix: " + changes);
                              }}
                            />
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Missing Required Elements */}
          {result.missing_required_elements && result.missing_required_elements.length > 0 && (
            <Card className="border-orange-200 bg-orange-50">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-5 h-5 text-orange-600" />
                  Missing Required Elements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.missing_required_elements.map((elem, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="text-orange-600">⚠</span>
                      <span>{elem}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* General Recommendations */}
          {result.recommendations && result.recommendations.length > 0 && (
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-blue-600" />
                  Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <TrendingUp className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* No Issues Found */}
          {result.total_issues_found === 0 && (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-800">
                Excellent! No compliance issues detected. This documentation meets all regulatory requirements.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}