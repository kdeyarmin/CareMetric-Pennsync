import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  TrendingDown,
  Download,
  Eye,
  Flag
} from "lucide-react";
import { format, subDays } from "date-fns";
import { toast } from 'sonner';

export default function EnhancedComplianceAuditor({ onAuditComplete }) {
  const queryClient = useQueryClient();
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditProgress, setAuditProgress] = useState({ current: 0, total: 0, currentRule: '' });
  const [auditResults, setAuditResults] = useState(null);
  const [dateRange, setDateRange] = useState("7");
  const [selectedRules, setSelectedRules] = useState([]);
  const [careType, setCareType] = useState("home_health");
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedVisitDetail, setSelectedVisitDetail] = useState(null);

  const { data: visits = [] } = useQuery({
    queryKey: ['visitsForAudit'],
    queryFn: () => base44.entities.Visit.filter({ status: 'completed' }, '-visit_date', 200),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['auditPatients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
  });

  const { data: complianceRules = [] } = useQuery({
    queryKey: ['complianceRules'],
    queryFn: () => base44.entities.ComplianceRule.filter({ is_active: true }),
  });

  const { data: existingAudits = [] } = useQuery({
    queryKey: ['existingAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 500),
  });

  // Initialize selected rules when rules load
  React.useEffect(() => {
    if (complianceRules.length > 0 && selectedRules.length === 0) {
      setSelectedRules(complianceRules.map(r => r.id));
    }
  }, [complianceRules, selectedRules.length]);

  const activeRules = complianceRules.filter(r => 
    selectedRules.includes(r.id) && 
    (r.applies_to_care_type === 'both' || r.applies_to_care_type === careType)
  );

  const runComplianceAudit = async () => {
    if (activeRules.length === 0) {
      toast.error('Please select at least one compliance rule to audit against.');
      return;
    }

    setIsAuditing(true);
    setAuditResults(null);
    
    const cutoffDate = subDays(new Date(), parseInt(dateRange));
    
    // Filter visits that need auditing
    const auditedVisitIds = new Set(existingAudits.map(a => a.visit_id));
    const visitsToAudit = visits.filter(v => {
      if (!v.nurse_notes || v.nurse_notes.length < 50) return false;
      if (auditedVisitIds.has(v.id)) return false;
      const visitDate = new Date(v.visit_date);
      return visitDate >= cutoffDate;
    });

    setAuditProgress({ current: 0, total: visitsToAudit.length, currentRule: '' });

    const results = {
      audited: 0,
      passed: 0,
      flagged: 0,
      critical: 0,
      byNurse: {},
      byRule: {},
      detailedResults: []
    };

    // Initialize rule tracking
    activeRules.forEach(rule => {
      results.byRule[rule.id] = {
        rule_name: rule.rule_name,
        rule_code: rule.rule_code,
        category: rule.rule_category,
        violations: 0,
        compliant: 0,
        severity: rule.severity
      };
    });

    for (let i = 0; i < visitsToAudit.length; i++) {
      const visit = visitsToAudit[i];
      const patient = patients.find(p => p.id === visit.patient_id);
      setAuditProgress({ 
        current: i + 1, 
        total: visitsToAudit.length, 
        currentRule: `Auditing ${patient?.first_name || 'Patient'}'s visit...` 
      });

      try {
        // Build rule-specific audit prompt
        const rulesPrompt = activeRules.map(rule => 
          `RULE: ${rule.rule_name} (${rule.rule_code || 'No code'})
Category: ${rule.rule_category}
Severity: ${rule.severity}
Description: ${rule.description}
Required Elements: ${rule.required_elements?.join(', ') || 'N/A'}
Keywords to look for: ${rule.keywords?.join(', ') || 'N/A'}`
        ).join('\n\n');

        const auditResult = await invokeLLM({
          model: "claude_opus_4_8",
          prompt: `Perform a detailed compliance audit on this clinical documentation against specific rules.

VISIT TYPE: ${visit.visit_type || 'routine_visit'}
CARE TYPE: ${careType === 'hospice' ? 'Hospice' : 'Home Health'}
PATIENT: ${patient?.first_name || 'Unknown'} ${patient?.last_name || ''} - ${patient?.primary_diagnosis || 'No diagnosis'}

DOCUMENTATION:
${visit.nurse_notes}

COMPLIANCE RULES TO AUDIT AGAINST:
${rulesPrompt}

For EACH rule, determine:
1. Is the documentation compliant with this rule?
2. What specific elements are present or missing?
3. Quote relevant text that demonstrates compliance or violation
4. Provide specific remediation if non-compliant

Return JSON:
{
  "overall_compliance_score": 0-100,
  "rule_results": [
    {
      "rule_name": "Rule name",
      "rule_code": "Code if available",
      "is_compliant": true/false,
      "found_elements": ["Elements found in documentation"],
      "missing_elements": ["Required elements not found"],
      "evidence_quotes": ["Direct quotes from documentation"],
      "issue_description": "Description of non-compliance if applicable",
      "remediation": "How to fix if non-compliant",
      "severity": "critical/high/medium/low"
    }
  ],
  "summary": "Overall audit summary",
  "critical_issues": ["List of critical issues requiring immediate attention"],
  "recommendations": ["Recommendations for improvement"]
}`,
          response_json_schema: {
            type: "object",
            properties: {
              overall_compliance_score: { type: "number" },
              rule_results: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    rule_name: { type: "string" },
                    rule_code: { type: "string" },
                    is_compliant: { type: "boolean" },
                    found_elements: { type: "array", items: { type: "string" } },
                    missing_elements: { type: "array", items: { type: "string" } },
                    evidence_quotes: { type: "array", items: { type: "string" } },
                    issue_description: { type: "string" },
                    remediation: { type: "string" },
                    severity: { type: "string" }
                  }
                }
              },
              summary: { type: "string" },
              critical_issues: { type: "array", items: { type: "string" } },
              recommendations: { type: "array", items: { type: "string" } }
            }
          }
        });

        // Determine status
        const hasCritical = auditResult.rule_results?.some(r => !r.is_compliant && r.severity === 'critical');
        const hasHigh = auditResult.rule_results?.some(r => !r.is_compliant && r.severity === 'high');
        let status = 'passed';
        if (hasCritical) status = 'critical';
        else if (hasHigh || auditResult.overall_compliance_score < 70) status = 'flagged';

        // Create detailed audit record
        const auditRecord = {
          visit_id: visit.id,
          nurse_email: visit.created_by,
          patient_id: visit.patient_id,
          audit_date: new Date().toISOString(),
          compliance_score: auditResult.overall_compliance_score,
          status,
          issues: auditResult.rule_results?.filter(r => !r.is_compliant).map(r => ({
            element: r.rule_name,
            severity: r.severity,
            problem: r.issue_description,
            suggestion: r.remediation,
            rule_code: r.rule_code,
            missing_elements: r.missing_elements
          })) || [],
          compliant_elements: auditResult.rule_results?.filter(r => r.is_compliant).map(r => r.rule_name) || [],
          audit_type: 'automated'
        };

        await base44.entities.ComplianceAudit.create(auditRecord);

        // Track results
        results.audited++;
        if (status === 'passed') results.passed++;
        if (status === 'flagged') results.flagged++;
        if (status === 'critical') results.critical++;

        // Track by rule
        auditResult.rule_results?.forEach(rr => {
          const rule = activeRules.find(r => r.rule_name === rr.rule_name || r.rule_code === rr.rule_code);
          if (rule && results.byRule[rule.id]) {
            if (rr.is_compliant) {
              results.byRule[rule.id].compliant++;
            } else {
              results.byRule[rule.id].violations++;
            }
          }
        });

        // Track by nurse
        if (!results.byNurse[visit.created_by]) {
          results.byNurse[visit.created_by] = { total: 0, passed: 0, flagged: 0, avgScore: 0, scores: [] };
        }
        const nurseStats = results.byNurse[visit.created_by];
        nurseStats.total++;
        nurseStats.scores.push(auditResult.overall_compliance_score);
        if (status === 'passed') nurseStats.passed++;
        else nurseStats.flagged++;

        // Store detailed result
        results.detailedResults.push({
          visit,
          patient,
          auditResult,
          status
        });

      } catch (error) {
        console.error("Audit error for visit:", visit.id, error);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    // Calculate nurse averages
    Object.values(results.byNurse).forEach(nurse => {
      nurse.avgScore = Math.round(nurse.scores.reduce((a, b) => a + b, 0) / nurse.scores.length);
    });

    setAuditResults(results);
    setIsAuditing(false);
    queryClient.invalidateQueries({ queryKey: ['existingAudits'] });
    if (onAuditComplete) onAuditComplete(results);
  };

  const exportDetailedReport = () => {
    if (!auditResults) return;

    const report = {
      generated: new Date().toISOString(),
      audit_parameters: {
        date_range: `Last ${dateRange} days`,
        care_type: careType,
        rules_audited: activeRules.map(r => ({ name: r.rule_name, code: r.rule_code }))
      },
      summary: {
        total_audited: auditResults.audited,
        passed: auditResults.passed,
        flagged: auditResults.flagged,
        critical: auditResults.critical,
        pass_rate: auditResults.audited > 0 ? Math.round((auditResults.passed / auditResults.audited) * 100) + '%' : 'N/A'
      },
      rule_compliance: Object.values(auditResults.byRule).map(r => ({
        rule: r.rule_name,
        code: r.rule_code,
        category: r.category,
        compliant: r.compliant,
        violations: r.violations,
        compliance_rate: r.compliant + r.violations > 0 
          ? Math.round((r.compliant / (r.compliant + r.violations)) * 100) + '%' 
          : 'N/A'
      })),
      nurse_performance: Object.entries(auditResults.byNurse).map(([email, stats]) => ({
        nurse: email,
        notes_audited: stats.total,
        average_score: stats.avgScore + '%',
        passed: stats.passed,
        flagged: stats.flagged
      })),
      detailed_findings: auditResults.detailedResults.map(d => ({
        patient: `${d.patient?.first_name} ${d.patient?.last_name}`,
        visit_date: d.visit.visit_date,
        nurse: d.visit.created_by,
        score: d.auditResult.overall_compliance_score,
        status: d.status,
        issues: d.auditResult.rule_results?.filter(r => !r.is_compliant).map(r => ({
          rule: r.rule_name,
          issue: r.issue_description,
          missing: r.missing_elements
        }))
      }))
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance-audit-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const getCategoryColor = (category) => {
    const colors = {
      oasis: 'bg-blue-100 text-blue-800',
      medicare_cop: 'bg-navy-100 text-navy-800',
      state_regulation: 'bg-green-100 text-green-800',
      agency_policy: 'bg-orange-100 text-orange-800',
      hipaa: 'bg-red-100 text-red-800',
      quality_measure: 'bg-navy-100 text-navy-800'
    };
    return colors[category] || 'bg-slate-100 text-slate-800';
  };

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            Enhanced Compliance Auditor
          </div>
          <Badge variant="outline" className="text-xs">
            {existingAudits.length} audits completed
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="date-range" className="text-xs font-medium text-slate-600 mb-1 block">Date Range</label>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger id="date-range"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="care-type" className="text-xs font-medium text-slate-600 mb-1 block">Care Type</label>
            <Select value={careType} onValueChange={setCareType}>
              <SelectTrigger id="care-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="home_health">Home Health</SelectItem>
                <SelectItem value="hospice">Hospice</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={runComplianceAudit}
              disabled={isAuditing || activeRules.length === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {isAuditing ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Auditing...</>
              ) : (
                <><Play className="w-4 h-4 mr-2" /> Run Audit</>
              )}
            </Button>
          </div>
        </div>

        {/* Rule Selection */}
        <div className="border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold">Select Rules to Audit</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedRules(complianceRules.map(r => r.id))}
              >
                Select All
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedRules([])}
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {complianceRules.map(rule => (
              <div key={rule.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
                <Checkbox
                  checked={selectedRules.includes(rule.id)}
                  onCheckedChange={(checked) => {
                    setSelectedRules(prev =>
                      checked ? [...prev, rule.id] : prev.filter(id => id !== rule.id)
                    );
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{rule.rule_name}</p>
                  <p className="text-xs text-slate-500">{rule.rule_code}</p>
                </div>
                <Badge className={getCategoryColor(rule.rule_category)} variant="outline">
                  {(rule.rule_category || '').replace(/_/g, ' ')}
                </Badge>
              </div>
            ))}
          </div>
          {complianceRules.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">
              No compliance rules configured. Add rules in the Rules Configuration section.
            </p>
          )}
        </div>

        {/* Progress */}
        {isAuditing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{auditProgress.currentRule}</span>
              <span>{auditProgress.current} / {auditProgress.total}</span>
            </div>
            <Progress value={(auditProgress.current / auditProgress.total) * 100} className="h-2" />
          </div>
        )}

        {/* Results */}
        {auditResults && (
          <div className="space-y-4">
            <Alert className="bg-indigo-50 border-indigo-200">
              <CheckCircle2 className="w-4 h-4 text-indigo-600" />
              <AlertDescription className="flex items-center justify-between">
                <span>Audit complete: {auditResults.audited} notes reviewed against {activeRules.length} rules</span>
                <Button size="sm" variant="outline" onClick={exportDetailedReport}>
                  <Download className="w-3 h-3 mr-1" /> Export Report
                </Button>
              </AlertDescription>
            </Alert>

            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-blue-50 p-3 rounded-lg text-center">
                <FileText className="w-5 h-5 text-blue-600 mx-auto mb-1" />
                <p className="text-xl font-bold text-blue-700">{auditResults.audited}</p>
                <p className="text-xs text-slate-600">Audited</p>
              </div>
              <div className="bg-green-50 p-3 rounded-lg text-center">
                <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto mb-1" />
                <p className="text-xl font-bold text-green-700">{auditResults.passed}</p>
                <p className="text-xs text-slate-600">Passed</p>
              </div>
              <div className="bg-yellow-50 p-3 rounded-lg text-center">
                <AlertTriangle className="w-5 h-5 text-yellow-600 mx-auto mb-1" />
                <p className="text-xl font-bold text-yellow-700">{auditResults.flagged}</p>
                <p className="text-xs text-slate-600">Flagged</p>
              </div>
              <div className="bg-red-50 p-3 rounded-lg text-center">
                <XCircle className="w-5 h-5 text-red-600 mx-auto mb-1" />
                <p className="text-xl font-bold text-red-700">{auditResults.critical}</p>
                <p className="text-xs text-slate-600">Critical</p>
              </div>
            </div>

            {/* Rule Compliance Breakdown */}
            <div>
              <p className="text-sm font-semibold mb-2">Compliance by Rule</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {Object.entries(auditResults.byRule).map(([ruleId, stats]) => {
                  const total = stats.compliant + stats.violations;
                  const complianceRate = total > 0 ? Math.round((stats.compliant / total) * 100) : 0;
                  return (
                    <div key={ruleId} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{stats.rule_name}</p>
                          {stats.rule_code && (
                            <span className="text-xs text-slate-500 font-mono">{stats.rule_code}</span>
                          )}
                        </div>
                        <Progress value={complianceRate} className="h-1.5 mt-1" />
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold ${complianceRate >= 80 ? 'text-green-600' : complianceRate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {complianceRate}%
                        </p>
                        <p className="text-xs text-slate-500">{stats.violations} violations</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By Nurse Breakdown */}
            {Object.keys(auditResults.byNurse).length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Performance by Nurse</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {Object.entries(auditResults.byNurse)
                    .sort((a, b) => a[1].avgScore - b[1].avgScore)
                    .map(([email, stats]) => (
                      <div key={email} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                        <div className="flex-1">
                          <p className="text-sm font-medium">{email.split('@')[0]}</p>
                          <p className="text-xs text-slate-500">{stats.total} notes audited</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-lg font-bold ${stats.avgScore >= 80 ? 'text-green-600' : stats.avgScore >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {stats.avgScore}%
                          </p>
                          <p className="text-xs text-slate-500">{stats.flagged} flagged</p>
                        </div>
                        {stats.avgScore < 70 && (
                          <Badge className="bg-orange-100 text-orange-800">
                            <TrendingDown className="w-3 h-3 mr-1" />
                            Needs Review
                          </Badge>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Detailed Findings */}
            {auditResults.detailedResults?.filter(d => d.status !== 'passed').length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Flagged Documentation</p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {auditResults.detailedResults.filter(d => d.status !== 'passed').map((detail, idx) => (
                    <div key={idx} className="p-3 bg-red-50 rounded-lg border border-red-200">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-medium">
                            {detail.patient?.first_name} {detail.patient?.last_name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {format(new Date(detail.visit.visit_date), 'MMM d, yyyy')} • {detail.visit.created_by?.split('@')[0]}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={detail.status === 'critical' ? 'bg-red-600 text-white' : 'bg-yellow-500 text-white'}>
                            {detail.auditResult.overall_compliance_score}%
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedVisitDetail(detail);
                              setDetailDialogOpen(true);
                            }}
                          >
                            <Eye className="w-3 h-3 mr-1" /> Details
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {detail.auditResult.rule_results?.filter(r => !r.is_compliant).slice(0, 3).map((r, i) => (
                          <Badge key={i} variant="outline" className="text-xs bg-white">
                            <Flag className="w-3 h-3 mr-1 text-red-500" />
                            {r.rule_name}
                          </Badge>
                        ))}
                        {detail.auditResult.rule_results?.filter(r => !r.is_compliant).length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{detail.auditResult.rule_results.filter(r => !r.is_compliant).length - 3} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Audit Details</DialogTitle>
          </DialogHeader>
          {selectedVisitDetail && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">
                    {selectedVisitDetail.patient?.first_name} {selectedVisitDetail.patient?.last_name}
                  </p>
                  <p className="text-sm text-slate-500">
                    {format(new Date(selectedVisitDetail.visit.visit_date), 'MMMM d, yyyy')}
                  </p>
                </div>
                <Badge className={selectedVisitDetail.status === 'critical' ? 'bg-red-600 text-white' : 'bg-yellow-500 text-white'}>
                  Score: {selectedVisitDetail.auditResult.overall_compliance_score}%
                </Badge>
              </div>

              <div>
                <p className="text-sm font-semibold mb-2">Summary</p>
                <p className="text-sm text-slate-600">{selectedVisitDetail.auditResult.summary}</p>
              </div>

              {selectedVisitDetail.auditResult.critical_issues?.length > 0 && (
                <Alert className="bg-red-50 border-red-200">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <AlertDescription>
                    <p className="font-semibold text-red-800">Critical Issues:</p>
                    <ul className="list-disc ml-4 text-sm text-red-700">
                      {selectedVisitDetail.auditResult.critical_issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div>
                <p className="text-sm font-semibold mb-2">Rule-by-Rule Results</p>
                <div className="space-y-2">
                  {selectedVisitDetail.auditResult.rule_results?.map((rr, idx) => (
                    <div 
                      key={idx} 
                      className={`p-3 rounded-lg border ${rr.is_compliant ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {rr.is_compliant ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-600" />
                        )}
                        <span className="font-medium text-sm">{rr.rule_name}</span>
                        {rr.rule_code && <span className="text-xs text-slate-500 font-mono">{rr.rule_code}</span>}
                      </div>
                      {!rr.is_compliant && (
                        <>
                          <p className="text-sm text-red-700 mb-1">{rr.issue_description}</p>
                          {rr.missing_elements?.length > 0 && (
                            <p className="text-xs text-slate-600">
                              Missing: {rr.missing_elements.join(', ')}
                            </p>
                          )}
                          <p className="text-xs text-green-700 mt-1">
                            <strong>Fix:</strong> {rr.remediation}
                          </p>
                        </>
                      )}
                      {rr.is_compliant && rr.evidence_quotes?.length > 0 && (
                        <p className="text-xs text-slate-600 italic">
                          "{rr.evidence_quotes[0]?.substring(0, 100)}..."
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {selectedVisitDetail.auditResult.recommendations?.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Recommendations</p>
                  <ul className="list-disc ml-4 text-sm text-slate-600">
                    {selectedVisitDetail.auditResult.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}