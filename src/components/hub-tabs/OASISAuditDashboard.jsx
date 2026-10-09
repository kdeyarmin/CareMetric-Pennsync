import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { manageOASISRecords } from "@/functions/manageOASISRecords";
import { isOasisLeadView } from "@/lib/oasisRoles";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Loader2,
  Eye,
  FileDown,
  Calendar,
  Target,
  Shield,
  Search,
  Lightbulb
} from "lucide-react";
import { format } from "date-fns";
import OASISAuditReportGenerator from "@/components/oasis/OASISAuditReportGenerator";

// Released by the owner on 2026-10-08 ("turn everything on"). The audit queue
// is an agency lead's: it lists, assigns and updates audits only through the
// OASIS record broker, which admits the platform owner or an active
// agency_admin/manager membership and only for audits on its own agency's
// uploads. An audit carries documentation gaps — never a rescore or a dollar
// figure.
const OASIS_AUDIT_AI_ENABLED = true;

const STATUS_OPTIONS = [
  ['pending_review', 'Pending Review'],
  ['in_review', 'In Review'],
  ['reviewed', 'Reviewed'],
  ['compliant', 'Compliant — no action needed'],
];

function EnabledOASISAuditDashboard() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");

  const queryClient = useQueryClient();

  // Check if user is admin
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // An agency lead (agency_admin or manager membership, or the platform
  // owner), from the validated tenant context — the broker applies the same
  // rule on its own authority.
  const isAdmin = isOasisLeadView(currentUser);

  // Fetch audits
  const { data: audits = [], isLoading } = useQuery({
    queryKey: ['oasisAudits'],
    queryFn: async () => (await manageOASISRecords('list_audits', { limit: 200 }))?.audits || [],
    enabled: isAdmin
  });

  // Who an audit can be assigned to: the active administrators and managers of
  // the audit's own agency, from AgencyMembership — not the editable profile.
  const { data: admins = [] } = useQuery({
    queryKey: ['oasisAuditors', selectedAudit?.id],
    queryFn: async () => (await manageOASISRecords('list_auditors', { audit_id: selectedAudit.id }))?.auditors || [],
    enabled: isAdmin && !!selectedAudit?.id,
  });

  // Update audit mutation
  const updateAuditMutation = useMutation({
    mutationFn: ({ id, data }) => manageOASISRecords('update_audit', { audit_id: id, patch: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisAudits'] });
      setSelectedAudit(null);
    },
    onError: (error) => {
      toast.error(error?.message || "The audit could not be updated.");
    },
  });

  // Filter audits
  const filteredAudits = audits.filter(audit => {
    if (statusFilter !== 'all' && audit.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && audit.priority !== priorityFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!audit.patient_name?.toLowerCase().includes(query) &&
          !audit.flag_reason?.toLowerCase().includes(query)) {
        return false;
      }
    }
    return true;
  });

  // Stats
  const stats = {
    total: audits.length,
    pending: audits.filter(a => a.status === 'pending_review').length,
    inReview: audits.filter(a => a.status === 'in_review').length,
    critical: audits.filter(a => a.priority === 'critical').length,
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending_review: 'bg-yellow-100 text-yellow-800',
      in_review: 'bg-blue-100 text-blue-800',
      reviewed: 'bg-green-100 text-green-800',
      compliant: 'bg-emerald-100 text-emerald-800'
    };
    return styles[status] || 'bg-slate-100 text-slate-800';
  };

  const getPriorityBadge = (priority) => {
    const styles = {
      critical: 'bg-red-600 text-white',
      high: 'bg-orange-500 text-white',
      medium: 'bg-yellow-500 text-white',
      low: 'bg-blue-500 text-white'
    };
    return styles[priority] || 'bg-slate-500 text-white';
  };

  const getFlagIcon = (reason) => {
    switch (reason) {
      case 'low_accuracy': return <Target className="w-4 h-4 text-red-500" />;
      case 'low_compliance': return <Shield className="w-4 h-4 text-orange-500" />;
      case 'high_audit_risk': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default: return <FileText className="w-4 h-4 text-slate-500" />;
    }
  };

  const handleStartReview = (audit) => {
    updateAuditMutation.mutate({
      id: audit.id,
      data: { status: 'in_review', assigned_to: currentUser?.email }
    });
  };

  const handleCompleteReview = () => {
    if (!selectedAudit) return;
    // The broker stamps the reviewer and the time from the session.
    updateAuditMutation.mutate({
      id: selectedAudit.id,
      data: {
        status: 'reviewed',
        auditor_findings: reviewNotes
      }
    });
    setReviewNotes("");
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Alert className="bg-red-50 border-red-200">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800">
            Access denied. The audit queue is available to agency administrators and managers.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-slate-500" />
              <div>
                <p className="text-xs text-slate-500">Total Flagged</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-yellow-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-yellow-500" />
              <div>
                <p className="text-xs text-slate-500">Pending Review</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-xs text-slate-500">In Review</p>
                <p className="text-2xl font-bold text-blue-600">{stats.inReview}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <div>
                <p className="text-xs text-slate-500">Critical</p>
                <p className="text-2xl font-bold text-red-600">{stats.critical}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-4 sm:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-stretch sm:items-center">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span className="text-xs sm:text-sm font-medium">Filters:</span>
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search patient..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-11 touch-target w-full"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40 h-11 touch-target">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {STATUS_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full sm:w-40 h-11 touch-target">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Audit List */}
      {isLoading ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-400" />
          <p className="text-sm text-slate-500 mt-2">Loading audits...</p>
        </div>
      ) : filteredAudits.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-slate-700">No flagged documents</p>
            <p className="text-sm text-slate-500">All OASIS documents meet quality thresholds</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredAudits.map((audit) => (
            <Card
              key={audit.id}
              className={`hover:shadow-md transition-shadow cursor-pointer ${
                audit.priority === 'critical' ? 'border-red-300' : ''
              }`}
              onClick={() => {
                setReviewNotes(audit.auditor_findings || '');
                setSelectedAudit(audit);
              }}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    {getFlagIcon(audit.flag_reason)}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium">{audit.patient_name || 'Unknown Patient'}</p>
                        <Badge className={getPriorityBadge(audit.priority)}>{audit.priority}</Badge>
                        <Badge className={getStatusBadge(audit.status)}>
                          {audit.status?.replace('_', ' ')}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 capitalize">
                        {audit.flag_reason?.replace(/_/g, ' ')}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Target className="w-3 h-3" />
                          Accuracy: {audit.accuracy_score}%
                        </span>
                        <span className="flex items-center gap-1">
                          <Shield className="w-3 h-3" />
                          Compliance: {audit.compliance_score}%
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(audit.created_date), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">
                      {audit.key_issues?.length || 0} issues
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Audit Detail Dialog */}
      <Dialog open={!!selectedAudit && !showReportDialog} onOpenChange={() => { setSelectedAudit(null); setReviewNotes(""); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedAudit && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {getFlagIcon(selectedAudit.flag_reason)}
                  Audit Review: {selectedAudit.patient_name}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {/* Scores */}
                <div className="grid grid-cols-3 gap-3">
                  <div className={`p-3 rounded-lg text-center ${selectedAudit.overall_score < 70 ? 'bg-red-50' : 'bg-green-50'}`}>
                    <p className="text-xs text-slate-500">Overall</p>
                    <p className={`text-2xl font-bold ${selectedAudit.overall_score < 70 ? 'text-red-600' : 'text-green-600'}`}>
                      {selectedAudit.overall_score}%
                    </p>
                  </div>
                  <div className={`p-3 rounded-lg text-center ${selectedAudit.accuracy_score < 75 ? 'bg-red-50' : 'bg-green-50'}`}>
                    <p className="text-xs text-slate-500">Accuracy</p>
                    <p className={`text-2xl font-bold ${selectedAudit.accuracy_score < 75 ? 'text-red-600' : 'text-green-600'}`}>
                      {selectedAudit.accuracy_score}%
                    </p>
                  </div>
                  <div className={`p-3 rounded-lg text-center ${selectedAudit.compliance_score < 80 ? 'bg-red-50' : 'bg-green-50'}`}>
                    <p className="text-xs text-slate-500">Compliance</p>
                    <p className={`text-2xl font-bold ${selectedAudit.compliance_score < 80 ? 'text-red-600' : 'text-green-600'}`}>
                      {selectedAudit.compliance_score}%
                    </p>
                  </div>
                </div>

                {/* Key Issues */}
                {selectedAudit.key_issues?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-2">Key Issues ({selectedAudit.key_issues.length})</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedAudit.key_issues.map((issue, idx) => (
                        <div key={idx} className="p-2 bg-slate-50 rounded border text-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs">{issue.category}</Badge>
                            {issue.item && <Badge className="text-xs bg-navy-100 text-navy-800">{issue.item}</Badge>}
                            <Badge className={`text-xs ${
                              issue.severity === 'high' ? 'bg-red-100 text-red-800' :
                              issue.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>{issue.severity}</Badge>
                          </div>
                          <p className="text-slate-700">{issue.issue}</p>
                          {issue.recommendation && (
                            <p className="text-xs text-emerald-700 mt-1 flex items-start gap-1"><Lightbulb className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {issue.recommendation}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Documentation gaps the analysis found. */}
                {selectedAudit.documentation_gaps?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-2">Documentation Gaps</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {selectedAudit.documentation_gaps.map((gap, idx) => (
                        <div key={idx} className="p-2 bg-amber-50 rounded border border-amber-200 text-sm">
                          {gap.m_item && <Badge variant="outline" className="font-mono">{gap.m_item}</Badge>}
                          <p className="text-xs mt-1">{gap.gap_description || gap.question || ''}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Auditor Notes */}
                <div>
                  <p className="text-sm font-semibold mb-2">Auditor Findings</p>
                  <Textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Enter your audit findings and recommendations..."
                    className="min-h-[100px]"
                  />
                </div>

                {/* Assignment */}
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-xs text-slate-500 mb-1">Assign To</p>
                    <Select
                      value={selectedAudit.assigned_to || ''}
                      onValueChange={(val) => {
                        updateAuditMutation.mutate({
                          id: selectedAudit.id,
                          data: { assigned_to: val }
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select auditor..." />
                      </SelectTrigger>
                      <SelectContent>
                        {admins.map((admin) => (
                          <SelectItem key={admin.email} value={admin.email}>
                            {admin.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-slate-500 mb-1">Status</p>
                    <Select
                      value={selectedAudit.status}
                      onValueChange={(val) => {
                        updateAuditMutation.mutate({
                          id: selectedAudit.id,
                          data: { status: val }
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => { setSelectedAudit(null); setReviewNotes(""); }}>
                  Close
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowReportDialog(true)}
                >
                  <FileDown className="w-4 h-4 mr-2" />
                  Generate Report
                </Button>
                {selectedAudit.status === 'pending_review' && (
                  <Button onClick={() => handleStartReview(selectedAudit)}>
                    Start Review
                  </Button>
                )}
                {selectedAudit.status === 'in_review' && (
                  <Button
                    onClick={handleCompleteReview}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Complete Review
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Report Generator Dialog */}
      {selectedAudit && showReportDialog && (
        <OASISAuditReportGenerator
          audit={selectedAudit}
          isOpen={showReportDialog}
          onClose={() => {
            setShowReportDialog(false);
            setSelectedAudit(null);
          }}
          currentUser={currentUser}
        />
      )}
    </div>
  );
}

export default function OASISAuditDashboard() {
  if (!OASIS_AUDIT_AI_ENABLED) {
    return (
      <Card className="border-2 border-amber-300">
        <CardContent className="space-y-2 pt-6 text-sm text-slate-700">
          <div className="flex items-center gap-2 font-semibold text-amber-950">
            <AlertTriangle className="h-5 w-5 text-amber-700" /> OASIS Audit Queue Off
          </div>
          <p>The OASIS audit queue is switched off for this deployment.</p>
        </CardContent>
      </Card>
    );
  }
  return <EnabledOASISAuditDashboard />;
}
