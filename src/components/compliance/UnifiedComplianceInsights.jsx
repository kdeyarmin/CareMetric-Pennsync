import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AdvancedRegulatoryCompliance from "./AdvancedRegulatoryCompliance";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  FileText,
  Target,
  Zap,
  ChevronRight,
  Copy,
  Sparkles,
  TrendingUp,
  BookOpen,
  Bell
} from "lucide-react";

export default function UnifiedComplianceInsights({ 
  insights,
  onApplyFix,
  onApplyAllFixes,
  onCreateTask,
  isLoading = false
}) {
  const [appliedFixes, setAppliedFixes] = useState(new Set());

  if (isLoading) {
    return (
      <Card className="border-2 border-blue-300">
        <CardContent className="p-8 sm:p-12 text-center">
          <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-b-4 border-blue-600 mx-auto mb-4" />
          <p className="text-sm sm:text-base text-gray-600">Running comprehensive compliance analysis...</p>
          <p className="text-xs sm:text-sm text-gray-500 mt-2">Checking Medicare CoP, guidelines, OASIS, PDGM...</p>
        </CardContent>
      </Card>
    );
  }

  if (!insights) {
    return null;
  }

  const summary = insights.summary || {};
  const criticalIssues = insights.critical_issues || [];
  const hasIssues = summary.total_issues > 0;

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 75) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBgColor = (score) => {
    if (score >= 90) return 'bg-green-600';
    if (score >= 75) return 'bg-yellow-600';
    return 'bg-red-600';
  };

  const handleApplyFix = (fix, element) => {
    onApplyFix?.(fix);
    setAppliedFixes(prev => new Set([...prev, element]));
  };

  const handleApplyAll = () => {
    const allFixes = [
      ...(insights.compliance_violations || []).map(v => v.suggested_fix),
      ...(insights.guideline_gaps || []).map(g => g.recommendation),
      ...(insights.visit_type_gaps || []).map(g => g.recommendation)
    ].filter(Boolean);

    onApplyAllFixes?.(allFixes);
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header with Overall Score */}
      <Card className={`border-4 ${hasIssues ? 'border-orange-400 bg-gradient-to-r from-orange-50 to-red-50' : 'border-green-400 bg-gradient-to-r from-green-50 to-emerald-50'} shadow-xl`}>
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full ${getScoreBgColor(insights.overall_compliance_score)} flex items-center justify-center`}>
                <Shield className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-xl sm:text-2xl font-bold text-gray-900">
                    {insights.overall_compliance_score}%
                  </h3>
                  <Badge className={getScoreBgColor(insights.overall_compliance_score)}>
                    {insights.overall_compliance_score >= 90 ? 'Excellent' : 
                     insights.overall_compliance_score >= 75 ? 'Good' : 'Needs Work'}
                  </Badge>
                </div>
                <p className="text-xs sm:text-sm text-gray-600">Overall Compliance Score</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 w-full sm:w-auto">
              <div className="text-center p-2 sm:p-3 bg-white rounded-lg border">
                <p className="text-xl sm:text-2xl font-bold text-red-600">{summary.critical_count || 0}</p>
                <p className="text-[10px] sm:text-xs text-gray-600">Critical</p>
              </div>
              <div className="text-center p-2 sm:p-3 bg-white rounded-lg border">
                <p className="text-xl sm:text-2xl font-bold text-orange-600">{summary.high_priority_count || 0}</p>
                <p className="text-[10px] sm:text-xs text-gray-600">High</p>
              </div>
              <div className="text-center p-2 sm:p-3 bg-white rounded-lg border">
                <p className="text-xl sm:text-2xl font-bold text-green-600">{insights.compliant_elements?.length || 0}</p>
                <p className="text-[10px] sm:text-xs text-gray-600">Compliant</p>
              </div>
              <div className="text-center p-2 sm:p-3 bg-white rounded-lg border">
                <p className="text-lg sm:text-xl font-bold text-purple-600">${summary.revenue_opportunity || 0}</p>
                <p className="text-[10px] sm:text-xs text-gray-600">Revenue</p>
              </div>
            </div>
          </div>

          {hasIssues && (
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <Button
                onClick={handleApplyAll}
                className="flex-1 bg-orange-600 hover:bg-orange-700 min-h-[44px]"
              >
                <Zap className="w-4 h-4 mr-2" />
                Auto-Fix All Issues
              </Button>
              <Button
                variant="outline"
                onClick={() => onCreateTask?.('Review and address compliance gaps')}
                className="flex-1 min-h-[44px]"
              >
                Create Follow-up Task
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Critical Alerts - Always Visible if Present */}
      {criticalIssues.length > 0 && (
        <Alert className="bg-red-50 border-2 border-red-400">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <AlertDescription>
            <p className="font-semibold text-sm sm:text-base text-red-900 mb-2">
              {criticalIssues.length} Critical Issue{criticalIssues.length > 1 ? 's' : ''} Require Immediate Attention
            </p>
            <div className="space-y-2">
              {criticalIssues.slice(0, 3).map((issue, idx) => (
                <div key={idx} className="text-xs sm:text-sm text-red-800">
                  • {issue.element || issue.guideline || issue.requirement}: {issue.issue || issue.gap}
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Clinical Alerts */}
      {insights.clinical_alerts?.length > 0 && (
        <Card className="border-2 border-red-400 bg-red-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-red-700">
              <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
              Clinical Alerts ({insights.clinical_alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {insights.clinical_alerts.map((alert, idx) => (
                <div key={idx} className={`p-3 rounded-lg border-2 ${
                  alert.severity === 'CRITICAL' ? 'bg-red-100 border-red-400' :
                  alert.severity === 'HIGH' ? 'bg-orange-100 border-orange-400' :
                  'bg-yellow-100 border-yellow-400'
                }`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={
                          alert.severity === 'CRITICAL' ? 'bg-red-600' :
                          alert.severity === 'HIGH' ? 'bg-orange-600' :
                          'bg-yellow-600'
                        }>
                          {alert.severity}
                        </Badge>
                        {alert.time_sensitive && (
                          <Badge className="bg-red-700 animate-pulse">URGENT</Badge>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm font-semibold text-gray-900">{alert.alert_type}</p>
                      <p className="text-xs sm:text-sm text-gray-700 mt-1">{alert.finding}</p>
                    </div>
                  </div>
                  <div className="bg-white p-2 rounded border mt-2">
                    <p className="text-[10px] sm:text-xs font-semibold text-gray-700 mb-1">Recommended Action:</p>
                    <p className="text-xs sm:text-sm text-gray-800">{alert.recommended_action}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onCreateTask?.(alert.recommended_action)}
                    className="mt-2 w-full sm:w-auto min-h-[40px]"
                  >
                    Create Task
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabbed Details */}
      <Card className="border-2 border-gray-300">
        <Tabs defaultValue="violations" className="w-full">
          <TabsList className="w-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1 h-auto p-1">
            <TabsTrigger value="violations" className="text-xs sm:text-sm py-2 px-1">
              <Shield className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
              <span className="hidden sm:inline">Medicare </span>({insights.compliance_violations?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="guidelines" className="text-xs sm:text-sm py-2 px-1">
              <BookOpen className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
              <span className="hidden sm:inline">Guidelines </span>({insights.guideline_gaps?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="visit-type" className="text-xs sm:text-sm py-2 px-1">
              <FileText className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
              <span className="hidden sm:inline">Visit </span>({insights.visit_type_gaps?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="oasis" className="text-xs sm:text-sm py-2 px-1">
              <Target className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
              <span className="hidden sm:inline">OASIS </span>({insights.oasis_mappings?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="pdgm" className="text-xs sm:text-sm py-2 px-1">
              <DollarSign className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
              <span className="hidden sm:inline">PDGM </span>({insights.pdgm_opportunities?.length || 0})
            </TabsTrigger>
          </TabsList>

          {/* Medicare Violations Tab */}
          <TabsContent value="violations" className="p-3 sm:p-4 space-y-2 sm:space-y-3">
            {insights.compliance_violations?.length > 0 ? (
              insights.compliance_violations.map((violation, idx) => (
                <Card key={idx} className={`border-l-4 ${
                  violation.severity === 'critical' ? 'border-l-red-600 bg-red-50' :
                  violation.severity === 'high' ? 'border-l-orange-500 bg-orange-50' :
                  'border-l-yellow-500 bg-yellow-50'
                }`}>
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge className={
                            violation.severity === 'critical' ? 'bg-red-600' :
                            violation.severity === 'high' ? 'bg-orange-600' :
                            'bg-yellow-600'
                          }>
                            {violation.severity}
                          </Badge>
                          <p className="font-semibold text-xs sm:text-sm text-gray-900 break-words">{violation.element}</p>
                        </div>
                        <p className="text-xs sm:text-sm text-gray-700 mt-1">{violation.issue}</p>
                      </div>
                    </div>

                    {violation.regulatory_reference && (
                      <div className="bg-blue-50 p-2 rounded border border-blue-200 mb-2">
                        <p className="text-[10px] sm:text-xs text-blue-800">
                          📖 Reference: {violation.regulatory_reference}
                        </p>
                      </div>
                    )}

                    <div className="bg-white p-2 sm:p-3 rounded border mt-2">
                      <p className="text-[10px] sm:text-xs font-semibold text-green-700 mb-1">✅ Suggested Fix:</p>
                      <p className="text-xs sm:text-sm text-gray-800">{violation.suggested_fix}</p>
                    </div>

                    <Button
                      size="sm"
                      onClick={() => handleApplyFix(violation.suggested_fix, violation.element)}
                      disabled={appliedFixes.has(violation.element)}
                      className="w-full sm:w-auto bg-green-600 hover:bg-green-700 min-h-[40px] text-xs sm:text-sm mt-3"
                    >
                      {appliedFixes.has(violation.element) ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                          Applied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                          Apply Fix
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="text-center py-6 sm:py-8 text-gray-500">
                <CheckCircle2 className="w-10 h-10 sm:w-12 sm:h-12 text-green-500 mx-auto mb-2 sm:mb-3" />
                <p className="text-sm sm:text-base font-medium">All Medicare requirements met!</p>
              </div>
            )}
          </TabsContent>

          {/* Clinical Guidelines Tab */}
          <TabsContent value="guidelines" className="p-3 sm:p-4 space-y-2 sm:space-y-3">
            {insights.guideline_gaps?.length > 0 ? (
              insights.guideline_gaps.map((gap, idx) => (
                <Card key={idx} className="border-l-4 border-l-blue-500 bg-blue-50">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge className={
                        gap.priority === 'high' ? 'bg-orange-600' :
                        gap.priority === 'medium' ? 'bg-yellow-600' :
                        'bg-blue-600'
                      }>
                        {gap.priority} priority
                      </Badge>
                      <p className="font-semibold text-xs sm:text-sm text-gray-900 break-words">{gap.guideline}</p>
                    </div>
                    <p className="text-xs sm:text-sm text-gray-700 mb-2">{gap.gap}</p>
                    <div className="bg-white p-2 sm:p-3 rounded border">
                      <p className="text-[10px] sm:text-xs font-semibold text-blue-700 mb-1">💡 Recommendation:</p>
                      <p className="text-xs sm:text-sm text-gray-800">{gap.recommendation}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleApplyFix(gap.recommendation, gap.guideline)}
                      className="mt-2 w-full sm:w-auto bg-blue-600 hover:bg-blue-700 min-h-[40px] text-xs sm:text-sm"
                    >
                      <Copy className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                      Apply Recommendation
                    </Button>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="text-center py-6 sm:py-8 text-gray-500">
                <CheckCircle2 className="w-10 h-10 sm:w-12 sm:h-12 text-green-500 mx-auto mb-2 sm:mb-3" />
                <p className="text-sm sm:text-base font-medium">Follows current clinical guidelines!</p>
              </div>
            )}
          </TabsContent>

          {/* Visit Type Requirements Tab */}
          <TabsContent value="visit-type" className="p-3 sm:p-4 space-y-2 sm:space-y-3">
            {insights.visit_type_gaps?.length > 0 ? (
              insights.visit_type_gaps.map((gap, idx) => (
                <Card key={idx} className="border-l-4 border-l-purple-500 bg-purple-50">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge className={gap.status === 'missing' ? 'bg-red-600' : 'bg-yellow-600'}>
                        {gap.status}
                      </Badge>
                      <p className="font-semibold text-xs sm:text-sm text-gray-900 break-words">{gap.requirement}</p>
                    </div>
                    <div className="bg-white p-2 sm:p-3 rounded border">
                      <p className="text-xs sm:text-sm text-gray-800">{gap.recommendation}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleApplyFix(gap.recommendation, gap.requirement)}
                      className="mt-2 w-full sm:w-auto bg-purple-600 hover:bg-purple-700 min-h-[40px] text-xs sm:text-sm"
                    >
                      <Copy className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                      Add to Note
                    </Button>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="text-center py-6 sm:py-8 text-gray-500">
                <CheckCircle2 className="w-10 h-10 sm:w-12 sm:h-12 text-green-500 mx-auto mb-2 sm:mb-3" />
                <p className="text-sm sm:text-base font-medium">All visit-type requirements met!</p>
              </div>
            )}
          </TabsContent>

          {/* OASIS Mappings Tab */}
          <TabsContent value="oasis" className="p-3 sm:p-4 space-y-2 sm:space-y-3">
            {insights.oasis_mappings?.length > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-green-50 p-2 rounded border text-center">
                    <p className="text-xs text-green-600">High Confidence</p>
                    <p className="text-lg sm:text-xl font-bold text-green-900">
                      {insights.oasis_mappings.filter(m => m.confidence >= 80).length}
                    </p>
                  </div>
                  <div className="bg-yellow-50 p-2 rounded border text-center">
                    <p className="text-xs text-yellow-600">Medium</p>
                    <p className="text-lg sm:text-xl font-bold text-yellow-900">
                      {insights.oasis_mappings.filter(m => m.confidence >= 60 && m.confidence < 80).length}
                    </p>
                  </div>
                  <div className="bg-red-50 p-2 rounded border text-center">
                    <p className="text-xs text-red-600">Low</p>
                    <p className="text-lg sm:text-xl font-bold text-red-900">
                      {insights.oasis_mappings.filter(m => m.confidence < 60).length}
                    </p>
                  </div>
                </div>

                <Accordion type="single" collapsible className="space-y-2">
                  {insights.oasis_mappings.map((mapping, idx) => (
                    <AccordionItem 
                      key={idx} 
                      value={`oasis-${idx}`}
                      className={`border-2 rounded-lg ${
                        mapping.confidence >= 80 ? 'border-green-300' :
                        mapping.confidence >= 60 ? 'border-yellow-300' :
                        'border-red-300'
                      }`}
                    >
                      <AccordionTrigger className="px-3 sm:px-4 py-2 hover:no-underline">
                        <div className="flex items-center gap-2 text-left w-full">
                          <Badge className={
                            mapping.confidence >= 80 ? 'bg-green-600' :
                            mapping.confidence >= 60 ? 'bg-yellow-600' :
                            'bg-red-600'
                          }>
                            {mapping.confidence}%
                          </Badge>
                          <span className="text-xs sm:text-sm font-semibold flex-1 break-words">{mapping.oasis_item}</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-3 sm:px-4 pb-3 space-y-2">
                        <div className="bg-blue-50 p-2 rounded text-xs sm:text-sm">
                          <p className="font-semibold text-blue-900">Suggested Value:</p>
                          <p className="text-blue-800">{mapping.suggested_value}</p>
                        </div>
                        <div className="bg-gray-50 p-2 rounded text-xs sm:text-sm">
                          <p className="font-semibold text-gray-900">Evidence:</p>
                          <p className="text-gray-700 italic">"{mapping.evidence}"</p>
                        </div>
                        {mapping.pdgm_impact && (
                          <div className="bg-green-50 p-2 rounded text-xs sm:text-sm">
                            <p className="font-semibold text-green-900">PDGM Impact:</p>
                            <p className="text-green-800">{mapping.pdgm_impact}</p>
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>

                {insights.missing_oasis_items?.length > 0 && (
                  <Alert className="bg-yellow-50 border-yellow-300 mt-3">
                    <AlertTriangle className="w-4 h-4 text-yellow-600" />
                    <AlertDescription className="text-xs sm:text-sm">
                      <p className="font-semibold mb-1">Missing OASIS Documentation:</p>
                      <ul className="space-y-1">
                        {insights.missing_oasis_items.map((item, idx) => (
                          <li key={idx} className="text-gray-700">• {item}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </>
            ) : (
              <div className="text-center py-6 sm:py-8 text-gray-500">
                <FileText className="w-10 h-10 sm:w-12 sm:h-12 text-gray-300 mx-auto mb-2 sm:mb-3" />
                <p className="text-sm sm:text-base">No OASIS items could be mapped from this note</p>
              </div>
            )}
          </TabsContent>

          {/* PDGM Opportunities Tab */}
          <TabsContent value="pdgm" className="p-3 sm:p-4 space-y-2 sm:space-y-3">
            {insights.pdgm_opportunities?.length > 0 ? (
              <>
                {insights.estimated_revenue_gain > 0 && (
                  <Alert className="bg-green-50 border-green-300">
                    <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
                    <AlertDescription className="text-xs sm:text-sm">
                      <p className="font-semibold text-green-900">
                        Estimated Revenue Opportunity: ${insights.estimated_revenue_gain}
                      </p>
                      <p className="text-green-700 mt-1">
                        Improving documentation could increase case-mix reimbursement
                      </p>
                    </AlertDescription>
                  </Alert>
                )}

                {insights.pdgm_opportunities.map((opp, idx) => (
                  <Card key={idx} className="border-l-4 border-l-green-500 bg-green-50">
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge className={
                          opp.priority === 'high' ? 'bg-green-700' :
                          opp.priority === 'medium' ? 'bg-green-600' :
                          'bg-green-500'
                        }>
                          {opp.category}
                        </Badge>
                        {opp.revenue_impact > 0 && (
                          <Badge className="bg-yellow-600">+${opp.revenue_impact}</Badge>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-gray-900 font-semibold mb-1">{opp.finding}</p>
                      <div className="bg-white p-2 sm:p-3 rounded border mt-2">
                        <p className="text-[10px] sm:text-xs font-semibold text-green-700 mb-1">📝 Documentation Needed:</p>
                        <p className="text-xs sm:text-sm text-gray-800">{opp.documentation_needed}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleApplyFix(opp.documentation_needed, opp.category)}
                        className="mt-2 w-full sm:w-auto bg-green-600 hover:bg-green-700 min-h-[40px] text-xs sm:text-sm"
                      >
                        <Copy className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                        Add Documentation
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </>
            ) : (
              <div className="text-center py-6 sm:py-8 text-gray-500">
                <CheckCircle2 className="w-10 h-10 sm:w-12 sm:h-12 text-green-500 mx-auto mb-2 sm:mb-3" />
                <p className="text-sm sm:text-base font-medium">PDGM documentation optimized!</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </Card>

      {/* Remaining Documentation Gaps */}
      {insights.remaining_documentation_gaps?.length > 0 && (
        <Card className="border-2 border-indigo-300">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-indigo-700">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
              Additional Improvements Needed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {insights.remaining_documentation_gaps.map((gap, idx) => (
              <div key={idx} className="p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                <p className="text-xs sm:text-sm font-semibold text-gray-900 mb-1">{gap.element}</p>
                <p className="text-xs sm:text-sm text-gray-700 mb-2">{gap.why_missing}</p>
                <p className="text-xs sm:text-sm text-indigo-700">
                  <strong>How to address:</strong> {gap.how_to_address}
                </p>
                {!gap.can_fix_now && (
                  <Badge variant="outline" className="mt-2 text-xs">
                    Requires additional patient data
                  </Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Action Summary */}
      <Card className="border-2 border-blue-400 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="p-4 sm:p-6">
          <h3 className="font-semibold text-sm sm:text-base text-gray-900 mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
            Next Steps
          </h3>
          <div className="space-y-2">
            {summary.critical_count > 0 && (
              <div className="flex items-center gap-2 text-xs sm:text-sm text-red-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>Address {summary.critical_count} critical compliance issue{summary.critical_count > 1 ? 's' : ''} before submitting</span>
              </div>
            )}
            {summary.high_priority_count > 0 && (
              <div className="flex items-center gap-2 text-xs sm:text-sm text-orange-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>Review {summary.high_priority_count} high-priority gap{summary.high_priority_count > 1 ? 's' : ''}</span>
              </div>
            )}
            {summary.revenue_opportunity > 0 && (
              <div className="flex items-center gap-2 text-xs sm:text-sm text-green-700">
                <DollarSign className="w-4 h-4 flex-shrink-0" />
                <span>Potential ${summary.revenue_opportunity} revenue gain with improved documentation</span>
              </div>
            )}
            {summary.oasis_items_mapped > 0 && (
              <div className="flex items-center gap-2 text-xs sm:text-sm text-purple-700">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{summary.oasis_items_mapped} OASIS items mapped automatically</span>
              </div>
            )}
            {summary.training_recommendations_created > 0 && (
              <div className="flex items-center gap-2 text-xs sm:text-sm text-blue-700">
                <BookOpen className="w-4 h-4 flex-shrink-0" />
                <span>{summary.training_recommendations_created} personalized training recommendations created</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Advanced Regulatory Compliance */}
      <AdvancedRegulatoryCompliance 
        complianceData={insights}
        onApplyFix={handleApplyFix}
        onCreateTask={onCreateTask}
      />
    </div>
  );
}