import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, FileText, Download, Trash2, Eye, Calendar, User, Tag, Filter, Grid, List, Brain, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import DocumentAIAnalysis from "./DocumentAIAnalysis";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "lab_results", label: "Lab Results" },
  { value: "imaging", label: "Imaging/X-Ray" },
  { value: "consent_forms", label: "Consent Forms" },
  { value: "insurance", label: "Insurance Documents" },
  { value: "referral", label: "Referral" },
  { value: "progress_notes", label: "Progress Notes" },
  { value: "discharge_summary", label: "Discharge Summary" },
  { value: "medication_list", label: "Medication List" },
  { value: "orders", label: "Orders" },
  { value: "other", label: "Other" }
];

const DocumentCard = ({ doc, onDocumentClick, getPatientName, getCategoryLabel, getCategoryColor, deleteMutation, showPatientInfo }) => {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const hasCriticalFlags = doc.ai_analysis?.critical_flags?.some(f => f.severity === 'critical' || f.severity === 'high');

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-slate-900 truncate">{doc.title}</h3>
              {doc.ai_analysis?.analyzed && (
                <Brain className="w-4 h-4 text-navy-600 flex-shrink-0" />
              )}
              {hasCriticalFlags && (
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 animate-pulse" />
              )}
            </div>
            {doc.description && (
              <p className="text-sm text-slate-600 line-clamp-2 mt-1">{doc.description}</p>
            )}
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
              {format(new Date(doc.document_date), 'MMM d, yyyy')}
            </div>
          )}
          {doc.tags?.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Tag className="w-3 h-3 text-slate-400" />
              {doc.tags.map((tag, i) => (
                <Badge key={i} variant="outline" className="text-xs">{tag}</Badge>
              ))}
            </div>
          )}
        </div>

        {doc.ai_analysis?.analyzed && showAnalysis && (
          <div className="mb-3">
            <DocumentAIAnalysis document={doc} compact={true} />
          </div>
        )}

        <div className="flex gap-2">
          {doc.ai_analysis?.analyzed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAnalysis(!showAnalysis)}
            >
              <Brain className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onDocumentClick ? onDocumentClick(doc) : window.open(doc.file_url, '_blank')}
          >
            <Eye className="w-4 h-4 mr-1" />
            View
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const link = document.createElement('a');
              link.href = doc.file_url;
              link.download = doc.file_name;
              link.click();
            }}
          >
            <Download className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Delete document"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="w-4 h-4 text-red-600" />
          </Button>
          <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Document</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{doc.title}"? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => deleteMutation.mutate(doc.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="mt-3 pt-3 border-t text-xs text-slate-500">
          Uploaded {format(new Date(doc.created_date), 'MMM d, yyyy')} by {doc.uploaded_by || doc.created_by}
        </div>
      </CardContent>
    </Card>
  );
};

export default function DocumentList({ patientId, showPatientInfo = true, onDocumentClick }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid");

  const queryClient = useQueryClient();

  const { data: documents = [], isLoading } = useQuery({
    queryKey: patientId ? ['patient-documents', patientId] : ['documents'],
    queryFn: () => patientId
      ? base44.entities.Document.filter({ patient_id: patientId }, '-created_date', 500)
      : base44.entities.Document.list('-created_date', 500),
    initialData: []
  });

  const { data: allPatients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
    initialData: [],
    enabled: showPatientInfo && !patientId
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Document.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['patient-documents'] });
      toast.success("Document deleted");
    }
  });

  const getPatientName = (patientId) => {
    if (!patientId) return null;
    const patient = allPatients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : "Unknown Patient";
  };

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesCategory = categoryFilter === "all" || doc.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  const getCategoryLabel = (category) => {
    return CATEGORIES.find(c => c.value === category)?.label || category;
  };

  const getCategoryColor = (category) => {
    const colors = {
      lab_results: "bg-blue-100 text-blue-800",
      imaging: "bg-navy-100 text-navy-800",
      consent_forms: "bg-green-100 text-green-800",
      insurance: "bg-yellow-100 text-yellow-800",
      referral: "bg-gold-100 text-gold-800",
      progress_notes: "bg-indigo-100 text-indigo-800",
      discharge_summary: "bg-orange-100 text-orange-800",
      medication_list: "bg-navy-100 text-navy-800",
      orders: "bg-red-100 text-red-800",
      other: "bg-slate-100 text-slate-800"
    };
    return colors[category] || colors.other;
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
              onDocumentClick={onDocumentClick}
              getPatientName={getPatientName}
              getCategoryLabel={getCategoryLabel}
              getCategoryColor={getCategoryColor}
              deleteMutation={deleteMutation}
              showPatientInfo={showPatientInfo}
            />
          ))}
        </div>
      )}
    </div>
  );
}
