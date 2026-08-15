import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Pen,
  Send,
  Eye,
  Search
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { openExternalUrl } from "@/components/utils/security";
import { formatLocalDate } from "@/lib/dateLocal";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import SearchablePatientSelect from "@/components/ui/SearchablePatientSelect";
import { getNormalizedSignatureStatus, isSignatureOverdue } from "@/components/signature/signatureUtils";
import { PATIENT_HISTORY_ROWS } from '@/lib/queryLimits';
import { isAdminLike } from '@/lib/superAdmin';

export default function DocumentSignatures() {
  const navigate = useNavigate();
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: allSignatures = [], refetch } = useQuery({
    queryKey: ['all-signatures', selectedPatient],
    queryFn: () => {
      if (selectedPatient) {
        return base44.entities.DocumentSignature.filter({ patient_id: selectedPatient }, undefined, PATIENT_HISTORY_ROWS);
      }
      return base44.entities.DocumentSignature.list('-created_date', 200);
    },
    initialData: [],
    refetchInterval: 5000
  });

  const { data: patients = [] } = useScopedPatients({ sort: '-created_date', limit: 500 });

  const handleSignDocument = (sig) => {
    // SignDocument loads the PDF from the DocumentSignature entity by id —
    // never put document_url / signed-PDF paths in the query string (browser
    // history, Referer, analytics, and screenshots would retain PHI URLs).
    const params = new URLSearchParams({ signature_id: sig.id });
    if (sig.patient_id) params.set('patient_id', sig.patient_id);
    navigate(createPageUrl(`SignDocument?${params.toString()}`));
  };

  const handleSendReminder = async (sig) => {
    try {
      const res = await base44.functions.invoke('sendSignatureReminder', {
        signature_id: sig.id
      });
      const data = res?.data ?? res;
      if (data?.error) throw new Error(data.error);
      toast.success("Reminder sent successfully!");
    } catch (error) {
      toast.error(`Failed to send reminder: ${error.message}`);
    }
  };

  const isOverdue = (sig) => isSignatureOverdue(sig);

  const filteredSignatures = allSignatures.filter(sig => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const patient = patients.find(p => p.id === sig.patient_id);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}`.toLowerCase() : '';
    return (sig.document_name || '').toLowerCase().includes(query) || patientName.includes(query);
  });

  // Normalize before filtering: the DocumentSignature.status enum is
  // pending/in_progress/completed/rejected — there is no 'signed' value (that is
  // a display-only normalization), so a raw `=== 'signed'` filter never matches
  // and a raw `=== 'pending'` filter drops partially-signed (in_progress) docs.
  const pendingSignatures = filteredSignatures.filter(s => {
    const n = getNormalizedSignatureStatus(s);
    return n !== 'signed' && n !== 'declined' && n !== 'expired';
  });
  const signedSignatures = filteredSignatures.filter(s => getNormalizedSignatureStatus(s) === 'signed');

  const stats = {
    total: allSignatures.length,
    pending: allSignatures.filter(s => {
      const n = getNormalizedSignatureStatus(s);
      return n !== 'signed' && n !== 'declined' && n !== 'expired';
    }).length,
    signed: allSignatures.filter(s => getNormalizedSignatureStatus(s) === 'signed').length,
    overdue: allSignatures.filter(s => isOverdue(s)).length
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xl sm:text-2xl font-bold text-slate-900">{stats.total}</p>
              <p className="text-xs text-slate-600">Total</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xl sm:text-2xl font-bold text-yellow-600">{stats.pending}</p>
              <p className="text-xs text-slate-600">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xl sm:text-2xl font-bold text-green-600">{stats.signed}</p>
              <p className="text-xs text-slate-600">Signed</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xl sm:text-2xl font-bold text-red-600">{stats.overdue}</p>
              <p className="text-xs text-slate-600">Overdue</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <SearchablePatientSelect
                patients={patients}
                value={selectedPatient}
                onChange={setSelectedPatient}
                placeholder="Filter by patient (optional)"
              />
            </div>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button 
              variant="outline" 
              onClick={() => refetch()}
              className="w-full sm:w-auto"
            >
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pending Signatures */}
      {pendingSignatures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg text-yellow-700">
              Pending Signatures ({pendingSignatures.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingSignatures.map(sig => {
                const patient = patients.find(p => p.id === sig.patient_id);
                const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown';
                
                return (
                  <div
                    key={sig.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border rounded-lg hover:bg-yellow-50"
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Clock className="w-5 h-5 text-yellow-600 shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-slate-900 break-words">{sig.document_name}</h4>
                        <p className="text-sm text-slate-600">{patientName}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {isOverdue(sig) && (
                            <Badge className="bg-red-100 text-red-700">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Overdue
                            </Badge>
                          )}
                          {sig.due_date && (
                            <span className="text-xs text-slate-500">
                              Due: {formatLocalDate(sig.due_date)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleSignDocument(sig)}
                        className="w-full sm:w-auto"
                      >
                        <Pen className="w-4 h-4 mr-2" />
                        Sign
                      </Button>
                      {isAdminLike(currentUser) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSendReminder(sig)}
                          className="w-full sm:w-auto"
                        >
                          <Send className="w-4 h-4 mr-2" />
                          Remind
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Signed Documents */}
      {signedSignatures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg text-green-700">
              Completed Signatures ({signedSignatures.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {signedSignatures.map(sig => {
                const patient = patients.find(p => p.id === sig.patient_id);
                const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown';
                
                return (
                  <div
                    key={sig.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border rounded-lg hover:bg-green-50"
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-slate-900 break-words">{sig.document_name}</h4>
                        <p className="text-sm text-slate-600">{patientName}</p>
                        {sig.signed_at && (
                          <span className="text-xs text-slate-500">
                            Signed: {new Date(sig.signed_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    {sig.signed_pdf_url && (
                      <Button
                        variant="outline"
                        size="sm"
                        // Bare window.open gets no implicit noopener and no scheme check;
                        // signed_pdf_url is entity-supplied, so route it through the helper.
                        onClick={() => openExternalUrl(sig.signed_pdf_url)}
                        className="w-full sm:w-auto"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {filteredSignatures.length === 0 && (
        <EmptyState icon={FileText} title="No signatures found" description="Signature requests will appear here once created." />
      )}
    </div>
  );
}