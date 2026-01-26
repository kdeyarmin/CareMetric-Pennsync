import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  ShieldAlert, 
  AlertTriangle, 
  CheckCircle2, 
  FileWarning,
  Brain,
  Zap,
  ChevronDown,
  ChevronUp,
  Activity
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const getSeverityIcon = (severity) => {
  switch (severity) {
    case 'critical': return <ShieldAlert className="w-4 h-4 text-red-600" />;
    case 'high': return <AlertTriangle className="w-4 h-4 text-orange-600" />;
    case 'medium': return <FileWarning className="w-4 h-4 text-amber-600" />;
    default: return <Activity className="w-4 h-4 text-blue-600" />;
  }
};

const getSeverityColor = (severity) => {
  switch (severity) {
    case 'critical': return 'border-red-300 bg-red-50 dark:bg-red-950';
    case 'high': return 'border-orange-300 bg-orange-50 dark:bg-orange-950';
    case 'medium': return 'border-amber-300 bg-amber-50 dark:bg-amber-950';
    default: return 'border-blue-300 bg-blue-50 dark:bg-blue-950';
  }
};

export default function UnifiedComplianceAudit({ 
  complianceResults, 
  medicareViolations = [], 
  regulatoryWarnings = [],
  qualityAnalysis 
}) {
  const [expandedIssues, setExpandedIssues] = useState({});

  if (!complianceResults && !qualityAnalysis && medicareViolations.length === 0 && regulatoryWarnings.length === 0) {
    return null;
  }

  const toggleIssue = (key) => {
    setExpandedIssues(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Calculate overall status
  const complianceScore = complianceResults?.compliance_score || 0;
  const qualityScore = qualityAnalysis?.overall_quality_score || 0;
  const completenessScore = qualityAnalysis?.completeness_score || 0;
  
  const totalIssues = (complianceResults?.issues?.length || 0) + medicareViolations.length + regulatoryWarnings.length;
  const criticalIssues = [
    ...(complianceResults?.issues || []),
    ...medicareViolations
  ].filter(i => i.severity === 'critical').length;

  const overallStatus = complianceScore >= 85 && qualityScore >= 80 && criticalIssues === 0 ? 'passed' : 
                        criticalIssues > 0 ? 'critical' : 'warning';

  return (
    <Card className={`border-2 ${
      overallStatus === 'passed' ? 'border-green-300 bg-green-50/50 dark:bg-green-950/30' :
      overallStatus === 'critical' ? 'border-red-300 bg-red-50/50 dark:bg-red-950/30' :
      'border-amber-300 bg-amber-50/50 dark:bg-amber-950/30'
    }`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {overallStatus === 'passed' ? (
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            ) : overallStatus === 'critical' ? (
              <ShieldAlert className="w-6 h-6 text-red-600" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            )}
            <span>Unified Compliance & Quality Audit</span>
          </div>
          <Badge className={
            overallStatus === 'passed' ? 'bg-green-600' :
            overallStatus === 'critical' ? 'bg-red-600' :
            'bg-amber-600'
          }>
            {totalIssues} Issue{totalIssues !== 1 ? 's' : ''} Found
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score Overview */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-white dark:bg-slate-900 rounded-lg border">
            <ShieldAlert className={`w-6 h-6 mx-auto mb-2 ${complianceScore >= 85 ? 'text-green-600' : 'text-red-600'}`} />
            <p className="text-xs text-slate-500 mb-1">Medicare Compliance</p>
            <p className={`text-2xl font-bold ${complianceScore >= 85 ? 'text-green-600' : 'text-red-600'}`}>
              {complianceScore}%
            </p>
            <Progress value={complianceScore} className="h-1 mt-2" />
          </div>
          <div className="text-center p-4 bg-white dark:bg-slate-900 rounded-lg border">
            <Brain className={`w-6 h-6 mx-auto mb-2 ${qualityScore >= 80 ? 'text-purple-600' : 'text-amber-600'}`} />
            <p className="text-xs text-slate-500 mb-1">Quality Score</p>
            <p className={`text-2xl font-bold ${qualityScore >= 80 ? 'text-purple-600' : 'text-amber-600'}`}>
              {qualityScore}%
            </p>
            <Progress value={qualityScore} className="h-1 mt-2" />
          </div>
          <div className="text-center p-4 bg-white dark:bg-slate-900 rounded-lg border">
            <FileWarning className={`w-6 h-6 mx-auto mb-2 ${completenessScore >= 90 ? 'text-blue-600' : 'text-amber-600'}`} />
            <p className="text-xs text-slate-500 mb-1">Completeness</p>
            <p className={`text-2xl font-bold ${completenessScore >= 90 ? 'text-blue-600' : 'text-amber-600'}`}>
              {completenessScore}%
            </p>
            <Progress value={completenessScore} className="h-1 mt-2" />
          </div>
        </div>

        {/* Tabbed Issue View */}
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="all">All ({totalIssues})</TabsTrigger>
            <TabsTrigger value="compliance">
              Compliance ({(complianceResults?.issues?.length || 0) + medicareViolations.length})
            </TabsTrigger>
            <TabsTrigger value="quality">
              Quality ({qualityAnalysis?.missing_elements?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="regulatory">
              Regulatory ({regulatoryWarnings.length})
            </TabsTrigger>
          </TabsList>

          {/* All Issues Tab */}
          <TabsContent value="all" className="space-y-2 mt-4">
            {totalIssues === 0 ? (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  <strong>Excellent!</strong> No compliance or quality issues detected. Your documentation meets all standards.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {/* Critical Issues First */}
                {criticalIssues > 0 && (
                  <Alert className="bg-red-50 border-red-300">
                    <ShieldAlert className="w-4 h-4 text-red-600" />
                    <AlertDescription className="text-red-800">
                      <strong>Action Required:</strong> {criticalIssues} critical issue{criticalIssues > 1 ? 's' : ''} must be addressed before submission.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Medicare Violations */}
                {medicareViolations.map((issue, idx) => (
                  <IssueCard 
                    key={`medicare-${idx}`}
                    issue={{
                      ...issue,
                      element: issue.violation,
                      problem: issue.cop_reference,
                      suggestion: issue.remediation,
                      type: 'Medicare CoP'
                    }}
                    isExpanded={expandedIssues[`medicare-${idx}`]}
                    onToggle={() => toggleIssue(`medicare-${idx}`)}
                  />
                ))}

                {/* Compliance Issues */}
                {complianceResults?.issues?.map((issue, idx) => (
                  <IssueCard 
                    key={`compliance-${idx}`}
                    issue={{ ...issue, type: 'Compliance' }}
                    isExpanded={expandedIssues[`compliance-${idx}`]}
                    onToggle={() => toggleIssue(`compliance-${idx}`)}
                  />
                ))}

                {/* Quality Gaps */}
                {qualityAnalysis?.missing_elements?.map((gap, idx) => (
                  <IssueCard 
                    key={`quality-${idx}`}
                    issue={{
                      element: gap,
                      severity: 'medium',
                      type: 'Documentation Gap',
                      suggestion: `Add ${gap} to improve documentation completeness`
                    }}
                    isExpanded={expandedIssues[`quality-${idx}`]}
                    onToggle={() => toggleIssue(`quality-${idx}`)}
                  />
                ))}

                {/* Regulatory Warnings */}
                {regulatoryWarnings.map((warning, idx) => (
                  <IssueCard 
                    key={`regulatory-${idx}`}
                    issue={{
                      element: warning,
                      severity: 'low',
                      type: 'Regulatory',
                      suggestion: 'Review and address if applicable'
                    }}
                    isExpanded={expandedIssues[`regulatory-${idx}`]}
                    onToggle={() => toggleIssue(`regulatory-${idx}`)}
                  />
                ))}
              </>
            )}
          </TabsContent>

          {/* Compliance Tab */}
          <TabsContent value="compliance" className="space-y-2 mt-4">
            {medicareViolations.map((issue, idx) => (
              <IssueCard 
                key={idx}
                issue={{
                  ...issue,
                  element: issue.violation,
                  problem: issue.cop_reference,
                  suggestion: issue.remediation,
                  type: 'Medicare CoP'
                }}
                isExpanded={expandedIssues[`compliance-tab-${idx}`]}
                onToggle={() => toggleIssue(`compliance-tab-${idx}`)}
              />
            ))}
            {complianceResults?.issues?.map((issue, idx) => (
              <IssueCard 
                key={idx}
                issue={{ ...issue, type: 'Compliance' }}
                isExpanded={expandedIssues[`compliance-issue-${idx}`]}
                onToggle={() => toggleIssue(`compliance-issue-${idx}`)}
              />
            ))}
          </TabsContent>

          {/* Quality Tab */}
          <TabsContent value="quality" className="space-y-2 mt-4">
            {qualityAnalysis?.missing_elements?.map((gap, idx) => (
              <IssueCard 
                key={idx}
                issue={{
                  element: gap,
                  severity: 'medium',
                  type: 'Documentation Gap',
                  suggestion: `Add ${gap} to improve documentation completeness`
                }}
                isExpanded={expandedIssues[`quality-tab-${idx}`]}
                onToggle={() => toggleIssue(`quality-tab-${idx}`)}
              />
            ))}
          </TabsContent>

          {/* Regulatory Tab */}
          <TabsContent value="regulatory" className="space-y-2 mt-4">
            {regulatoryWarnings.map((warning, idx) => (
              <IssueCard 
                key={idx}
                issue={{
                  element: warning,
                  severity: 'low',
                  type: 'Regulatory',
                  suggestion: 'Review and address if applicable'
                }}
                isExpanded={expandedIssues[`regulatory-tab-${idx}`]}
                onToggle={() => toggleIssue(`regulatory-tab-${idx}`)}
              />
            ))}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function IssueCard({ issue, isExpanded, onToggle }) {
  return (
    <div className={`border-l-4 rounded-lg ${getSeverityColor(issue.severity)} border overflow-hidden`}>
      <button 
        onClick={onToggle}
        className="w-full p-3 text-left hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {getSeverityIcon(issue.severity)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  {issue.element}
                </span>
                <Badge variant="outline" className="text-xs">
                  {issue.type}
                </Badge>
                <Badge className={
                  issue.severity === 'critical' ? 'bg-red-600' :
                  issue.severity === 'high' ? 'bg-orange-500' :
                  issue.severity === 'medium' ? 'bg-amber-500' :
                  'bg-blue-500'
                }>
                  {issue.severity}
                </Badge>
              </div>
              {!isExpanded && issue.problem && (
                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-1">
                  {issue.problem}
                </p>
              )}
            </div>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          {issue.problem && (
            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Problem:</p>
              <p className="text-sm text-slate-800 dark:text-slate-200">{issue.problem}</p>
            </div>
          )}
          
          {issue.suggestion && (
            <div className="bg-blue-50 dark:bg-blue-900 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">How to Fix:</p>
              <p className="text-sm text-blue-800 dark:text-blue-200">{issue.suggestion}</p>
            </div>
          )}

          {issue.specific_fix && (
            <div className="bg-green-50 dark:bg-green-900 p-3 rounded-lg border border-green-200 dark:border-green-800">
              <p className="text-xs font-semibold text-green-700 dark:text-green-300 mb-1">Example Fix:</p>
              <p className="text-sm text-green-800 dark:text-green-200 font-mono">
                {issue.specific_fix}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}