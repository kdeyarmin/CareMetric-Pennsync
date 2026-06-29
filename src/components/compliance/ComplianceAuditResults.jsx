import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  User,
  Calendar,
  FileText
} from "lucide-react";
import { format } from "date-fns";

export default function ComplianceAuditResults({ users = [] }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedAudit, setSelectedAudit] = useState(null);

  const { data: audits = [] } = useQuery({
    queryKey: ['complianceAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 200),
  });

  const filteredAudits = audits.filter(a => {
    if (statusFilter === "all") return true;
    return a.status === statusFilter;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'passed':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3 mr-1" />Passed</Badge>;
      case 'flagged':
        return <Badge className="bg-yellow-100 text-yellow-800"><AlertTriangle className="w-3 h-3 mr-1" />Flagged</Badge>;
      case 'critical':
        return <Badge className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />Critical</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getScoreColor = (score) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  // Stats
  const stats = {
    total: audits.length,
    passed: audits.filter(a => a.status === 'passed').length,
    flagged: audits.filter(a => a.status === 'flagged').length,
    critical: audits.filter(a => a.status === 'critical').length,
    avgScore: audits.length > 0 
      ? Math.round(audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length)
      : 0
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-indigo-600" />
              Compliance Audit Results
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline">Avg Score: {stats.avgScore}%</Badge>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({stats.total})</SelectItem>
                  <SelectItem value="passed">Passed ({stats.passed})</SelectItem>
                  <SelectItem value="flagged">Flagged ({stats.flagged})</SelectItem>
                  <SelectItem value="critical">Critical ({stats.critical})</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nurse</TableHead>
                  <TableHead>Audit Date</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issues</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAudits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                      No audit results found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAudits.slice(0, 50).map(audit => {
                    const user = users.find(u => u.email === audit.nurse_email);
                    return (
                      <TableRow key={audit.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-slate-400" />
                            <span className="text-sm font-medium">
                              {user?.full_name || audit.nurse_email?.split('@')[0]}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-slate-600">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(audit.audit_date), 'MMM d, yyyy')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`text-lg font-bold ${getScoreColor(audit.compliance_score)}`}>
                            {audit.compliance_score}%
                          </span>
                        </TableCell>
                        <TableCell>{getStatusBadge(audit.status)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {audit.issues?.length || 0} issues
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedAudit(audit)}
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Audit Detail Dialog */}
      <Dialog open={!!selectedAudit} onOpenChange={() => setSelectedAudit(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              Audit Details
            </DialogTitle>
          </DialogHeader>

          {selectedAudit && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="text-sm text-slate-600">Nurse</p>
                  <p className="font-medium">{selectedAudit.nurse_email}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-600">Score</p>
                  <p className={`text-2xl font-bold ${getScoreColor(selectedAudit.compliance_score)}`}>
                    {selectedAudit.compliance_score}%
                  </p>
                </div>
                <div>{getStatusBadge(selectedAudit.status)}</div>
              </div>

              {/* Issues */}
              {selectedAudit.issues?.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Issues Found ({selectedAudit.issues.length})</p>
                  <div className="space-y-2">
                    {selectedAudit.issues.map((issue, idx) => (
                      <div key={idx} className={`p-3 rounded-lg border ${getSeverityColor(issue.severity)}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">{issue.element}</span>
                          <Badge variant="outline" className="text-xs capitalize">{issue.severity}</Badge>
                        </div>
                        <p className="text-sm">{issue.problem}</p>
                        {issue.suggestion && (
                          <p className="text-xs text-slate-600 mt-1 italic">💡 {issue.suggestion}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Nurse acknowledgment trail for a knowingly-accepted critical conflict */}
              {selectedAudit.acknowledgment?.acknowledged_by && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <p className="text-sm font-semibold text-amber-900 mb-1">Conflict acknowledged at documentation</p>
                  <p className="text-xs text-amber-800">
                    {selectedAudit.acknowledgment.acknowledged_by}
                    {selectedAudit.acknowledgment.acknowledged_at && ` · ${new Date(selectedAudit.acknowledgment.acknowledged_at).toLocaleString()}`}
                  </p>
                  {selectedAudit.acknowledgment.justification && (
                    <p className="text-sm text-amber-900 mt-1 italic">“{selectedAudit.acknowledgment.justification}”</p>
                  )}
                </div>
              )}

              {/* Compliant Elements */}
              {selectedAudit.compliant_elements?.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Compliant Elements</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedAudit.compliant_elements.map((el, idx) => (
                      <Badge key={idx} className="bg-green-100 text-green-800">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        {el}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}