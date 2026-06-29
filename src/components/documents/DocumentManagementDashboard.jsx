import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Search,
  Eye,
  Package,
  Pen,
  Send
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  getDocumentDisplayName,
  getNormalizedSignatureStatus,
  getSignatureDueDate,
  getSignatureSignedAt,
  getSignatureStatusLabel,
  isSignatureOverdue,
} from "@/components/signature/signatureUtils";

export default function DocumentManagementDashboard() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: documentSignatures = [], isLoading: docsLoading } = useQuery({
    queryKey: ['document-signatures-dashboard'],
    queryFn: () => base44.entities.DocumentSignature.list('-created_date', 200),
    initialData: [],
    refetchInterval: 10000 // Real-time updates every 10 seconds
  });

  const { data: documentPackages = [], isLoading: packagesLoading } = useQuery({
    queryKey: ['document-packages'],
    queryFn: () => base44.entities.DocumentPackage.list('-created_date', 100),
    initialData: []
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients-list'],
    queryFn: () => base44.entities.Patient.list('-created_date', 500),
    initialData: []
  });

  const normalizedDocuments = useMemo(() => documentSignatures.map((doc) => ({
    ...doc,
    normalizedName: getDocumentDisplayName(doc),
    normalizedStatus: getNormalizedSignatureStatus(doc),
    normalizedDueDate: getSignatureDueDate(doc),
    normalizedSignedAt: getSignatureSignedAt(doc),
    normalizedStatusLabel: getSignatureStatusLabel(doc),
    isOverdue: isSignatureOverdue(doc),
  })), [documentSignatures]);

  // Calculate statistics
  const stats = useMemo(() => {
    const pending = normalizedDocuments.filter((doc) => doc.normalizedStatus !== 'signed').length;
    const signed = normalizedDocuments.filter((doc) => doc.normalizedStatus === 'signed').length;
    const declined = normalizedDocuments.filter((doc) => doc.normalizedStatus === 'declined').length;
    const overdue = normalizedDocuments.filter((doc) => doc.isOverdue).length;

    return { pending, signed, declined, overdue, total: normalizedDocuments.length };
  }, [normalizedDocuments]);

  // Group documents by patient
  const documentsByPatient = useMemo(() => {
    const grouped = {};

    normalizedDocuments.forEach((doc) => {
      if (!grouped[doc.patient_id]) {
        const patient = patients.find((p) => p.id === doc.patient_id);
        grouped[doc.patient_id] = {
          patient_id: doc.patient_id,
          patient_name: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient',
          documents: []
        };
      }
      grouped[doc.patient_id].documents.push(doc);
    });

    return Object.values(grouped);
  }, [normalizedDocuments, patients]);

  // Filter documents
  const filteredGroups = useMemo(() => {
    let groups = documentsByPatient;

    // Filter by status
    if (statusFilter !== 'all') {
      groups = groups.map((group) => ({
        ...group,
        documents: group.documents.filter((doc) => doc.normalizedStatus === statusFilter)
      })).filter((group) => group.documents.length > 0);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      groups = groups.filter((group) =>
        group.patient_name.toLowerCase().includes(query)
        || group.documents.some((doc) =>
          doc.normalizedName.toLowerCase().includes(query)
          || doc.document_type?.toLowerCase().includes(query)
        )
      );
    }

    return groups;
  }, [documentsByPatient, statusFilter, searchQuery]);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'signed': return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case 'pending':
      case 'in_progress':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'declined': return <XCircle className="w-4 h-4 text-red-600" />;
      default: return <FileText className="w-4 h-4 text-slate-600" />;
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      signed: "bg-green-100 text-green-800",
      pending: "bg-yellow-100 text-yellow-800",
      in_progress: "bg-blue-100 text-blue-800",
      declined: "bg-red-100 text-red-800",
      expired: "bg-slate-100 text-slate-700"
    };
    return <Badge className={styles[status] || "bg-slate-100 text-slate-700"}>{getSignatureStatusLabel(status)}</Badge>;
  };

  const handleSignDocument = (doc) => {
    const params = new URLSearchParams({
      signature_id: doc.id,
      patient_id: doc.patient_id,
    });

    if (doc.original_pdf_url || doc.document_url) {
      params.set('pdf_url', doc.original_pdf_url || doc.document_url);
    }

    navigate(createPageUrl(`SignDocument?${params.toString()}`));
  };

  const handleSendReminder = async (doc) => {
    try {
      await base44.functions.invoke('sendSignatureReminder', {
        signature_id: doc.id
      });
      toast.success("Reminder sent successfully!");
    } catch (error) {
      toast.error(`Failed to send reminder: ${error.message}`);
    }
  };

  if (docsLoading || packagesLoading) {
    return <div className="text-center py-8">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-slate-600">Total Documents</p>
                <p className="text-xl sm:text-2xl font-bold">{stats.total}</p>
              </div>
              <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-slate-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-slate-600">Pending</p>
                <p className="text-xl sm:text-2xl font-bold text-yellow-600">{stats.pending}</p>
              </div>
              <Clock className="w-6 h-6 sm:w-8 sm:h-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-slate-600">Signed</p>
                <p className="text-xl sm:text-2xl font-bold text-green-600">{stats.signed}</p>
              </div>
              <CheckCircle2 className="w-6 h-6 sm:w-8 sm:h-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-slate-600">Overdue</p>
                <p className="text-xl sm:text-2xl font-bold text-red-600">{stats.overdue}</p>
              </div>
              <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-red-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-slate-600">Packages</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-600">{documentPackages.length}</p>
              </div>
              <Package className="w-6 h-6 sm:w-8 sm:h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by patient or document..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="signed">Signed</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Documents by Patient */}
      <div className="space-y-4">
        {filteredGroups.map((group) => (
          <Card key={group.patient_id}>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <Link
                  to={createPageUrl(`PatientDetails?id=${group.patient_id}`)}
                  className="hover:text-blue-600 transition-colors break-words"
                >
                  {group.patient_name}
                </Link>
                <Badge variant="outline" className="self-start sm:self-auto">{group.documents.length} document(s)</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {group.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 border rounded-lg hover:bg-slate-50"
                  >
                    <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                      {getStatusIcon(doc.normalizedStatus)}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h4 className="font-medium text-slate-900 break-words">{doc.normalizedName}</h4>
                          {getStatusBadge(doc.normalizedStatus)}
                          {doc.isOverdue && (
                            <Badge className="bg-red-100 text-red-700">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Overdue
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm text-slate-600 break-words">
                          Type: {doc.document_type}
                          {doc.normalizedDueDate && ` • Due: ${new Date(doc.normalizedDueDate).toLocaleDateString()}`}
                          {doc.normalizedSignedAt && ` • Signed: ${new Date(doc.normalizedSignedAt).toLocaleDateString()}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      {doc.normalizedStatus !== 'signed' && (
                        <Button
                          size="sm"
                          onClick={() => handleSignDocument(doc)}
                          className="w-full sm:w-auto"
                        >
                          <Pen className="w-4 h-4 sm:mr-2" />
                          <span className="sm:inline hidden">Sign</span>
                        </Button>
                      )}
                      {doc.normalizedStatus !== 'signed' && currentUser?.role === 'admin' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSendReminder(doc)}
                          className="w-full sm:w-auto"
                        >
                          <Send className="w-4 h-4 sm:mr-2" />
                          <span className="sm:inline hidden">Remind</span>
                        </Button>
                      )}
                      {(doc.signed_pdf_url || doc.document_url || doc.original_pdf_url) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(doc.signed_pdf_url || doc.document_url || doc.original_pdf_url, '_blank')}
                          className="w-full sm:w-auto"
                        >
                          <Eye className="w-4 h-4 sm:mr-2" />
                          <span className="sm:inline hidden">View</span>
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

        {filteredGroups.length === 0 && (
          <Card>
            <CardContent className="text-center py-12">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">No documents found</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
