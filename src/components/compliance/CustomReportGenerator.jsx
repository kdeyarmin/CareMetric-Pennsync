import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Download,
  FileText,
  Loader2,
  Eye
} from "lucide-react";
import { parseISO, isWithinInterval } from "date-fns";
import { toCsvRows } from "@/components/admin/csvExport";

export default function CustomReportGenerator({ 
  audits = [], 
  _nurses = [],
  _patients = []
}) {
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    nurses: [],
    statuses: ["passed", "flagged", "critical"],
    categories: [],
    minScore: 0,
    maxScore: 100
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const uniqueNurses = useMemo(() => {
    const emails = new Set(audits.map(a => a.nurse_email).filter(Boolean));
    return Array.from(emails);
  }, [audits]);

  const _issueCategories = [
    "Homebound Status",
    "Skilled Need",
    "Vital Signs",
    "Assessment",
    "Patient Response",
    "Medication",
    "Care Plan",
    "Functional Status"
  ];

  const filteredAudits = useMemo(() => {
    return audits.filter(audit => {
      // Date range filter
      if (filters.startDate && filters.endDate && audit.audit_date) {
        const auditDate = parseISO(audit.audit_date);
        const inRange = isWithinInterval(auditDate, {
          start: new Date(filters.startDate),
          end: new Date(filters.endDate)
        });
        if (!inRange) return false;
      }

      // Nurse filter
      if (filters.nurses.length > 0 && !filters.nurses.includes(audit.nurse_email)) {
        return false;
      }

      // Status filter
      if (!filters.statuses.includes(audit.status)) {
        return false;
      }

      // Score range filter
      if (audit.compliance_score < filters.minScore || audit.compliance_score > filters.maxScore) {
        return false;
      }

      return true;
    });
  }, [audits, filters]);

  const generateReport = () => {
    setIsGenerating(true);

    // Calculate statistics
    const stats = {
      totalAudits: filteredAudits.length,
      avgScore: filteredAudits.length > 0 
        ? Math.round(filteredAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / filteredAudits.length)
        : 0,
      passRate: filteredAudits.length > 0
        ? Math.round((filteredAudits.filter(a => a.status === 'passed').length / filteredAudits.length) * 100)
        : 0,
      totalIssues: filteredAudits.reduce((sum, a) => sum + (a.issues?.length || 0), 0),
      criticalIssues: filteredAudits.reduce((sum, a) => 
        sum + (a.issues?.filter(i => i.severity === 'critical').length || 0), 0
      )
    };

    // Group by nurse
    const byNurse = {};
    filteredAudits.forEach(audit => {
      const email = audit.nurse_email || 'Unknown';
      if (!byNurse[email]) {
        byNurse[email] = { email, audits: [], totalScore: 0, passed: 0 };
      }
      byNurse[email].audits.push(audit);
      byNurse[email].totalScore += audit.compliance_score || 0;
      if (audit.status === 'passed') byNurse[email].passed++;
    });

    const nurseStats = Object.values(byNurse).map(n => ({
      ...n,
      avgScore: Math.round(n.totalScore / n.audits.length),
      passRate: Math.round((n.passed / n.audits.length) * 100),
      auditCount: n.audits.length
    }));

    // Group by issue category
    const byCategory = {};
    filteredAudits.forEach(audit => {
      audit.issues?.forEach(issue => {
        const cat = categorizeIssue(issue.element || issue.problem || '');
        if (!byCategory[cat]) {
          byCategory[cat] = { category: cat, count: 0, critical: 0, high: 0, medium: 0 };
        }
        byCategory[cat].count++;
        byCategory[cat][issue.severity || 'medium']++;
      });
    });

    setReportData({
      generated: new Date().toISOString(),
      filters: { ...filters },
      stats,
      nurseStats: nurseStats.sort((a, b) => b.avgScore - a.avgScore),
      categoryStats: Object.values(byCategory).sort((a, b) => b.count - a.count),
      audits: filteredAudits.map(a => ({
        date: a.audit_date,
        nurse: a.nurse_email,
        score: a.compliance_score,
        status: a.status,
        issueCount: a.issues?.length || 0
      }))
    });

    setIsGenerating(false);
    setShowPreview(true);
  };

  const downloadReport = (format) => {
    if (!reportData) return;

    let content, filename, type;

    if (format === 'json') {
      content = JSON.stringify(reportData, null, 2);
      filename = `compliance-report-${new Date().toISOString().split('T')[0]}.json`;
      type = 'application/json';
    } else {
      // CSV format
      // Build as row-arrays and escape via toCsvRows (emails/categories/nurse
      // names are free text that must not break the CSV or inject formulas).
      content = toCsvRows([
        ['Compliance Report'],
        [`Generated: ${reportData.generated}`],
        [],
        ['Summary Statistics'],
        ['Total Audits', reportData.stats.totalAudits],
        ['Average Score', `${reportData.stats.avgScore}%`],
        ['Pass Rate', `${reportData.stats.passRate}%`],
        ['Total Issues', reportData.stats.totalIssues],
        ['Critical Issues', reportData.stats.criticalIssues],
        [],
        ['Nurse Performance'],
        ['Nurse', 'Audits', 'Avg Score', 'Pass Rate'],
        ...reportData.nurseStats.map(n => [n.email, n.auditCount, `${n.avgScore}%`, `${n.passRate}%`]),
        [],
        ['Issue Categories'],
        ['Category', 'Count', 'Critical', 'High', 'Medium'],
        ...reportData.categoryStats.map(c => [c.category, c.count, c.critical, c.high, c.medium]),
        [],
        ['Audit Details'],
        ['Date', 'Nurse', 'Score', 'Status', 'Issues'],
        ...reportData.audits.map(a => [a.date, a.nurse, `${a.score}%`, a.status, a.issueCount]),
      ]);
      filename = `compliance-report-${new Date().toISOString().split('T')[0]}.csv`;
      type = 'text/csv';
    }

    const blob = new Blob([content], { type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-600" />
          Custom Report Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Date Range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Start Date</Label>
            <Input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">End Date</Label>
            <Input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            />
          </div>
        </div>

        {/* Nurse Selection */}
        <div>
          <Label className="text-xs">Nurses (leave empty for all)</Label>
          <Select
            value={filters.nurses.length === 1 ? filters.nurses[0] : "all"}
            onValueChange={(v) => setFilters({ ...filters, nurses: v && v !== "all" ? [v] : [] })}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Nurses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Nurses</SelectItem>
              {uniqueNurses.map(email => (
                <SelectItem key={email} value={email}>
                  {email?.split('@')[0]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status Filters */}
        <div>
          <Label className="text-xs mb-2 block">Audit Status</Label>
          <div className="flex flex-wrap gap-2">
            {["passed", "flagged", "critical"].map(status => (
              <Badge
                key={status}
                variant={filters.statuses.includes(status) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => {
                  const newStatuses = filters.statuses.includes(status)
                    ? filters.statuses.filter(s => s !== status)
                    : [...filters.statuses, status];
                  setFilters({ ...filters, statuses: newStatuses });
                }}
              >
                {status}
              </Badge>
            ))}
          </div>
        </div>

        {/* Score Range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Min Score</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={filters.minScore}
              onChange={(e) => setFilters({ ...filters, minScore: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div>
            <Label className="text-xs">Max Score</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={filters.maxScore}
              onChange={(e) => setFilters({ ...filters, maxScore: parseInt(e.target.value) || 100 })}
            />
          </div>
        </div>

        {/* Preview Count */}
        <div className="bg-slate-50 p-3 rounded-lg text-center">
          <p className="text-sm text-slate-600">
            <span className="font-bold text-lg text-blue-600">{filteredAudits.length}</span> audits match your filters
          </p>
        </div>

        {/* Generate Button */}
        <Button
          onClick={generateReport}
          disabled={isGenerating || filteredAudits.length === 0}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {isGenerating ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
          ) : (
            <><Eye className="w-4 h-4 mr-2" /> Preview Report</>
          )}
        </Button>

        {/* Report Preview Dialog */}
        <Dialog open={showPreview} onOpenChange={setShowPreview}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Report Preview</DialogTitle>
            </DialogHeader>
            
            {reportData && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-5 gap-2">
                  <Card className="bg-blue-50">
                    <CardContent className="p-3 text-center">
                      <p className="text-xl font-bold text-blue-600">{reportData.stats.totalAudits}</p>
                      <p className="text-[10px] text-slate-500">Audits</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-green-50">
                    <CardContent className="p-3 text-center">
                      <p className="text-xl font-bold text-green-600">{reportData.stats.avgScore}%</p>
                      <p className="text-[10px] text-slate-500">Avg Score</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-emerald-50">
                    <CardContent className="p-3 text-center">
                      <p className="text-xl font-bold text-emerald-600">{reportData.stats.passRate}%</p>
                      <p className="text-[10px] text-slate-500">Pass Rate</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-orange-50">
                    <CardContent className="p-3 text-center">
                      <p className="text-xl font-bold text-orange-600">{reportData.stats.totalIssues}</p>
                      <p className="text-[10px] text-slate-500">Issues</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-red-50">
                    <CardContent className="p-3 text-center">
                      <p className="text-xl font-bold text-red-600">{reportData.stats.criticalIssues}</p>
                      <p className="text-[10px] text-slate-500">Critical</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Nurse Stats */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Nurse Performance</h4>
                  <div className="max-h-40 overflow-y-auto border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="text-left p-2">Nurse</th>
                          <th className="text-center p-2">Audits</th>
                          <th className="text-center p-2">Avg Score</th>
                          <th className="text-center p-2">Pass Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.nurseStats.map((n, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="p-2">{n.email?.split('@')[0]}</td>
                            <td className="p-2 text-center">{n.auditCount}</td>
                            <td className="p-2 text-center">{n.avgScore}%</td>
                            <td className="p-2 text-center">{n.passRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Category Stats */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Issue Categories</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {reportData.categoryStats.slice(0, 6).map((c, idx) => (
                      <div key={idx} className="flex justify-between items-center p-2 bg-slate-50 rounded text-xs">
                        <span>{c.category}</span>
                        <div className="flex gap-1">
                          <Badge className="text-[9px] bg-slate-200">{c.count}</Badge>
                          {c.critical > 0 && <Badge className="text-[9px] bg-red-100 text-red-800">{c.critical}</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Download Buttons */}
                <div className="flex gap-2 pt-4 border-t">
                  <Button onClick={() => downloadReport('csv')} variant="outline" className="flex-1">
                    <Download className="w-4 h-4 mr-2" /> Download CSV
                  </Button>
                  <Button onClick={() => downloadReport('json')} variant="outline" className="flex-1">
                    <Download className="w-4 h-4 mr-2" /> Download JSON
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function categorizeIssue(text) {
  const lower = text.toLowerCase();
  if (lower.includes('homebound')) return 'Homebound Status';
  if (lower.includes('skilled')) return 'Skilled Need';
  if (lower.includes('vital')) return 'Vital Signs';
  if (lower.includes('assessment')) return 'Assessment';
  if (lower.includes('response') || lower.includes('teach')) return 'Patient Response';
  if (lower.includes('medication')) return 'Medication';
  if (lower.includes('care plan') || lower.includes('goal')) return 'Care Plan';
  if (lower.includes('functional') || lower.includes('adl')) return 'Functional Status';
  return 'General';
}