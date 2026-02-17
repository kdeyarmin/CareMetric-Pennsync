import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Search, Filter, Sparkles, Loader2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import PatientDocumentUploader from "./PatientDocumentUploader";
import PatientDocumentCard from "./PatientDocumentCard";

const CATEGORY_OPTIONS = [
  { value: "all", label: "All Categories" },
  { value: "lab_result", label: "Lab Results" },
  { value: "consultation_note", label: "Consultation Notes" },
  { value: "imaging_report", label: "Imaging Reports" },
  { value: "discharge_summary", label: "Discharge Summaries" },
  { value: "referral_letter", label: "Referral Letters" },
  { value: "prescription", label: "Prescriptions" },
  { value: "progress_note", label: "Progress Notes" },
  { value: "insurance_document", label: "Insurance" },
  { value: "consent_form", label: "Consent Forms" },
  { value: "surgical_report", label: "Surgical Reports" },
  { value: "therapy_note", label: "Therapy Notes" },
  { value: "oasis_assessment", label: "OASIS" },
  { value: "care_plan", label: "Care Plans" },
  { value: "other", label: "Other" },
];

export default function PatientDocumentsModule({ patientId, userEmail }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const queryClient = useQueryClient();

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["patientDocuments", patientId],
    queryFn: () => base44.entities.PatientDocument.filter({ patient_id: patientId }, "-created_date", 200),
    enabled: !!patientId,
  });

  const filtered = documents.filter((doc) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      doc.file_name?.toLowerCase().includes(q) ||
      doc.ai_summary?.toLowerCase().includes(q) ||
      doc.extracted_text?.toLowerCase().includes(q) ||
      doc.extracted_data?.diagnoses?.some(d => d.toLowerCase().includes(q)) ||
      doc.extracted_data?.medications?.some(m => m.toLowerCase().includes(q)) ||
      doc.extracted_data?.patient_name?.toLowerCase().includes(q) ||
      doc.extracted_data?.provider_name?.toLowerCase().includes(q) ||
      doc.extracted_data?.key_findings?.toLowerCase().includes(q) ||
      doc.tags?.some(t => t.toLowerCase().includes(q));
    const matchCat = categoryFilter === "all" || doc.document_category === categoryFilter;
    return matchSearch && matchCat;
  });

  const pendingDocs = documents.filter(d => d.processing_status === "pending" || d.processing_status === "failed");

  const handleAnalyzeAll = async () => {
    if (pendingDocs.length === 0) {
      toast.info("All documents are already analyzed");
      return;
    }
    setAnalyzingAll(true);
    toast.info(`Analyzing ${pendingDocs.length} document(s)...`);

    for (const doc of pendingDocs) {
      try {
        await base44.entities.PatientDocument.update(doc.id, { processing_status: "processing" });

        const res = await base44.integrations.Core.InvokeLLM({
          prompt: `You are an expert medical document analyst. Analyze the attached document and extract:
1. document_category: one of lab_result, consultation_note, imaging_report, discharge_summary, referral_letter, insurance_document, consent_form, prescription, progress_note, surgical_report, pathology_report, therapy_note, oasis_assessment, care_plan, other
2. summary: 2-3 sentence clinical summary
3. extracted_text: Full readable text (OCR), up to 2000 chars of most important content
4. extracted_data: patient_name, patient_dob, mrn, provider_name, date_of_service, diagnoses (array), medications (array), key_findings, follow_up_actions
5. tags: 3-8 searchable keywords
6. confidence: 0-100
Leave empty string or empty array if not found.`,
          file_urls: [doc.file_url],
          response_json_schema: {
            type: "object",
            properties: {
              document_category: { type: "string" },
              summary: { type: "string" },
              extracted_text: { type: "string" },
              extracted_data: {
                type: "object",
                properties: {
                  patient_name: { type: "string" },
                  patient_dob: { type: "string" },
                  mrn: { type: "string" },
                  provider_name: { type: "string" },
                  date_of_service: { type: "string" },
                  diagnoses: { type: "array", items: { type: "string" } },
                  medications: { type: "array", items: { type: "string" } },
                  key_findings: { type: "string" },
                  follow_up_actions: { type: "string" },
                },
              },
              tags: { type: "array", items: { type: "string" } },
              confidence: { type: "number" },
            },
          },
        });

        await base44.entities.PatientDocument.update(doc.id, {
          document_category: res.document_category || "other",
          ai_summary: res.summary || "",
          extracted_text: (res.extracted_text || "").substring(0, 5000),
          extracted_data: res.extracted_data || {},
          tags: res.tags || [],
          ai_confidence: res.confidence || 0,
          processing_status: "completed",
        });
      } catch (err) {
        console.error("Batch analysis failed for:", doc.file_name, err);
        await base44.entities.PatientDocument.update(doc.id, { processing_status: "failed" });
      }
    }

    queryClient.invalidateQueries({ queryKey: ["patientDocuments", patientId] });
    setAnalyzingAll(false);
    toast.success("Batch analysis complete");
  };

  const analyzedCount = documents.filter(d => d.processing_status === "completed").length;

  return (
    <Card className="w-full max-w-full overflow-hidden min-w-0">
      <CardHeader className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-blue-600" />
            Patient Documents
            <Badge className="bg-blue-100 text-blue-700 text-[10px]">{documents.length}</Badge>
            {analyzedCount > 0 && (
              <Badge className="bg-green-100 text-green-700 text-[10px]">{analyzedCount} analyzed</Badge>
            )}
          </CardTitle>
          <PatientDocumentUploader
            patientId={patientId}
            userEmail={userEmail}
            onUploaded={() => queryClient.invalidateQueries({ queryKey: ["patientDocuments", patientId] })}
          />
        </div>
      </CardHeader>

      <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
        {/* Search and filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search documents, diagnoses, medications..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px] h-9 text-xs">
                <Filter className="w-3 h-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pendingDocs.length > 0 && (
              <Button
                size="sm"
                className="h-9 gap-1 bg-purple-600 hover:bg-purple-700 text-xs whitespace-nowrap"
                onClick={handleAnalyzeAll}
                disabled={analyzingAll}
              >
                {analyzingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Analyze All ({pendingDocs.length})
              </Button>
            )}
          </div>
        </div>

        {/* Document list */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-lg bg-slate-100 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500 font-medium">
              {documents.length === 0 ? "No documents uploaded yet" : "No documents match your search"}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Upload PDFs, images, or scans to get AI-powered analysis
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {filtered.map((doc) => (
              <PatientDocumentCard key={doc.id} doc={doc} patientId={patientId} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}