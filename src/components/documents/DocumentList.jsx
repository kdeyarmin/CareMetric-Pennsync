import { useState } from "react";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { getAuthorizedDocument } from '@/functions/getAuthorizedDocument';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, FileText, Download, Eye, Calendar, User, Filter, Grid, List } from "lucide-react";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/dateLocal";
import { openExternalUrl } from "@/components/utils/security";
import { toast } from 'sonner';

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "referral", label: "Referral" },
  { value: "other", label: "Other" }
];

const DocumentCard = ({
  doc,
  onView,
  onDownload,
  isOpening,
  getPatientName,
  getCategoryLabel,
  getCategoryColor,
  showPatientInfo,
}) => {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-slate-900 truncate">{doc.title}</h3>
            </div>
            <p className="text-sm text-slate-600 truncate">{doc.file_name}</p>
          </div>
          {doc.is_sensitive && (
            <Badge variant="destructive" className="ml-2 flex-shrink-0">Sensitive</Badge>
          )}
        </div>

        <div className="space-y-2 mb-3">
          <Badge className={getCategoryColor(doc.category)}>
            {getCategoryLabel(doc.category)}
          </Badge>
          {showPatientInfo && doc.patient_id && (
            <div className="flex items-center gap-1 text-sm text-slate-600">
              <User className="w-3 h-3" />
              {getPatientName(doc.patient_id)}
            </div>
          )}
          {doc.document_date && (
            <div className="flex items-center gap-1 text-sm text-slate-600">
              <Calendar className="w-3 h-3" />
              {format(parseLocalDate(doc.document_date), 'MMM d, yyyy')}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={isOpening}
            onClick={() => onView(doc)}
          >
            <Eye className="w-4 h-4 mr-1" />
            View
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Download ${doc.title}`}
            disabled={isOpening}
            onClick={() => onDownload(doc)}
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>

        <div className="mt-3 pt-3 border-t text-xs text-slate-500">
          Updated {format(new Date(doc.updated_date), 'MMM d, yyyy')}
        </div>
      </CardContent>
    </Card>
  );
};

export default function DocumentList({
  documents = [],
  agencyId,
  isLoading = false,
  showPatientInfo = true,
  onDocumentClick,
  assignment,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [openingDocumentId, setOpeningDocumentId] = useState(null);

  const { data: allPatients = [] } = useScopedPatients({
    sort: '-updated_date',
    limit: 2000,
    enabled: showPatientInfo && !!agencyId,
    readMode: 'authorized-roster',
    agencyId: agencyId || undefined,
  });

  const getPatientName = (patientId) => {
    if (!patientId) return null;
    const patient = allPatients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : "Patient record";
  };

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.file_name?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = categoryFilter === "all" || doc.category === categoryFilter;

    const matchesAssignment =
      assignment === "with_patient" ? !!doc.patient_id
        : assignment === "unassigned" ? !doc.patient_id
        : true;

    return matchesSearch && matchesCategory && matchesAssignment;
  });

  const getCategoryLabel = (category) => {
    return CATEGORIES.find(c => c.value === category)?.label || category;
  };

  const getCategoryColor = (category) => {
    const colors = {
      referral: "bg-gold-100 text-gold-800",
      other: "bg-slate-100 text-slate-800"
    };
    return colors[category] || colors.other;
  };

  const authorizeDownload = async (doc, action) => {
    if (!agencyId) {
      toast.error('Document tenant authorization is unavailable');
      return;
    }
    setOpeningDocumentId(doc.id);
    try {
      const result = await getAuthorizedDocument({
        agencyId,
        documentId: doc.id,
        purpose: 'download',
      });
      const downloadUrl = result.delivery.download_url;
      if (action === 'view') {
        if (onDocumentClick) onDocumentClick({ ...doc, file_url: downloadUrl });
        else openExternalUrl(downloadUrl);
        return;
      }
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = doc.file_name;
      link.click();
    } catch {
      toast.error('Document access could not be authorized');
    } finally {
      setOpeningDocumentId(null);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8 text-slate-500">Loading documents...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(cat => (
              <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1 border rounded-lg p-1">
          <Button
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("grid")}
          >
            <Grid className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("list")}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {filteredDocuments.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500">No documents found</p>
        </div>
      ) : (
        <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-2"}>
          {filteredDocuments.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              onView={(selected) => authorizeDownload(selected, 'view')}
              onDownload={(selected) => authorizeDownload(selected, 'download')}
              isOpening={openingDocumentId === doc.id}
              getPatientName={getPatientName}
              getCategoryLabel={getCategoryLabel}
              getCategoryColor={getCategoryColor}
              showPatientInfo={showPatientInfo}
            />
          ))}
        </div>
      )}
    </div>
  );
}
