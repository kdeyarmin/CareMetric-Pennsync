import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  Eye,
  AlertCircle,
  Search,
  Filter
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { formatEastern } from "@/components/utils/timezone";
import { getDocumentDisplayName, getNormalizedSignatureStatus, getSignatureDueDate, getSignatureSignedAt } from "@/components/signature/signatureUtils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function DocumentSignatureTracker({ patientId }) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['document-signatures', patientId],
    queryFn: () => {
      if (patientId) {
        return base44.entities.DocumentSignature.filter({ patient_id: patientId }, '-created_date');
      }
      return base44.entities.DocumentSignature.list('-created_date', 100);
    },
    initialData: []
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients-for-signatures'],
    queryFn: () => base44.entities.Patient.list('last_name', 200),
    initialData: [],
    enabled: !patientId
  });

  const getStatusIcon = (status) => {
    switch (status) {
      case 'signed':
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'declined':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'expired':
        return <AlertCircle className="w-4 h-4 text-slate-600" />;
      default:
        return <FileText className="w-4 h-4 text-slate-600" />;
    }
  };

  const getStatusBadge = (status) => {
    const variants = {
      signed: 'bg-green-100 text-green-800',
      pending: 'bg-yellow-100 text-yellow-800',
      declined: 'bg-red-100 text-red-800',
      expired: 'bg-slate-100 text-slate-800'
    };
    return variants[status] || 'bg-slate-100 text-slate-800';
  };

  const getPatientName = (patientId) => {
    const patient = patients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown';
  };

  const normalizedDocuments = useMemo(() => documents.map((doc) => ({
    ...doc,
    normalizedName: getDocumentDisplayName(doc),
    normalizedStatus: getNormalizedSignatureStatus(doc),
    normalizedDueDate: getSignatureDueDate(doc),
    normalizedSignedAt: getSignatureSignedAt(doc),
  })), [documents]);

  const filteredDocuments = normalizedDocuments.filter(doc => {
    const matchesSearch =
      doc.normalizedName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.document_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getPatientName(doc.patient_id).toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || doc.normalizedStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const pendingCount = normalizedDocuments.filter((doc) => doc.normalizedStatus !== 'signed').length;
  const signedCount = normalizedDocuments.filter((doc) => doc.normalizedStatus === 'signed').length;

  const handleViewDocument = (doc) => {
    if (doc.normalizedStatus === 'signed' && doc.signed_pdf_url) {
      window.open(doc.signed_pdf_url, '_blank');
    } else {
      const params = new URLSearchParams({
        pdf_url: doc.document_url || doc.original_pdf_url || '',
        patient_id: doc.patient_id,
        document_type: doc.normalizedName
      });
      navigate(createPageUrl(`SignDocument?${params.toString()}`));
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-slate-500">Loading documents...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <span>Document Signatures</span>
          </div>
          <div className="flex gap-2">
            <Badge className="bg-yellow-100 text-yellow-800">
              {pendingCount} Pending
            </Badge>
            <Badge className="bg-green-100 text-green-800">
              {signedCount} Signed
            </Badge>
          </div>
        </CardTitle>

        {/* Search and Filter */}
        <div className="flex gap-2 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="signed">Signed</SelectItem>
              <SelectItem value="declined">Declined</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {filteredDocuments.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No documents found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDocuments.map((doc) => (
              <div
                key={doc.id}
                className="p-4 border rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getStatusIcon(doc.normalizedStatus)}
                      <h4 className="font-semibold text-slate-900 truncate">
                        {doc.normalizedName}
                      </h4>
                      <Badge className={getStatusBadge(doc.normalizedStatus)}>
                        {doc.normalizedStatus}
                      </Badge>
                    </div>

                    {!patientId && (
                      <p className="text-sm text-slate-600 mb-1">
                        Patient: {getPatientName(doc.patient_id)}
                      </p>
                    )}

                    <p className="text-xs text-slate-500">
                      Created: {formatEastern(doc.created_date, 'MMM d, yyyy')}
                    </p>

                    {doc.normalizedDueDate && (
                      <p className="text-xs text-orange-600">
                        Due: {formatEastern(doc.normalizedDueDate, 'MMM d, yyyy')}
                      </p>
                    )}

                    {doc.normalizedSignedAt && (
                      <p className="text-xs text-green-600">
                        Signed: {formatEastern(doc.normalizedSignedAt, 'MMM d, yyyy h:mm a')}
                      </p>
                    )}

                    {/* Signature Progress */}
                    {doc.required_signatures?.length > 0 && (
                      <div className="mt-2">
                        <div className="flex gap-1 mb-1">
                          {doc.required_signatures.map((sig, idx) => (
                            <div
                              key={idx}
                              className={`h-1 flex-1 rounded-full ${
                                sig.is_signed ? 'bg-green-500' : 'bg-slate-200'
                              }`}
                            />
                          ))}
                        </div>
                        <p className="text-xs text-slate-500">
                          {doc.required_signatures.filter(s => s.is_signed).length} of {doc.required_signatures.length} signatures completed
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleViewDocument(doc)}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      {doc.normalizedStatus === 'signed' ? 'View' : 'Sign'}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
