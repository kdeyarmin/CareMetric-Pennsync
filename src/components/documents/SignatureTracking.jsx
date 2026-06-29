import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import SearchablePatientSelect from "../ui/SearchablePatientSelect";
import {
  getDocumentDisplayName,
  getNormalizedSignatureStatus,
  getSignatureDueDate,
  getSignatureSignedAt,
  isSignatureOverdue,
} from "@/components/signature/signatureUtils";

export default function SignatureTracking({ stats = {} }) {
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
        return base44.entities.DocumentSignature.filter({ patient_id: selectedPatient });
      }
      return base44.entities.DocumentSignature.list('-created_date', 200);
    },
    initialData: [],
    refetchInterval: 5000
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients-list'],
    queryFn: () => base44.entities.Patient.list('-created_date', 500),
    initialData: []
  });

  const normalizedSignatures = useMemo(() => allSignatures.map((signature) => ({
    ...signature,
    normalizedName: getDocumentDisplayName(signature),
    normalizedStatus: getNormalizedSignatureStatus(signature),
    normalizedDueDate: getSignatureDueDate(signature),
    normalizedSignedAt: getSignatureSignedAt(signature),
    isOverdue: isSignatureOverdue(signature),
  })), [allSignatures]);

  const handleSignDocument = (sig) => {
    const params = new URLSearchParams({
      signature_id: sig.id,
      patient_id: sig.patient_id,
    });

    if (sig.original_pdf_url || sig.document_url) {
      params.set('pdf_url', sig.original_pdf_url || sig.document_url);
    }

    navigate(createPageUrl(`SignDocument?${params.toString()}`));
  };

  const handleSendReminder = async (sig) => {
    try {
      await base44.functions.invoke('sendSignatureReminder', {
        signature_id: sig.id
      });
      toast.success("Reminder sent successfully!");
    } catch (error) {
      toast.error(`Failed to send reminder: ${error.message}`);
    }
  };

  const filteredSignatures = normalizedSignatures.filter((sig) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const patient = patients.find((p) => p.id === sig.patient_id);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}`.toLowerCase() : '';
    return (
      sig.normalizedName.toLowerCase().includes(query)
      || patientName.includes(query)
      || sig.document_type?.toLowerCase().includes(query)
    );
  });

  const pendingSignatures = filteredSignatures.filter((signature) => signature.normalizedStatus !== 'signed');
  const signedSignatures = filteredSignatures.filter((signature) => signature.normalizedStatus === 'signed');

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xl sm:text-2xl font-bold text-slate-900">{normalizedSignatures.length}</p>
              <p className="text-xs text-slate-600">Total</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xl sm:text-2xl font-bold text-yellow-600">{stats.pending || 0}</p>
              <p className="text-xs text-slate-600">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xl sm:text-2xl font-bold text-green-600">{stats.signed || 0}</p>
              <p className="text-xs text-slate-600">Signed</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xl sm:text-2xl font-bold text-red-600">{stats.overdue || 0}</p>
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
              {pendingSignatures.map((sig) => {
                const patient = patients.find((p) => p.id === sig.patient_id);
                const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown';

                return (
                  <div
                    key={sig.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border rounded-lg hover:bg-yellow-50"
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Clock className="w-5 h-5 text-yellow-600 shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-slate-900 break-words">{sig.normalizedName}</h4>
                        <p className="text-sm text-slate-600">{patientName}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {sig.isOverdue && (
                            <Badge className="bg-red-100 text-red-700">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Overdue
                            </Badge>
                          )}
                          {sig.normalizedDueDate && (
                            <span className="text-xs text-slate-500">
                              Due: {new Date(sig.normalizedDueDate).toLocaleDateString()}
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
                      {currentUser?.role === 'admin' && (
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
              {signedSignatures.map((sig) => {
                const patient = patients.find((p) => p.id === sig.patient_id);
                const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown';

                return (
                  <div
                    key={sig.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border rounded-lg hover:bg-green-50"
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-slate-900 break-words">{sig.normalizedName}</h4>
                        <p className="text-sm text-slate-600">{patientName}</p>
                        {sig.normalizedSignedAt && (
                          <span className="text-xs text-slate-500">
                            Signed: {new Date(sig.normalizedSignedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    {(sig.signed_pdf_url || sig.document_url || sig.original_pdf_url) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(sig.signed_pdf_url || sig.document_url || sig.original_pdf_url, '_blank')}
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
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600">No signatures found</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
