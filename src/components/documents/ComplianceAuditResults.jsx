import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { ShieldAlert, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";

export default function ComplianceAuditResults({ auditResults }) {
  if (!auditResults) return null;

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <XCircle className="w-4 h-4 text-red-600" />;
      case 'high': return <AlertTriangle className="w-4 h-4 text-orange-600" />;
      case 'medium': return <Info className="w-4 h-4 text-yellow-600" />;
      case 'low': return <CheckCircle2 className="w-4 h-4 text-blue-600" />;
      default: return <Info className="w-4 h-4 text-slate-600" />;
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'low': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      default: return 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200';
    }
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card className="border-2 border-orange-200 dark:border-orange-800">
      <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950">
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-orange-600" />
          Compliance Audit
        </CardTitle>
        <CardDescription>
          Automated compliance and documentation quality check
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {/* Overall Score */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Compliance Score
            </span>
            <span className={`text-2xl font-bold ${getScoreColor(auditResults.overall_score)}`}>
              {auditResults.overall_score}%
            </span>
          </div>
          <Progress value={auditResults.overall_score} className="h-2" />
        </div>

        {/* Summary */}
        {auditResults.summary && (
          <Alert>
            <Info className="w-4 h-4" />
            <AlertDescription>{auditResults.summary}</AlertDescription>
          </Alert>
        )}

        {/* Issues Found */}
        {auditResults.issues && auditResults.issues.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Issues Identified ({auditResults.issues.length})
            </h3>
            <div className="space-y-2">
              {auditResults.issues.map((issue, idx) => (
                <div 
                  key={idx}
                  className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
                >
                  <div className="flex items-start gap-2 mb-2">
                    {getSeverityIcon(issue.severity)}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {issue.category || 'Documentation Issue'}
                        </span>
                        <Badge className={getSeverityColor(issue.severity)}>
                          {issue.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {issue.description}
                      </p>
                    </div>
                  </div>
                  
                  {issue.recommendation && (
                    <div className="mt-2 pl-6 text-sm text-slate-600 dark:text-slate-400 border-l-2 border-blue-300 dark:border-blue-700">
                      <strong className="text-blue-600 dark:text-blue-400">Recommendation:</strong> {issue.recommendation}
                    </div>
                  )}

                  {issue.regulation_reference && (
                    <div className="mt-1 pl-6 text-xs text-slate-500 dark:text-slate-500">
                      Reference: {issue.regulation_reference}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Strengths */}
        {auditResults.strengths && auditResults.strengths.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              Compliant Areas ({auditResults.strengths.length})
            </h3>
            <div className="space-y-1">
              {auditResults.strengths.map((strength, idx) => (
                <div 
                  key={idx}
                  className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"
                >
                  <CheckCircle2 className="w-3 h-3 text-green-600 flex-shrink-0" />
                  {strength}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Missing Elements */}
        {auditResults.missing_elements && auditResults.missing_elements.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-600" />
              Missing Required Elements
            </h3>
            <div className="space-y-1">
              {auditResults.missing_elements.map((element, idx) => (
                <div 
                  key={idx}
                  className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"
                >
                  <XCircle className="w-3 h-3 text-red-600 flex-shrink-0" />
                  {element}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}