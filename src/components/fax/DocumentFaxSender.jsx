import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { getAuthorizedDocument } from '@/functions/getAuthorizedDocument';
import { useAuthorizedDocuments } from '@/hooks/useAuthorizedDocuments';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { sendFax } from "@/functions/sendFax";
import FaxAddressBook from "./FaxAddressBook";
import FaxOCRExtractor from "./FaxOCRExtractor";
import FaxCoverSheetGenerator from "./FaxCoverSheetGenerator";

export default function DocumentFaxSender({ patientId, prefilledData }) {
  const [selectedDocId, setSelectedDocId] = useState("");
  const [toNumber, setToNumber] = useState(prefilledData?.recipient_fax_number || "");
  const [toName, setToName] = useState("");

  React.useEffect(() => {
    if (prefilledData?.recipient_fax_number) setToNumber(prefilledData.recipient_fax_number);
  }, [prefilledData]);
  const [isSending, setIsSending] = useState(false);
  const [coverSheetUrl, setCoverSheetUrl] = useState(null);
  const [authorizedFileUrl, setAuthorizedFileUrl] = useState(null);
  const [isAuthorizingDocument, setIsAuthorizingDocument] = useState(false);
  const authorizationRequestRef = React.useRef(0);

  const documentQuery = useAuthorizedDocuments({ patientId: patientId || null });
  const documents = documentQuery.data;
  const agencyId = documentQuery.tenantScope?.agency_id || null;

  React.useEffect(() => {
    if (documentQuery.isSuccess && agencyId) return;
    authorizationRequestRef.current += 1;
    setSelectedDocId('');
    setAuthorizedFileUrl(null);
    setCoverSheetUrl(null);
  }, [agencyId, documentQuery.isSuccess]);

  React.useEffect(() => {
    if (!authorizedFileUrl) return undefined;
    const timeout = window.setTimeout(() => setAuthorizedFileUrl(null), 55_000);
    return () => window.clearTimeout(timeout);
  }, [authorizedFileUrl]);

  const pdfDocuments = documents.filter(doc =>
    doc.file_type?.includes('pdf') || doc.file_name?.toLowerCase().endsWith('.pdf')
  );

  const authorizeSelectedDocument = async (documentId) => {
    const requestNumber = authorizationRequestRef.current + 1;
    authorizationRequestRef.current = requestNumber;
    setSelectedDocId(documentId);
    setCoverSheetUrl(null);
    setAuthorizedFileUrl(null);
    if (!documentId || !agencyId) return;

    setIsAuthorizingDocument(true);
    try {
      const result = await getAuthorizedDocument({
        agencyId,
        documentId,
        purpose: 'download',
      });
      if (authorizationRequestRef.current === requestNumber) {
        setAuthorizedFileUrl(result.delivery.download_url);
      }
    } catch {
      if (authorizationRequestRef.current === requestNumber) {
        toast.error('Document access could not be authorized');
      }
    } finally {
      if (authorizationRequestRef.current === requestNumber) {
        setIsAuthorizingDocument(false);
      }
    }
  };

  const handleSendFax = async () => {
    if (!selectedDocId || !toNumber.trim()) {
      toast.error("Please select a document and enter a recipient number");
      return;
    }
    const doc = pdfDocuments.find(d => d.id === selectedDocId);
    if (!doc) return toast.error("Document not found");

    setIsSending(true);
    try {
      // Signed URLs are intentionally short-lived, so refresh the authorized
      // original at send time.
      const authorized = await getAuthorizedDocument({
        agencyId,
        documentId: doc.id,
        purpose: 'download',
      });
      let fileUrl = authorized.delivery.download_url;
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
      setCoverSheetUrl(null);
      setAuthorizedFileUrl(null);
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
            onValueChange={authorizeSelectedDocument}
            disabled={documentQuery.isLoading || documentQuery.isError}
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
          if (isAuthorizingDocument) {
            return <p className="text-sm text-slate-500">Authorizing private document...</p>;
          }
          if (!authorizedFileUrl) return null;
          return (
            <>
              <FaxOCRExtractor fileUrl={authorizedFileUrl} />

              <div
                role="status"
                className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">Secure PDF annotation unavailable</p>
                  <p className="mt-1 text-amber-800">
                    Annotation is paused until PDFs use a self-hosted, authority-bound renderer.
                    You can still fax the original authorized document.
                  </p>
                </div>
              </div>
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

        <FaxCoverSheetGenerator
          patientId={patientId}
          recipientNumber={toNumber}
          recipientName={toName || undefined}
          pageCount={1}
          onCoverSheetReady={(url) => setCoverSheetUrl(url)}
        />

        <Button onClick={handleSendFax} disabled={isSending || !selectedDocId || !toNumber.trim() || !agencyId} className="w-full bg-indigo-600 hover:bg-indigo-700 h-12 text-base font-semibold shadow-md">
          {isSending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
          {isSending ? "Sending..." : "Send Fax"}
        </Button>
      </CardContent>
    </Card>
  );
}
