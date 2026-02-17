import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles, Loader2, FileText, MessageSquare, UserSearch,
  ChevronDown, ChevronUp, Check, Copy
} from "lucide-react";
import { toast } from "sonner";

export default function AIFaxAssistant({ documents, coverData, onCoverDataChange, recipientName, recipientFax }) {
  const [loading, setLoading] = useState(null); // 'summarize' | 'suggest' | 'extract' | 'all'
  const [results, setResults] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const hasDocuments = documents?.length > 0;
  const docUrls = documents?.map(d => d.url).filter(Boolean) || [];

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
            {/* Quick action buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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