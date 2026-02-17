import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText, Image, ChevronDown, ChevronUp, Loader2, Sparkles,
  Check, ExternalLink, Trash2, Calendar, User, Stethoscope, Pill, Tag
} from "lucide-react";
import { format, isValid } from "date-fns";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const CATEGORY_LABELS = {
  lab_result: "Lab Result",
  consultation_note: "Consultation Note",
  imaging_report: "Imaging Report",
  discharge_summary: "Discharge Summary",
  referral_letter: "Referral Letter",
  insurance_document: "Insurance",
  consent_form: "Consent Form",
  prescription: "Prescription",
  progress_note: "Progress Note",
  surgical_report: "Surgical Report",
  pathology_report: "Pathology Report",
  therapy_note: "Therapy Note",
  oasis_assessment: "OASIS Assessment",
  care_plan: "Care Plan",
  other: "Other",
};

const CATEGORY_COLORS = {
  lab_result: "bg-green-100 text-green-700",
  consultation_note: "bg-blue-100 text-blue-700",
  imaging_report: "bg-purple-100 text-purple-700",
  discharge_summary: "bg-amber-100 text-amber-700",
  referral_letter: "bg-indigo-100 text-indigo-700",
  prescription: "bg-red-100 text-red-700",
  progress_note: "bg-cyan-100 text-cyan-700",
  other: "bg-slate-100 text-slate-600",
};

const STATUS_CONFIG = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-700" },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-700" },
  completed: { label: "Analyzed", color: "bg-green-100 text-green-700" },
  failed: { label: "Failed", color: "bg-red-100 text-red-700" },
};

export default function PatientDocumentCard({ doc, patientId }) {
  const [expanded, setExpanded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.PatientDocument.delete(doc.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patientDocuments", patientId] });
      toast.success("Document deleted");
    },
  });

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      await base44.entities.PatientDocument.update(doc.id, { processing_status: "processing" });

      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert medical document analyst. Analyze the attached document and extract ALL of the following:

1. DOCUMENT CATEGORY: Classify as one of: lab_result, consultation_note, imaging_report, discharge_summary, referral_letter, insurance_document, consent_form, prescription, progress_note, surgical_report, pathology_report, therapy_note, oasis_assessment, care_plan, other

2. SUMMARY: Write a concise 2-3 sentence clinical summary of the document.

3. EXTRACTED TEXT: Provide the full readable text from the document (OCR). If the document has lots of text, capture the most important clinical content (up to 2000 chars).

4. KEY DATA EXTRACTION:
   - patient_name: Full name if found
   - patient_dob: Date of birth if found
   - mrn: Medical record number if found
   - provider_name: Doctor/provider name
   - date_of_service: Date of service/visit
   - diagnoses: Array of diagnosis strings
   - medications: Array of medication names mentioned
   - key_findings: Important clinical findings
   - follow_up_actions: Any recommended follow-up

5. TAGS: Generate 3-8 searchable keyword tags.

6. CONFIDENCE: Your confidence in the analysis (0-100).

