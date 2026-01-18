import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Search, Filter, FileText, Calendar, User, Eye, Trash2, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";
import AnalysisHistoryDetailModal from "../components/documents/AnalysisHistoryDetailModal";
import { format } from "date-fns";

export default function DocumentAnalysisHistoryPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPatient, setSelectedPatient] = useState("all");
  const [selectedDocType, setSelectedDocType] = useState("all");
  const [selectedDateRange, setSelectedDateRange] = useState("all");
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: historyList, isLoading, refetch } = useQuery({
    queryKey: ["documentAnalysisHistory", currentUser?.email],
    queryFn: async () => {
      const history = await base44.entities.DocumentAnalysisHistory.filter(
        { provider_email: currentUser.email },
        "-created_date",
        100
      );
      return history || [];
    },
    enabled: !!currentUser?.email
  });

  const { data: patients } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  // Filter and search logic
  const filteredHistory = (historyList || []).filter(item => {
    // Search query
    if (searchQuery && !item.file_names?.some(name => 
      name.toLowerCase().includes(searchQuery.toLowerCase())
    ) && !item.analysis_summary?.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    // Patient filter
    if (selectedPatient !== "all" && item.patient_id !== selectedPatient) {
      return false;
    }

    // Document type filter
    if (selectedDocType !== "all" && item.document_type !== selectedDocType) {
      return false;
    }

    // Date range filter
    if (selectedDateRange !== "all") {
      const createdDate = new Date(item.created_date);
      const now = new Date();
      const daysAgo = parseInt(selectedDateRange);

      if (createdDate < new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000)) {
        return false;
      }
    }

    return true;
  });

  const handleDelete = async (analysisId) => {
    setDeletingId(analysisId);
    try {
      await base44.entities.DocumentAnalysisHistory.delete(analysisId);
      toast.success("Analysis deleted");
      refetch();
    } catch (error) {
      toast.error("Failed to delete analysis");
    } finally {
      setDeletingId(null);
    }
  };

  const docTypeOptions = [
    "clinical_note",
    "lab_report",
    "discharge_summary",
    "medication_list",
    "consultation_note",
    "imaging_report",
    "hospital_record",
    "other"
  ];

  const dateRangeOptions = [
    { value: "all", label: "All Time" },
    { value: "7", label: "Last 7 Days" },
    { value: "30", label: "Last 30 Days" },
    { value: "90", label: "Last 90 Days" }
  ];

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <div className="p-2 sm:p-3 md:p-4 lg:p-6 max-w-7xl mx-auto w-full max-w-full overflow-x-hidden min-w-0 pb-20">
        <Button
          variant="outline"
          onClick={() => navigate(createPageUrl("DocumentAnalyzer"))}
          className="mb-4 w-full sm:w-auto"
          size="sm"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Analyzer
        </Button>

        {/* Header */}
        <Card className="mb-6 border-2 border-blue-200 dark:border-blue-800">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950 dark:to-cyan-950">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                Analysis History
              </CardTitle>
              <Badge variant="outline" className="text-sm">
                {filteredHistory.length} {filteredHistory.length === 1 ? "result" : "results"}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Search and Filters */}
        <Card className="mb-6">
          <CardContent className="p-4 md:p-6 space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by filename or content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5 block">
                  Patient
                </label>
                <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Patients</SelectItem>
                    {patients.map(patient => (
                      <SelectItem key={patient.id} value={patient.id}>
                        {patient.first_name} {patient.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5 block">
                  Document Type
                </label>
                <Select value={selectedDocType} onValueChange={setSelectedDocType}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {docTypeOptions.map(type => (
                      <SelectItem key={type} value={type}>
                        {type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5 block">
                  Date Range
                </label>
                <Select value={selectedDateRange} onValueChange={setSelectedDateRange}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dateRangeOptions.map(range => (
                      <SelectItem key={range.value} value={range.value}>
                        {range.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : filteredHistory.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600 dark:text-slate-400">
                {historyList?.length === 0 ? "No analyses yet" : "No analyses match your filters"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredHistory.map(analysis => {
              const patient = patients.find(p => p.id === analysis.patient_id);
              return (
                <Card key={analysis.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Left: Main Info */}
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100 truncate text-sm sm:text-base">
                            {analysis.file_names?.[0]?.split('/').pop() || "Analysis"}
                          </h3>
                          <Badge className="text-xs" variant="outline">
                            {analysis.file_count} {analysis.file_count === 1 ? "file" : "files"}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-400">
                          <div className="flex items-center gap-1 truncate">
                            <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{format(new Date(analysis.created_date), "MMM d, yyyy HH:mm")}</span>
                          </div>
                          {patient && (
                            <div className="flex items-center gap-1 truncate">
                              <User className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{patient.first_name} {patient.last_name}</span>
                            </div>
                          )}
                        </div>

                        {analysis.analysis_summary && (
                          <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-2">
                            {analysis.analysis_summary}
                          </p>
                        )}

                        <div className="flex flex-wrap gap-1 pt-1">
                          <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                            {analysis.document_type?.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                          </Badge>
                          {analysis.provider_type && (
                            <Badge className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                              {analysis.provider_type}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex flex-col justify-between gap-2">
                        <Button
                          size="sm"
                          className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                          onClick={() => {
                            setSelectedAnalysis(analysis);
                            setDetailModalOpen(true);
                          }}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1.5" />
                          View Details
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full sm:w-auto text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                          onClick={() => handleDelete(analysis.id)}
                          disabled={deletingId === analysis.id}
                        >
                          {deletingId === analysis.id ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedAnalysis && (
        <AnalysisHistoryDetailModal
          analysis={selectedAnalysis}
          isOpen={detailModalOpen}
          onClose={() => {
            setDetailModalOpen(false);
            setSelectedAnalysis(null);
          }}
        />
      )}
    </div>
  );
}