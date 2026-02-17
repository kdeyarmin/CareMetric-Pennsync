import React, { useState, useEffect, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles, Loader2, FileText, MessageSquare, UserSearch,
  ChevronDown, ChevronUp, Check, Copy, Shield
} from "lucide-react";
import { toast } from "sonner";
import PreSendReview from "./PreSendReview";

export default function AIFaxAssistant({ documents, coverData, onCoverDataChange, recipientName, recipientFax }) {
  const [loading, setLoading] = useState(null);
  const [results, setResults] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [dismissedIds, setDismissedIds] = useState(new Set());
  const reviewTimerRef = useRef(null);

  const hasDocuments = documents?.length > 0;
  const docUrls = documents?.map(d => d.url).filter(Boolean) || [];

  // ---- Proactive local checks (run instantly on data change) ----
  const runLocalChecks = useCallback(() => {
    const items = [];
    let id = 0;

    // Recipient checks
    if (recipientFax) {
      const digits = recipientFax.replace(/\D/g, "");
      if (digits.length < 10) {
        items.push({ id: `local-${id++}`, severity: "error", area: "Recipient", title: "Fax number too short", message: `The number "${recipientFax}" has only ${digits.length} digits. US fax numbers need at least 10 digits.`, fix: null });
      } else if (digits.length > 15) {
        items.push({ id: `local-${id++}`, severity: "warning", area: "Recipient", title: "Fax number unusually long", message: `The number has ${digits.length} digits which seems longer than expected. Please verify it's correct.`, fix: null });
      }
      if (digits.length >= 10 && !digits.startsWith("1") && digits.length === 10) {
        items.push({ id: `local-${id++}`, severity: "info", area: "Recipient", title: "No country code", message: `Number appears to be a US number without country code (+1). The system will add it automatically.`, fix: null });
      }
    }
    if (!recipientName && recipientFax) {
      items.push({ id: `local-${id++}`, severity: "warning", area: "Recipient", title: "No recipient name", message: "Adding a recipient name helps identify the fax and improves cover sheet clarity.", fix: null });
    }

    // Cover sheet checks
    if (!coverData.sender_name) {
      items.push({ id: `local-${id++}`, severity: "warning", area: "Cover Sheet", title: "Sender name missing", message: "Your name is not set on the cover sheet. Recipients may not know who sent the fax.", fix: { label: "I'll enter it", action: "focus_sender" } });
    }
    if (!coverData.subject && hasDocuments) {
      items.push({ id: `local-${id++}`, severity: "warning", area: "Cover Sheet", title: "No subject line", message: "A subject line helps recipients quickly identify the purpose. The AI can generate one from your documents.", fix: null });
    }
    if (coverData.subject && coverData.subject.length < 5) {
      items.push({ id: `local-${id++}`, severity: "info", area: "Cover Sheet", title: "Subject line very short", message: "Consider a more descriptive subject to help the recipient prioritize this fax.", fix: null });
    }
    if (!coverData.message && hasDocuments) {
      items.push({ id: `local-${id++}`, severity: "info", area: "Cover Sheet", title: "No cover message", message: "A brief cover message provides context for the recipient. Use 'Summarize' or 'Suggest Text' to auto-generate one.", fix: null });
    }

    // HIPAA checks
    if (!coverData.include_hipaa && hasDocuments) {
      items.push({ id: `local-${id++}`, severity: "warning", area: "HIPAA", title: "HIPAA notice disabled", message: "HIPAA confidentiality notice is turned off. This is strongly recommended for all medical faxes to protect patient information.", fix: { label: "Enable HIPAA notice", action: "enable_hipaa" } });
    }

    // Document checks
    if (documents?.length > 0) {
      const unanalyzed = documents.filter(d => !d.analysis);
      if (unanalyzed.length > 0) {
        items.push({ id: `local-${id++}`, severity: "info", area: "Documents", title: `${unanalyzed.length} document(s) not analyzed`, message: "AI analysis helps auto-file documents and extract metadata for the cover sheet.", fix: null });
      }
    }

    // If everything passes
    if (items.length === 0 && recipientFax && hasDocuments) {
      items.push({ id: `local-${id++}`, severity: "success", area: "Review", title: "Ready to send", message: "No issues detected. Recipient, cover sheet, and documents look good.", fix: null });
    }

    return items;
  }, [recipientFax, recipientName, coverData, documents, hasDocuments]);

  // ---- AI-powered deep review (runs on demand or debounced) ----
  const runAIReview = async () => {
    if (!hasDocuments || !recipientFax) return;
    setReviewLoading(true);
    try {
      const docAnalyses = documents
        .filter(d => d.analysis)
        .map(d => `File: ${d.name}, Type: ${d.analysis.document_type || "unknown"}, Patient: ${d.analysis.patient_name || "unknown"}, Category: ${d.analysis.category || "unknown"}`)
        .join("\n");

      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a HIPAA-aware medical fax compliance assistant. Analyze the fax parameters below and provide a list of proactive suggestions, warnings, or confirmations. Be practical and specific.

RECIPIENT:
- Name: ${recipientName || "(not provided)"}
- Fax: ${recipientFax || "(not provided)"}

COVER SHEET:
- Sender: ${coverData.sender_name || "(not set)"}
- Company: ${coverData.sender_company || "(not set)"}
- Phone: ${coverData.sender_phone || "(not set)"}
- Subject: ${coverData.subject || "(empty)"}
- Message: ${coverData.message ? coverData.message.substring(0, 300) : "(empty)"}
- Urgency: ${coverData.urgency || "normal"}
- HIPAA notice: ${coverData.include_hipaa ? "enabled" : "DISABLED"}

ATTACHED DOCUMENTS (${documents.length}):
${docAnalyses || "No AI analysis available on documents yet."}

Provide review items. For each item include:
- severity: "error" | "warning" | "info" | "success"
- area: "Recipient" | "Cover Sheet" | "HIPAA" | "Documents" | "Compliance"
- title: Short title (5 words max)
- message: Concise explanation
- suggestion: Optional fix text to apply (empty string if none)
- suggestion_field: Which field to update: "subject" | "message" | "urgency" | "include_hipaa" | "" (empty if no auto-fix)

Focus on:
1. Recipient fax number format issues or improvements
2. HIPAA compliance: are PHI safeguards adequate given the document content?
3. Cover sheet completeness: missing sender info, vague subject, urgency mismatch
4. Document-to-recipient mismatch: does the content match what you'd expect for the recipient type?
5. Urgency appropriateness based on document content

Return at most 6 items. Prioritize actionable items.`,
        response_json_schema: {
          type: "object",
          properties: {
            review_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  severity: { type: "string" },
                  area: { type: "string" },
                  title: { type: "string" },
                  message: { type: "string" },
                  suggestion: { type: "string" },
                  suggestion_field: { type: "string" }
                }
              }
            }
          }
        }
      });

      const aiItems = (res.review_items || []).map((item, idx) => ({
        ...item,
        id: `ai-${idx}`,
        fix: item.suggestion && item.suggestion_field ? {
          label: `Apply: ${item.suggestion.substring(0, 40)}${item.suggestion.length > 40 ? "..." : ""}`,
          action: "apply_field",
          field: item.suggestion_field,
          value: item.suggestion
        } : null
      }));

      setReviewItems(prev => {
        const localItems = prev.filter(i => i.id.startsWith("local-"));
        return [...localItems, ...aiItems];
      });
    } catch (err) {
      console.error("AI review failed:", err);
    } finally {
      setReviewLoading(false);
    }
  };

  // Update local checks in real time
  useEffect(() => {
    const localItems = runLocalChecks();
    setReviewItems(prev => {
      const aiItems = prev.filter(i => i.id.startsWith("ai-"));
      return [...localItems, ...aiItems];
    });
  }, [runLocalChecks]);

  const handleDismiss = (id) => {
    setDismissedIds(prev => new Set([...prev, id]));
  };

  const handleApplyFix = (item) => {
    if (!item.fix) return;
    if (item.fix.action === "enable_hipaa") {
      onCoverDataChange({ ...coverData, include_hipaa: true });
      toast.success("HIPAA notice enabled");
    } else if (item.fix.action === "apply_field" && item.fix.field) {
      const field = item.fix.field;
      if (field === "include_hipaa") {
        onCoverDataChange({ ...coverData, include_hipaa: item.fix.value === "true" || item.fix.value === true });
      } else {
        onCoverDataChange({ ...coverData, [field]: item.fix.value });
      }
      toast.success("Suggestion applied");
    }
    handleDismiss(item.id);
  };

  const visibleItems = reviewItems.filter(i => !dismissedIds.has(i.id));

  const handleSummarize = async () => {
    if (!hasDocuments) { toast.error("Upload a document first"); return; }
    setLoading('summarize');
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a medical fax cover sheet assistant. Analyze the attached document(s) and write a concise, professional cover sheet message (3-5 sentences) summarizing the key content. 
Focus on: what the document is about, the purpose of sending it, and any action needed from the recipient.
Keep it HIPAA-compliant — do not include specific patient identifiers in the summary unless absolutely necessary for context.
If it's a medical record, note the type of record and general purpose.
Recipient: ${recipientName || 'Unknown'}
Current subject: ${coverData.subject || 'None'}`,
        file_urls: docUrls,
        response_json_schema: {
          type: "object",
          properties: {
            summary_message: { type: "string", description: "Concise cover sheet message" },
            suggested_subject: { type: "string", description: "Suggested subject line" }
          }
        }
      });
      setResults(prev => ({ ...prev, summary: res }));
    } catch (err) {
      toast.error("AI summarization failed");
    } finally {
      setLoading(null);
    }
  };

  const handleSuggestPhrasing = async () => {
    if (!hasDocuments) { toast.error("Upload a document first"); return; }
    setLoading('suggest');
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a professional medical fax assistant. Based on the attached documents, suggest 3 different cover sheet message options with varying tones:
1. A formal/professional version
2. A concise/brief version  
3. An urgent/action-required version

Each should be appropriate for a medical/healthcare fax.
Recipient: ${recipientName || 'Healthcare Provider'}
Recipient Fax: ${recipientFax || 'Unknown'}
Current subject: ${coverData.subject || 'Not specified'}`,
        file_urls: docUrls,
        response_json_schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  subject: { type: "string" },
                  message: { type: "string" },
                  urgency: { type: "string", enum: ["normal", "urgent", "for_review", "please_reply", "confidential"] }
                }
              }
            }
          }
        }
      });
      setResults(prev => ({ ...prev, suggestions: res.suggestions }));
    } catch (err) {
      toast.error("AI suggestion failed");
    } finally {
      setLoading(null);
    }
  };

  const handleExtractInfo = async () => {
    if (!hasDocuments) { toast.error("Upload a document first"); return; }
    setLoading('extract');
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze the attached medical document(s) and extract any key information that would be useful for a fax cover sheet. Extract what you can find — leave fields empty string if not found. Be accurate; do not guess.`,
        file_urls: docUrls,
        response_json_schema: {
          type: "object",
          properties: {
            patient_name: { type: "string" },
            patient_dob: { type: "string" },
            medical_record_number: { type: "string" },
            document_type: { type: "string", description: "e.g. Lab Results, Referral, Discharge Summary" },
            provider_name: { type: "string", description: "Ordering/referring provider" },
            date_of_service: { type: "string" },
            diagnosis: { type: "string" },
            key_findings: { type: "string", description: "Brief key findings if applicable" }
          }
        }
      });
      setResults(prev => ({ ...prev, extracted: res }));
    } catch (err) {
      toast.error("AI extraction failed");
    } finally {
      setLoading(null);
    }
  };

  const handleAnalyzeAll = async () => {
    if (!hasDocuments) { toast.error("Upload a document first"); return; }
    setLoading('all');
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a medical fax cover sheet AI assistant. Analyze the attached document(s) and provide all of the following:

1. A concise professional cover sheet message (3-5 sentences) summarizing the document content and purpose.
2. A suggested subject line for the fax.
3. Extract key patient/document information: patient name, DOB, MRN, document type, provider, date of service, diagnosis, key findings. Leave empty string if not found.
4. Suggest the appropriate urgency level.

Recipient: ${recipientName || 'Healthcare Provider'}
Current subject: ${coverData.subject || 'Not specified'}
Be HIPAA-aware: include clinical details only as needed for the cover sheet.`,
        file_urls: docUrls,
        response_json_schema: {
          type: "object",
          properties: {
            summary_message: { type: "string" },
            suggested_subject: { type: "string" },
            suggested_urgency: { type: "string", enum: ["normal", "urgent", "for_review", "please_reply", "confidential"] },
            patient_name: { type: "string" },
            patient_dob: { type: "string" },
            medical_record_number: { type: "string" },
            document_type: { type: "string" },
            provider_name: { type: "string" },
            date_of_service: { type: "string" },
            diagnosis: { type: "string" },
            key_findings: { type: "string" }
          }
        }
      });
      setResults({
        summary: { summary_message: res.summary_message, suggested_subject: res.suggested_subject },
        extracted: {
          patient_name: res.patient_name,
          patient_dob: res.patient_dob,
          medical_record_number: res.medical_record_number,
          document_type: res.document_type,
          provider_name: res.provider_name,
          date_of_service: res.date_of_service,
          diagnosis: res.diagnosis,
          key_findings: res.key_findings,
          suggested_urgency: res.suggested_urgency
        }
      });
    } catch (err) {
      toast.error("AI analysis failed");
    } finally {
      setLoading(null);
    }
  };

  const applySummary = (message, subject) => {
    const updates = { ...coverData };
    if (message) updates.message = message;
    if (subject) updates.subject = subject;
    onCoverDataChange(updates);
    toast.success("Applied to cover sheet");
  };

  const applySuggestion = (suggestion) => {
    onCoverDataChange({
      ...coverData,
      message: suggestion.message,
      subject: suggestion.subject || coverData.subject,
      urgency: suggestion.urgency || coverData.urgency
    });
    toast.success(`Applied "${suggestion.label}" template`);
  };

  const applyExtractedToSubject = (extracted) => {
    const parts = [];
    if (extracted.document_type) parts.push(extracted.document_type);
    if (extracted.patient_name) parts.push(`Patient: ${extracted.patient_name}`);
    if (extracted.date_of_service) parts.push(extracted.date_of_service);
    const subject = parts.join(' - ') || coverData.subject;

    const messageParts = [];
    if (extracted.document_type) messageParts.push(`Please find enclosed: ${extracted.document_type}.`);
    if (extracted.patient_name) messageParts.push(`Patient: ${extracted.patient_name}${extracted.patient_dob ? ` (DOB: ${extracted.patient_dob})` : ''}.`);
    if (extracted.medical_record_number) messageParts.push(`MRN: ${extracted.medical_record_number}.`);
    if (extracted.diagnosis) messageParts.push(`Diagnosis: ${extracted.diagnosis}.`);
    if (extracted.key_findings) messageParts.push(extracted.key_findings);

    onCoverDataChange({
      ...coverData,
      subject,
      message: messageParts.length > 0 ? messageParts.join('\n') : coverData.message,
      urgency: extracted.suggested_urgency || coverData.urgency
    });
    toast.success("Extracted info applied to cover sheet");
  };

  return (
    <Card className="border-purple-200 bg-gradient-to-br from-purple-50/50 to-blue-50/50">
      <CardContent className="p-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <span className="text-sm font-semibold text-purple-900">AI Fax Assistant</span>
            {!hasDocuments && <Badge className="text-[9px] bg-slate-100 text-slate-500">Upload docs to enable</Badge>}
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {expanded && (
          <div className="mt-3 space-y-3">
            {/* Pre-Send Review (always visible when there are items) */}
            {visibleItems.length > 0 && (
              <PreSendReview
                items={visibleItems}
                onDismiss={handleDismiss}
                onApplyFix={handleApplyFix}
              />
            )}

            {/* Quick action buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-auto py-2 flex-col gap-1 text-xs border-purple-200 hover:bg-purple-50"
                onClick={handleAnalyzeAll}
                disabled={!hasDocuments || loading !== null}
              >
                {loading === 'all' ? <Loader2 className="w-4 h-4 animate-spin text-purple-600" /> : <Sparkles className="w-4 h-4 text-purple-600" />}
                Full Analysis
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-auto py-2 flex-col gap-1 text-xs"
                onClick={handleSummarize}
                disabled={!hasDocuments || loading !== null}
              >
                {loading === 'summarize' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4 text-blue-600" />}
                Summarize
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-auto py-2 flex-col gap-1 text-xs"
                onClick={handleSuggestPhrasing}
                disabled={!hasDocuments || loading !== null}
              >
                {loading === 'suggest' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4 text-green-600" />}
                Suggest Text
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-auto py-2 flex-col gap-1 text-xs"
                onClick={handleExtractInfo}
                disabled={!hasDocuments || loading !== null}
              >
                {loading === 'extract' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserSearch className="w-4 h-4 text-amber-600" />}
                Extract Info
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-auto py-2 flex-col gap-1 text-xs border-indigo-200 hover:bg-indigo-50 col-span-2 sm:col-span-1"
                onClick={runAIReview}
                disabled={reviewLoading || loading !== null}
              >
                {reviewLoading ? <Loader2 className="w-4 h-4 animate-spin text-indigo-600" /> : <Shield className="w-4 h-4 text-indigo-600" />}
                AI Review
              </Button>
            </div>

            {/* Results */}
            {results?.summary && (
              <SummaryResult
                summary={results.summary}
                onApply={() => applySummary(results.summary.summary_message, results.summary.suggested_subject)}
              />
            )}

            {results?.suggestions && (
              <SuggestionsResult
                suggestions={results.suggestions}
                onApply={applySuggestion}
              />
            )}

            {results?.extracted && (
              <ExtractedResult
                extracted={results.extracted}
                onApply={() => applyExtractedToSubject(results.extracted)}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryResult({ summary, onApply }) {
  return (
    <div className="bg-white rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-blue-700 flex items-center gap-1">
          <FileText className="w-3 h-3" /> Document Summary
        </span>
        <Button size="sm" className="h-6 text-[10px] gap-1 bg-blue-600" onClick={onApply}>
          <Check className="w-3 h-3" /> Apply
        </Button>
      </div>
      {summary.suggested_subject && (
        <p className="text-xs"><span className="font-medium text-slate-500">Subject:</span> {summary.suggested_subject}</p>
      )}
      <p className="text-xs text-slate-700 leading-relaxed">{summary.summary_message}</p>
    </div>
  );
}

function SuggestionsResult({ suggestions, onApply }) {
  return (
    <div className="bg-white rounded-lg border p-3 space-y-2">
      <span className="text-xs font-semibold text-green-700 flex items-center gap-1">
        <MessageSquare className="w-3 h-3" /> Message Suggestions
      </span>
      <div className="space-y-2">
        {suggestions?.map((s, i) => (
          <div key={i} className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
            <div className="flex items-center justify-between mb-1">
              <Badge className="text-[9px] bg-green-100 text-green-700">{s.label}</Badge>
              <Button size="sm" variant="ghost" className="h-5 text-[10px] gap-1 text-green-700" onClick={() => onApply(s)}>
                <Check className="w-3 h-3" /> Use
              </Button>
            </div>
            {s.subject && <p className="text-[10px] text-slate-500 mb-1">Subject: {s.subject}</p>}
            <p className="text-xs text-slate-700 leading-relaxed">{s.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExtractedResult({ extracted, onApply }) {
  const fields = [
    { key: 'patient_name', label: 'Patient Name' },
    { key: 'patient_dob', label: 'DOB' },
    { key: 'medical_record_number', label: 'MRN' },
    { key: 'document_type', label: 'Document Type' },
    { key: 'provider_name', label: 'Provider' },
    { key: 'date_of_service', label: 'Date of Service' },
    { key: 'diagnosis', label: 'Diagnosis' },
    { key: 'key_findings', label: 'Key Findings' },
  ].filter(f => extracted[f.key]);

  if (fields.length === 0) {
    return (
      <div className="bg-white rounded-lg border p-3">
        <p className="text-xs text-slate-500">No extractable information found in the document(s).</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-amber-700 flex items-center gap-1">
          <UserSearch className="w-3 h-3" /> Extracted Information
        </span>
        <Button size="sm" className="h-6 text-[10px] gap-1 bg-amber-600" onClick={onApply}>
          <Check className="w-3 h-3" /> Apply All
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {fields.map(f => (
          <div key={f.key}>
            <span className="text-[10px] text-slate-400">{f.label}</span>
            <p className="text-xs font-medium text-slate-700 truncate">{extracted[f.key]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}