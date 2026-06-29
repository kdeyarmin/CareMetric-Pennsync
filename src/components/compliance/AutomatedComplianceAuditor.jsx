import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  TrendingDown
} from "lucide-react";
import { subDays } from "date-fns";

export default function AutomatedComplianceAuditor({ onAuditComplete }) {
  const queryClient = useQueryClient();
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditProgress, setAuditProgress] = useState({ current: 0, total: 0 });
  const [auditResults, setAuditResults] = useState(null);
  const [dateRange, setDateRange] = useState("7");
  const [qualityThreshold, setQualityThreshold] = useState("70");

  const { data: visits = [] } = useQuery({
    queryKey: ['visitsForAudit'],
    queryFn: () => base44.entities.Visit.filter({ status: 'completed' }, '-visit_date', 200),
  });

  const { data: existingAudits = [] } = useQuery({
    queryKey: ['existingAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 500),
  });

  const runComplianceAudit = async () => {
    setIsAuditing(true);
    setAuditResults(null);
    
    const cutoffDate = subDays(new Date(), parseInt(dateRange));
    const threshold = parseInt(qualityThreshold);
    
    // Filter visits that need auditing
    const auditedVisitIds = new Set(existingAudits.map(a => a.visit_id));
    const visitsToAudit = visits.filter(v => {
      if (!v.nurse_notes || v.nurse_notes.length < 50) return false;
      if (auditedVisitIds.has(v.id)) return false;
      const visitDate = new Date(v.visit_date);
      return visitDate >= cutoffDate;
    });

    setAuditProgress({ current: 0, total: visitsToAudit.length });

    const results = {
      audited: 0,
      passed: 0,
      flagged: 0,
      critical: 0,
      byNurse: {}
    };

    for (let i = 0; i < visitsToAudit.length; i++) {
      const visit = visitsToAudit[i];
      setAuditProgress({ current: i + 1, total: visitsToAudit.length });

      try {
        const auditResult = await invokeLLM({
          model: "claude_opus_4_8",
          prompt: `Perform a Medicare compliance audit on this clinical documentation.

VISIT TYPE: ${visit.visit_type || 'routine_visit'}
DOCUMENTATION:
${visit.nurse_notes}

Audit for these required Medicare elements:
1. HOMEBOUND STATUS - Clear justification why patient cannot leave home safely
2. SKILLED NEED - Why RN skill/judgment is required (not aide-level tasks)
3. PATIENT RESPONSE - How patient responded to teaching/interventions
4. ASSESSMENT FINDINGS - Objective clinical findings documented
5. VITAL SIGNS - Basic vitals present
6. INTERVENTIONS - Nursing care provided
7. PLAN/GOALS - Next steps and goals addressed
8. MEASURABLE OUTCOMES - Progress toward measurable goals

Score each element and provide overall compliance score.

Return JSON:
{
  "compliance_score": 0-100,
  "issues": [
    {
      "element": "Element name",
      "severity": "critical" | "high" | "medium" | "low",
      "problem": "What's wrong",
      "suggestion": "How to fix"
    }
  ],
  "compliant_elements": ["List of well-documented elements"],
  "recurring_patterns": ["Any patterns of issues noted"]
}`,
          response_json_schema: {
            type: "object",
            properties: {
              compliance_score: { type: "number" },
              issues: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    element: { type: "string" },
                    severity: { type: "string" },
                    problem: { type: "string" },
                    suggestion: { type: "string" }
                  }
                }
              },
              compliant_elements: { type: "array", items: { type: "string" } },
              recurring_patterns: { type: "array", items: { type: "string" } }
            }
          }
        });

        // Determine status based on score AND issues. A critical issue (e.g. a
        // missing homebound statement — an automatic Medicare denial) must block
        // regardless of the numeric score; previously escalation only ran inside
        // the sub-threshold branch, so a high-scoring note with a critical
        // violation was silently recorded as 'passed'.
        let status = 'passed';
        if (auditResult.issues?.some(i => i.severity === 'critical')) {
          status = 'critical';
        } else if (auditResult.compliance_score < threshold) {
          status = 'flagged';
        }

        // Create audit record
        await base44.entities.ComplianceAudit.create({
          visit_id: visit.id,
          nurse_email: visit.created_by,
          patient_id: visit.patient_id,
          audit_date: new Date().toISOString(),
          compliance_score: auditResult.compliance_score,
          status,
          issues: auditResult.issues || [],
          compliant_elements: auditResult.compliant_elements || [],
          audit_type: 'automated'
        });

        // Track results
        results.audited++;
        if (status === 'passed') results.passed++;
        if (status === 'flagged') results.flagged++;
        if (status === 'critical') results.critical++;

        // Track by nurse
        if (!results.byNurse[visit.created_by]) {
          results.byNurse[visit.created_by] = { total: 0, passed: 0, flagged: 0, avgScore: 0, scores: [] };
        }
        const nurseStats = results.byNurse[visit.created_by];
        nurseStats.total++;
        nurseStats.scores.push(auditResult.compliance_score);
        if (status === 'passed') nurseStats.passed++;
        else nurseStats.flagged++;

      } catch (error) {
        console.error("Audit error for visit:", visit.id, error);
      }

      // Small delay to avoid rate limiting
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

  const _getStatusColor = (status) => {
    switch (status) {
      case 'passed': return 'bg-green-100 text-green-800';
      case 'flagged': return 'bg-yellow-100 text-yellow-800';
      case 'critical': return 'bg-red-100 text-red-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            Automated Compliance Auditor
          </div>
          <Badge variant="outline" className="text-xs">
            {existingAudits.length} audits completed
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* Configuration */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label htmlFor="date-range" className="text-xs font-medium text-slate-600 mb-1 block">Date Range</label>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger id="date-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="quality-threshold" className="text-xs font-medium text-slate-600 mb-1 block">Quality Threshold</label>
            <Select value={qualityThreshold} onValueChange={setQualityThreshold}>
              <SelectTrigger id="quality-threshold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="60">60% (Lenient)</SelectItem>
                <SelectItem value="70">70% (Standard)</SelectItem>
                <SelectItem value="80">80% (Strict)</SelectItem>
                <SelectItem value="90">90% (Very Strict)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={runComplianceAudit}
              disabled={isAuditing}
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

        {/* Progress */}
        {isAuditing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Auditing documentation...</span>
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
              <AlertDescription>
                Audit complete: {auditResults.audited} notes reviewed
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
                          <p className={`text-lg font-bold ${stats.avgScore >= 70 ? 'text-green-600' : stats.avgScore >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}