Leave fields as empty string or empty array if not found. Be accurate.`,
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

      queryClient.invalidateQueries({ queryKey: ["patientDocuments", patientId] });
      toast.success("AI analysis complete");
    } catch (err) {
      console.error("Analysis failed:", err);
      await base44.entities.PatientDocument.update(doc.id, { processing_status: "failed" });
      queryClient.invalidateQueries({ queryKey: ["patientDocuments", patientId] });
      toast.error("AI analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const isImage = doc.file_type?.startsWith("image/");
  const status = STATUS_CONFIG[doc.processing_status] || STATUS_CONFIG.pending;
  const catColor = CATEGORY_COLORS[doc.document_category] || CATEGORY_COLORS.other;
  const catLabel = CATEGORY_LABELS[doc.document_category] || doc.document_category || "Unclassified";

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
              {isImage ? <Image className="w-4 h-4 text-slate-500" /> : <FileText className="w-4 h-4 text-blue-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{doc.file_name}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <Badge className={`text-[10px] ${catColor}`}>{catLabel}</Badge>
                <Badge className={`text-[10px] ${status.color}`}>{status.label}</Badge>
                {doc.ai_confidence > 0 && (
                  <span className="text-[10px] text-slate-400">{doc.ai_confidence}% conf</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {doc.processing_status !== "completed" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={(e) => { e.stopPropagation(); handleAnalyze(); }}
                  disabled={analyzing}
                >
                  {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-purple-600" />}
                </Button>
              )}
              {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
          </div>
        </CardContent>
      </button>

      {expanded && (
        <div className="border-t bg-slate-50/50 p-3 space-y-3 animate-fade-in">
          {/* Summary */}
          {doc.ai_summary && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-purple-500" /> AI Summary
              </p>
              <p className="text-sm text-slate-700 leading-relaxed">{doc.ai_summary}</p>
            </div>
          )}

          {/* Extracted data */}
          {doc.extracted_data && Object.keys(doc.extracted_data).length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {doc.extracted_data.patient_name && (
                <DataField icon={User} label="Patient" value={doc.extracted_data.patient_name} />
              )}
              {doc.extracted_data.date_of_service && (
                <DataField icon={Calendar} label="Date of Service" value={doc.extracted_data.date_of_service} />
              )}
              {doc.extracted_data.provider_name && (
                <DataField icon={Stethoscope} label="Provider" value={doc.extracted_data.provider_name} />
              )}
              {doc.extracted_data.mrn && (
                <DataField icon={FileText} label="MRN" value={doc.extracted_data.mrn} />
              )}
              {doc.extracted_data.diagnoses?.length > 0 && (
                <div className="col-span-2">
                  <DataField icon={Stethoscope} label="Diagnoses" value={doc.extracted_data.diagnoses.join(", ")} />
                </div>
              )}
              {doc.extracted_data.medications?.length > 0 && (
                <div className="col-span-2">
                  <DataField icon={Pill} label="Medications" value={doc.extracted_data.medications.join(", ")} />
                </div>
              )}
              {doc.extracted_data.key_findings && (
                <div className="col-span-2">
                  <DataField icon={Sparkles} label="Key Findings" value={doc.extracted_data.key_findings} />
                </div>
              )}
              {doc.extracted_data.follow_up_actions && (
                <div className="col-span-2">
                  <DataField icon={Check} label="Follow-Up" value={doc.extracted_data.follow_up_actions} />
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          {doc.tags?.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Tag className="w-3 h-3 text-slate-400" />
              {doc.tags.map((tag, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">{tag}</Badge>
              ))}
            </div>
          )}

          {/* Extracted text preview */}
          {doc.extracted_text && (
            <details className="text-xs">
              <summary className="text-slate-500 cursor-pointer hover:text-slate-700 font-medium">
                View extracted text
              </summary>
              <div className="mt-1 p-2 bg-white rounded border max-h-40 overflow-y-auto text-slate-600 whitespace-pre-wrap">
                {doc.extracted_text}
              </div>
            </details>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                <ExternalLink className="w-3 h-3" /> View File
              </Button>
            </a>
            {doc.processing_status !== "completed" && (
              <Button size="sm" className="h-7 text-xs gap-1 bg-purple-600 hover:bg-purple-700" onClick={handleAnalyze} disabled={analyzing}>
                {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Analyze with AI
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 ml-auto"
              onClick={() => deleteMutation.mutate()}
            >
              <Trash2 className="w-3 h-3" /> Delete
            </Button>
          </div>

          <p className="text-[10px] text-slate-400">
            Uploaded {doc.created_date ? format(new Date(doc.created_date), "MMM d, yyyy h:mm a") : ""}
            {doc.file_size ? ` • ${(doc.file_size / 1024).toFixed(0)} KB` : ""}
          </p>
        </div>
      )}
    </Card>
  );
}

function DataField({ icon: Icon, label, value }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 flex items-center gap-1">
        <Icon className="w-3 h-3" /> {label}
      </p>
      <p className="text-xs text-slate-700 break-words">{value}</p>
    </div>
  );
}