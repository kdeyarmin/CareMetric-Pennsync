import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  FileText, Search, Eye, Download, CheckCircle,
  Clock, Send
} from 'lucide-react';
import { toast } from 'sonner';

import DischargeSummaryWorkflow from '@/components/discharge/DischargeSummaryWorkflow';

const formatPdfDate = (value) => value ? new Date(value).toLocaleDateString() : '—';

async function downloadSummaryPDF(summary) {
  try {
    const { exportToPDF } = await import('@/components/utils/pdfExporter');
    const content = [];
    const addSection = (label, value) => {
      if (value === undefined || value === null || value === '') return;
      content.push({ type: 'heading', text: label, size: 12 });
      content.push({ type: 'text', text: String(value) });
      content.push({ type: 'spacer', height: 3 });
    };
    addSection('Primary Diagnosis', summary.primary_diagnosis);
    if (Array.isArray(summary.secondary_diagnoses) && summary.secondary_diagnoses.length) {
      addSection('Secondary Diagnoses', summary.secondary_diagnoses.join(', '));
    }
    addSection('Admission / Discharge', `${formatPdfDate(summary.admission_date)} to ${formatPdfDate(summary.discharge_date)}`);
    addSection('Reason for Admission', summary.reason_for_admission);
    addSection('Summary of Care', summary.summary_of_care);
    if (summary.signature?.signed_by_name) {
      addSection('Signed By', `${summary.signature.signed_by_name}${summary.signature.signed_date ? ` on ${new Date(summary.signature.signed_date).toLocaleString()}` : ''}`);
    }
    await exportToPDF({
      filename: `discharge_summary_${(summary.patient_name || 'patient').replace(/\s+/g, '_')}.pdf`,
      title: 'Discharge Summary',
      subtitle: summary.patient_name || '',
      content,
    });
  } catch (err) {
    console.error('Discharge summary PDF error:', err);
    toast.error('Failed to generate PDF');
  }
}

export default function DischargeSummaries() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedSummaryId, setSelectedSummaryId] = useState(null);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [workflowStep, setWorkflowStep] = useState('generate');

  // Open the workflow for an existing summary. Already-generated summaries open
  // at the review step (so signing acts on that record); a contentless draft
  // falls back to the generate step.
  const openSummary = (summary, step) => {
    setSelectedSummaryId(summary.id);
    setWorkflowStep(step || (summary.summary_of_care ? 'review' : 'generate'));
    setShowWorkflow(true);
  };

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: summaries = [], isLoading } = useQuery({
    queryKey: ['dischargeSummaries'],
    queryFn: () => base44.entities.DischargeSummary.list('-generated_date', 100),
    initialData: []
  });

  const _isAdmin = currentUser?.role === 'admin';

  // Filter summaries
  const filteredSummaries = useMemo(() => {
    let filtered = summaries;

    if (statusFilter !== 'all') {
      filtered = filtered.filter(s => s.status === statusFilter);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(s =>
        s.patient_name?.toLowerCase().includes(term) ||
        s.primary_diagnosis?.toLowerCase().includes(term)
      );
    }

    return filtered;
  }, [summaries, statusFilter, searchTerm]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = summaries.length;
    const pending = summaries.filter(s => s.status === 'pending_review').length;
    const reviewed = summaries.filter(s => s.status === 'reviewed').length;
    const signed = summaries.filter(s => s.status === 'signed').length;

    return { total, pending, reviewed, signed };
  }, [summaries]);

  const statusConfig = {
    draft: { color: 'bg-slate-100 text-slate-800', label: 'Draft', icon: Clock },
    pending_review: { color: 'bg-yellow-100 text-yellow-800', label: 'Pending Review', icon: Clock },
    reviewed: { color: 'bg-blue-100 text-blue-800', label: 'Reviewed', icon: Eye },
    signed: { color: 'bg-green-100 text-green-800', label: 'Signed', icon: CheckCircle },
    sent: { color: 'bg-navy-100 text-navy-800', label: 'Sent', icon: Send }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Total Summaries</p>
              <p className="text-3xl font-bold text-slate-900">{stats.total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Pending Review</p>
              <p className="text-3xl font-bold text-yellow-600">{stats.pending}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Reviewed</p>
              <p className="text-3xl font-bold text-blue-600">{stats.reviewed}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-slate-500 text-sm mb-1">Signed</p>
              <p className="text-3xl font-bold text-green-600">{stats.signed}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by patient name or diagnosis..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending_review">Pending Review</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="signed">Signed</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Summaries List */}
      <Card>
        <CardHeader>
          <CardTitle>Discharge Summaries ({filteredSummaries.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-slate-500">
              Loading summaries...
            </div>
          ) : filteredSummaries.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No discharge summaries found"
              description="Discharge summaries will appear here once they're created."
            />
          ) : (
            <div className="space-y-3">
              {filteredSummaries.map((summary) => {
                const config = statusConfig[summary.status] || statusConfig.draft;
                const StatusIcon = config.icon;

                return (
                  <div key={summary.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900 mb-1">
                          {summary.patient_name}
                        </h3>
                        <p className="text-sm text-slate-600">
                          {summary.primary_diagnosis}
                        </p>
                        <div className="flex gap-4 mt-2 text-xs text-slate-500">
                          <span>Discharge: {new Date(summary.discharge_date).toLocaleDateString()}</span>
                          <span>•</span>
                          <span>Generated by: {summary.generated_by}</span>
                        </div>
                      </div>
                      <Badge className={config.color}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {config.label}
                      </Badge>
                    </div>

                    {summary.signature && (
                      <div className="bg-green-50 border border-green-200 rounded p-2 mb-3">
                        <p className="text-xs text-green-800">
                          <CheckCircle className="w-3 h-3 inline mr-1" />
                          Signed by {summary.signature.signed_by_name} on{' '}
                          {new Date(summary.signature.signed_date).toLocaleString()}
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openSummary(summary)}
                      >
                        <Eye className="w-3 h-3 mr-1" />
                        View
                      </Button>
                      {summary.status === 'pending_review' && (
                        <Button
                          size="sm"
                          onClick={() => openSummary(summary, 'review')}
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Review & Sign
                        </Button>
                      )}
                      {summary.status === 'signed' && (
                        <Button size="sm" variant="outline" onClick={() => downloadSummaryPDF(summary)}>
                          <Download className="w-3 h-3 mr-1" />
                          Download PDF
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {showWorkflow && selectedSummaryId && (
        <DischargeSummaryWorkflow
          patientId={summaries.find(s => s.id === selectedSummaryId)?.patient_id}
          summaryId={selectedSummaryId}
          initialStep={workflowStep}
          onClose={() => {
            setShowWorkflow(false);
            setSelectedSummaryId(null);
          }}
          onComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['dischargeSummaries'] });
            setShowWorkflow(false);
            setSelectedSummaryId(null);
          }}
        />
      )}
    </div>
  );
}