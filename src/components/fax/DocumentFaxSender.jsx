import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Loader2, PenLine, CheckCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { sendFax } from "@/functions/sendFax";
import FaxAddressBook from "./FaxAddressBook";
import FaxSignaturePanel from "./FaxSignaturePanel";
import FaxOCRExtractor from "./FaxOCRExtractor";
import FaxCoverSheetGenerator from "./FaxCoverSheetGenerator";
import PDFAnnotator from "./PDFAnnotator";

export default function DocumentFaxSender({ patientId, prefilledData }) {
  const [selectedDocId, setSelectedDocId] = useState("");
  const [toNumber, setToNumber] = useState(prefilledData?.recipient_fax_number || "");
  const [toName, setToName] = useState("");

  React.useEffect(() => {
    if (prefilledData?.recipient_fax_number) setToNumber(prefilledData.recipient_fax_number);
  }, [prefilledData]);
  const [isSending, setIsSending] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);
  const [coverSheetUrl, setCoverSheetUrl] = useState(null);
  const [showAnnotator, setShowAnnotator] = useState(false);
  const [annotatedUrl, setAnnotatedUrl] = useState(null);

  const { data: documents = [] } = useAgencyScopedQuery({
    // DocumentList reads 500 rows under these same keys; without the limit in
    // the key the larger list was silently truncated to 100 (or this picker
    // over-fetched) depending on mount order. Prefix invalidation still works.
    queryKey: patientId ? ['patient-documents', patientId, 100] : ['documents', 100],
    fetch: () => patientId
      ? base44.entities.Document.filter({ patient_id: patientId }, '-created_date', 100)
      : base44.entities.Document.list('-created_date', 100),
    // Only the unpinned branch reads across charts. Scoping the patient_id
    // branch would drop a document from the fax picker on the very chart it
    // belongs to, if a clinician outside this agency uploaded it.
    scoped: !patientId,
    authorOf: (d) => d.uploaded_by || d.created_by,
    initialData: []
  });

  const pdfDocuments = documents.filter(doc =>
    doc.file_type?.includes('pdf') || doc.file_name?.toLowerCase().endsWith('.pdf')
  );

  const handleSendFax = async () => {
    if (!selectedDocId || !toNumber.trim()) {
      toast.error("Please select a document and enter a recipient number");
      return;
    }
    const doc = pdfDocuments.find(d => d.id === selectedDocId);
    if (!doc) return toast.error("Document not found");

    setIsSending(true);
    try {
      // Use annotated version if available
      let fileUrl = annotatedUrl || doc.file_url;
      if (signatureDataUrl) {
        const result = await base44.functions.invoke('stampSignatureOnPDF', {
          pdf_url: fileUrl,
          signature_data_url: signatureDataUrl
        });
        fileUrl = result.data.file_url;
      }
      // Prepend cover sheet if generated
      if (coverSheetUrl) {
        const merged = await base44.functions.invoke('mergePDFs', {
          pdf_urls: [coverSheetUrl, fileUrl]
        });
        fileUrl = merged.data?.merged_pdf_url || fileUrl;
      }
      await sendFax({
        file_url: fileUrl,
        to_number: toNumber,
        document_name: doc.title,
        patient_id: patientId,
        to_name: toName || undefined
      });
      toast.success("Fax sent successfully!");
      setSelectedDocId("");
      setToNumber("");
      setToName("");
      setSignatureDataUrl(null);
      setCoverSheetUrl(null);
      setAnnotatedUrl(null);
    } catch (error) {
      toast.error("Failed to send fax: " + error.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="shadow-lg">
      <CardContent className="p-6 space-y-5">
        <div className="space-y-2">
          <Label className="text-sm font-semibold text-slate-700">Select Document</Label>
          <Select
            value={selectedDocId}
            onValueChange={(id) => {
              // Reset any per-document artifacts so the previously annotated PDF /
              // stale OCR / cover sheet can't be faxed under the new document's name.
              setSelectedDocId(id);
              setAnnotatedUrl(null);
              setCoverSheetUrl(null);
            }}
          >
            <SelectTrigger className="h-11">
              <SelectValue placeholder="Choose a PDF document" />
            </SelectTrigger>
            <SelectContent>
              {pdfDocuments.length === 0 ? (
                <div className="p-4 text-sm text-slate-500 text-center">No PDF documents available</div>
              ) : (
                pdfDocuments.map(doc => (
                  <SelectItem key={doc.id} value={doc.id}>{doc.title}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {selectedDocId && (() => {
          const doc = pdfDocuments.find(d => d.id === selectedDocId);
          if (!doc?.file_url) return null;
          return (
            <>
              <FaxOCRExtractor fileUrl={doc.file_url} />

              {/* Annotate button */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAnnotator(true)}
                  className="gap-2 text-indigo-700 border-indigo-300 hover:bg-indigo-50"
                >
                  <PenLine className="w-4 h-4" />
                  Annotate / Sign / Date PDF
                </Button>
                {annotatedUrl && (
                  <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
                    <CheckCircle className="w-3 h-3" /> Annotated
                    <button onClick={() => setAnnotatedUrl(null)} className="ml-1 hover:text-red-600">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                )}
              </div>

              {showAnnotator && (
                <PDFAnnotator
                  pdfUrl={annotatedUrl || doc.file_url}
                  onAnnotatedReady={(url) => { setAnnotatedUrl(url); setShowAnnotator(false); }}
                  onClose={() => setShowAnnotator(false)}
                />
              )}
            </>
          );
        })()}

        <div className="space-y-2">
          <Label className="text-sm font-semibold text-slate-700">Recipient Fax Number</Label>
          <Input
            type="tel"
            placeholder="+1234567890"
            value={toNumber}
            onChange={(e) => { setToNumber(e.target.value); setToName(""); }}
            className="h-11"
          />
          <FaxAddressBook onSelectContact={(c) => { setToNumber(c.fax_number); setToName(c.name || ""); }} />
        </div>

        <FaxSignaturePanel onSignatureReady={setSignatureDataUrl} />

        <FaxCoverSheetGenerator
          patientId={patientId}
          documentId={selectedDocId || undefined}
          recipientNumber={toNumber}
          recipientName={toName || undefined}
          pageCount={1}
          onCoverSheetReady={(url) => setCoverSheetUrl(url)}
        />

        <Button onClick={handleSendFax} disabled={isSending || !selectedDocId || !toNumber.trim()} className="w-full bg-indigo-600 hover:bg-indigo-700 h-12 text-base font-semibold shadow-md">
          {isSending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
          {isSending ? "Sending..." : "Send Fax"}
        </Button>
      </CardContent>
    </Card>
  );
}