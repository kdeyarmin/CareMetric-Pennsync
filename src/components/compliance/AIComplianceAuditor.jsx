import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Shield,
  TrendingUp,
  XCircle
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

export default function AIComplianceAuditor() {
  const queryClient = useQueryClient();
  const [selectedAudits, setSelectedAudits] = useState([]);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [auditReport, setAuditReport] = useState(null);

  const { data: flaggedAudits = [], isLoading } = useQuery({
    queryKey: ['flaggedAudits'],
    queryFn: () => base44.entities.ComplianceAudit.filter({
      status: 'flagged'
    }, '-audit_date', 50),
    initialData: [],
  });

  const aiAuditMutation = useMutation({
    mutationFn: async (auditIds) => {
      const response = await base44.functions.invoke('aiComplianceAudit', {
        audit_ids: auditIds
      });
      return response.data;
    },
    onSuccess: (data) => {
      setAuditReport(data);
      setReportDialogOpen(true);
      setSelectedAudits([]);
      queryClient.invalidateQueries({ queryKey: ['flaggedAudits'] });
      queryClient.invalidateQueries({ queryKey: ['nurseComplianceAudits'] });
    },
  });

  const handleSelectAudit = (auditId) => {
    setSelectedAudits(prev => 
      prev.includes(auditId) 
        ? prev.filter(id => id !== auditId)
        : [...prev, auditId]
    );
  };

  const handleSelectAll = () => {
    if (selectedAudits.length === flaggedAudits.length) {
      setSelectedAudits([]);
    } else {
      setSelectedAudits(flaggedAudits.map(a => a.id));
    }
  };

  const getRiskColor = (severity) => {
    const colors = {
      critical: "bg-red-100 text-red-800 border-red-300",
      high: "bg-orange-100 text-orange-800 border-orange-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      low: "bg-blue-100 text-blue-800 border-blue-300"
    };
    return colors[severity] || colors.medium;
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="w-6 h-6 text-purple-600" />
            AI Compliance Auditor
          </CardTitle>
          <p className="text-sm text-gray-600">
            Use AI to automatically review flagged documentation, identify risks, and generate audit reports
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                disabled={flaggedAudits.length === 0}
              >
                {selectedAudits.length === flaggedAudits.length ? 'Deselect All' : 'Select All'}
              </Button>
              <span className="text-sm text-gray-600">
                {selectedAudits.length} of {flaggedAudits.length} selected
              </span>
            </div>
            <Button
              onClick={() => aiAuditMutation.mutate(selectedAudits)}
              disabled={selectedAudits.length === 0 || aiAuditMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {aiAuditMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Auditing {selectedAudits.length} Document{selectedAudits.length > 1 ? 's' : ''}...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Run AI Audit
                </>
              )}
            </Button>
          </div>

          {aiAuditMutation.isError && (
            <Alert variant="destructive" className="mb-4">
              <XCircle className="w-4 h-4" />
              <AlertDescription>
                {aiAuditMutation.error?.message || 'Failed to run AI audit'}
              </AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
            </div>
          ) : flaggedAudits.length === 0 ? (
            <Alert>
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-800">
                No flagged audits found. All documentation is currently compliant!
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {flaggedAudits.map((audit) => (
                <Card key={audit.id} className="border-l-4 border-l-orange-400">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedAudits.includes(audit.id)}
                        onCheckedChange={() => handleSelectAudit(audit.id)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-medium text-gray-900">
                              Visit ID: {audit.visit_id?.substring(0, 8)}...
                            </p>
                            <p className="text-sm text-gray-600">
                              Nurse: {audit.nurse_email}
                            </p>
                          </div>
                          <Badge variant="outline" className="bg-orange-50 text-orange-700">
                            Score: {audit.compliance_score}/100
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-600">
                          <p className="font-medium mb-1">Issues Found:</p>
                          <ul className="list-disc list-inside space-y-1">
                            {audit.issues?.slice(0, 2).map((issue, idx) => (
                              <li key={idx}>{issue.element}: {issue.problem}</li>
                            ))}
                            {audit.issues?.length > 2 && (
                              <li className="text-gray-500">+{audit.issues.length - 2} more issues</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit Report Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          {auditReport && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl">
                  <Shield className="w-6 h-6 text-purple-600" />
                  AI Compliance Audit Report
                </DialogTitle>
                <DialogDescription>
                  Generated: {new Date(auditReport.generated_at).toLocaleString()}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                {/* Executive Summary */}
                <Card className="border-2 border-purple-200 bg-purple-50">
                  <CardHeader>
                    <CardTitle className="text-lg">Executive Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-gray-800">
                      {auditReport.report_summary?.executive_summary}
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-white p-3 rounded-lg">
                        <p className="text-2xl font-bold text-red-600">
                          {auditReport.report_summary?.critical_findings_count || 0}
                        </p>
                        <p className="text-xs text-gray-600">Critical Findings</p>
                      </div>
                      <div className="bg-white p-3 rounded-lg">
                        <p className="text-2xl font-bold text-orange-600">
                          {auditReport.report_summary?.high_risk_findings_count || 0}
                        </p>
                        <p className="text-xs text-gray-600">High Risk Findings</p>
                      </div>
                      <div className="bg-white p-3 rounded-lg">
                        <p className="text-2xl font-bold text-blue-600">
                          {auditReport.report_summary?.total_corrections_needed || 0}
                        </p>
                        <p className="text-xs text-gray-600">Corrections Needed</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Key Recommendations */}
                {auditReport.report_summary?.key_recommendations && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-green-600" />
                        Key Recommendations
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {auditReport.report_summary.key_recommendations.map((rec, idx) => (
                          <li key={idx} className="flex gap-2 text-sm">
                            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Individual Audit Results */}
                {auditReport.results?.map((result, idx) => (
                  <Card key={idx} className="border-l-4 border-l-purple-400">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">
                            Audit #{idx + 1} - Visit {result.visit_id?.substring(0, 8)}
                          </CardTitle>
                          <p className="text-sm text-gray-600">Nurse: {result.nurse_email}</p>
                        </div>
                        <Badge className={getRiskColor(result.analysis.overall_risk_level)}>
                          {result.analysis.overall_risk_level.toUpperCase()} Risk
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Risk Score */}
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm font-medium mb-1">AI Risk Score</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${
                                result.analysis.risk_score > 70 ? 'bg-red-500' :
                                result.analysis.risk_score > 40 ? 'bg-orange-500' :
                                'bg-green-500'
                              }`}
                              style={{ width: `${result.analysis.risk_score}%` }}
                            />
                          </div>
                          <span className="text-sm font-bold">{result.analysis.risk_score}/100</span>
                        </div>
                      </div>

                      {/* Compliance Risks */}
                      {result.analysis.compliance_risks?.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-orange-600" />
                            Compliance Risks Identified ({result.analysis.compliance_risks.length})
                          </h4>
                          <div className="space-y-2">
                            {result.analysis.compliance_risks.map((risk, rIdx) => (
                              <div key={rIdx} className="bg-gray-50 p-3 rounded-lg text-sm">
                                <div className="flex items-start justify-between mb-1">
                                  <span className="font-medium">{risk.category}</span>
                                  <Badge className={getRiskColor(risk.severity)} size="sm">
                                    {risk.severity}
                                  </Badge>
                                </div>
                                <p className="text-gray-700 mb-1">{risk.description}</p>
                                {risk.regulatory_reference && (
                                  <p className="text-xs text-blue-600">📋 {risk.regulatory_reference}</p>
                                )}
                                {risk.potential_impact && (
                                  <p className="text-xs text-gray-600">Impact: {risk.potential_impact}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Suggested Corrections */}
                      {result.analysis.suggested_corrections?.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                            <FileText className="w-4 h-4 text-blue-600" />
                            Suggested Corrections ({result.analysis.suggested_corrections.length})
                          </h4>
                          <div className="space-y-3">
                            {result.analysis.suggested_corrections.map((correction, cIdx) => (
                              <div key={cIdx} className="bg-blue-50 p-3 rounded-lg text-sm">
                                <p className="font-medium text-gray-900 mb-1">{correction.issue}</p>
                                {correction.current_text && (
                                  <div className="mb-2">
                                    <p className="text-xs text-gray-600 mb-1">Current:</p>
                                    <p className="text-xs bg-red-50 p-2 rounded border border-red-200">
                                      {correction.current_text}
                                    </p>
                                  </div>
                                )}
                                <div className="mb-2">
                                  <p className="text-xs text-gray-600 mb-1">Suggested:</p>
                                  <p className="text-xs bg-green-50 p-2 rounded border border-green-200">
                                    {correction.suggested_text}
                                  </p>
                                </div>
                                <p className="text-xs text-gray-600 italic">{correction.rationale}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Missing Elements */}
                      {result.analysis.missing_elements?.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-sm mb-2">Missing Required Elements</h4>
                          <ul className="list-disc list-inside space-y-1 text-sm">
                            {result.analysis.missing_elements.map((element, eIdx) => (
                              <li key={eIdx} className="text-gray-700">{element}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Best Practices */}
                      {result.analysis.best_practices?.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                            Best Practice Recommendations
                          </h4>
                          <ul className="space-y-1 text-sm">
                            {result.analysis.best_practices.map((practice, pIdx) => (
                              <li key={pIdx} className="flex gap-2">
                                <span className="text-green-600">✓</span>
                                <span className="text-gray-700">{practice}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Audit Summary */}
                      {result.analysis.audit_summary && (
                        <div className="bg-purple-50 p-3 rounded-lg">
                          <p className="text-sm text-gray-800">{result.analysis.audit_summary}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}