import React, { useState, useRef, useLayoutEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, X, Send, Camera } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import FaxAddressBook from "./FaxAddressBook";
import FaxCoverSheetGenerator from "./FaxCoverSheetGenerator";
import {
  createAuthorityBoundMediaOperation,
  detachAuthorityBoundMediaTree,
  loadAuthorityBoundImage,
  readAuthorityBoundDataUrl,
} from '@/lib/authorityBoundMediaProcessing';

export default function PhotoUploadFaxSender({ prefilledData }) {
  const [uploadedImages, setUploadedImages] = useState([]);
  const [toNumber, setToNumber] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [coverSheetUrl, setCoverSheetUrl] = useState(null);
  const [authorityReady, setAuthorityReady] = useState(false);
  const rootRef = useRef(null);
  const fileInputRef = useRef(null);
  const mountedRef = useRef(false);
  const authorityRef = useRef(null);
  const operationsRef = useRef(new Set());
  const fileSelectionRef = useRef(0);
  const queryClient = useQueryClient();

  const authorityIsCurrent = (authority = authorityRef.current) => (
    mountedRef.current
    && authorityRef.current === authority
    && authority?.isCurrent()
  );

  const beginOperation = () => {
    const authority = authorityRef.current;
    if (!authorityIsCurrent(authority)) return null;
    try {
      const operation = createAuthorityBoundMediaOperation(authority.realmLease);
      operationsRef.current.add(operation);
      return operation;
    } catch {
      return null;
    }
  };

  const finishOperation = (operation) => {
    if (!operation) return;
    operationsRef.current.delete(operation);
    operation.dispose();
  };

  useLayoutEffect(() => {
    mountedRef.current = true;
    let authority;
    try {
      authority = createAuthorityBoundMediaOperation();
    } catch {
      setAuthorityReady(false);
      return () => { mountedRef.current = false; };
    }

    const revoke = () => {
      if (authorityRef.current === authority) authorityRef.current = null;
      fileSelectionRef.current += 1;
      for (const operation of operationsRef.current) operation.dispose();
      operationsRef.current.clear();
      detachAuthorityBoundMediaTree(rootRef.current);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!mountedRef.current) return;
      setAuthorityReady(false);
      setUploadedImages([]);
      setToNumber("");
      setIsSending(false);
      setIsProcessing(false);
      setCoverSheetUrl(null);
    };

    authorityRef.current = authority;
    authority.addTeardown(revoke);
    if (authority.isCurrent()) setAuthorityReady(true);
    else revoke();

    return () => {
      mountedRef.current = false;
      if (authorityRef.current === authority) authorityRef.current = null;
      authority.dispose();
      revoke();
    };
  }, []);

  React.useEffect(() => {
    const authority = authorityRef.current;
    if (prefilledData?.recipient_fax_number && authorityIsCurrent(authority)) {
      setToNumber(prefilledData.recipient_fax_number);
    }
  }, [prefilledData]);

  const handleFileSelect = async (e) => {
    const authority = authorityRef.current;
    if (!authorityIsCurrent(authority)) {
      e.target.value = '';
      return;
    }
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const operation = beginOperation();
    if (!operation || !authorityIsCurrent(authority)) {
      e.target.value = '';
      return;
    }
    const selection = ++fileSelectionRef.current;
    setIsProcessing(true);
    try {
      for (const file of files) {
        operation.assertCurrent();
        if (!file.type.startsWith('image/')) {
          if (authorityIsCurrent(authority)) toast.error(`${file.name} is not an image file`);
          continue;
        }
        try {
          operation.assertCurrent();
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          operation.assertCurrent();
          if (!authorityIsCurrent(authority)) break;
          setUploadedImages(prev => (
            authorityIsCurrent(authority)
              ? [...prev, { url: file_url, name: file.name }]
              : prev
          ));
        } catch {
          if (!authorityIsCurrent(authority)) break;
          toast.error(`Failed to upload ${file.name}`);
        }
      }
    } catch {
      // Authority abort is an expected terminal outcome for this selection.
    } finally {
      if (
        authorityIsCurrent(authority)
        && selection === fileSelectionRef.current
      ) setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      finishOperation(operation);
    }
  };

  const generatePDF = async (operation, images) => {
    operation.assertCurrent();
    const pdf = new jsPDF();
    let isFirstPage = true;
    for (const image of images) {
      operation.assertCurrent();
      const response = await fetch(image.url, { signal: operation.signal });
      operation.assertCurrent();
      const blob = await response.blob();
      operation.assertCurrent();
      const dataUrl = await readAuthorityBoundDataUrl(operation, blob);
      operation.assertCurrent();
      // Load the image to read its natural size and aspect-fit it onto the page
      // (centered) instead of stretching it to the full A4, which distorts the
      // faxed document.
      const loadedImage = await loadAuthorityBoundImage(operation, dataUrl);
      operation.assertCurrent();
      if (!isFirstPage) pdf.addPage();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(
        pageWidth / loadedImage.width,
        pageHeight / loadedImage.height,
      );
      const w = loadedImage.width * ratio;
      const h = loadedImage.height * ratio;
      pdf.addImage(dataUrl, 'JPEG', (pageWidth - w) / 2, (pageHeight - h) / 2, w, h);
      isFirstPage = false;
    }
    operation.assertCurrent();
    const pdfBlob = pdf.output('blob');
    const pdfFile = new File([pdfBlob], 'fax-document.pdf', { type: 'application/pdf' });
    operation.assertCurrent();
    const { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });
    operation.assertCurrent();
    return file_url;
  };

  const handleSendFax = async () => {
    const authority = authorityRef.current;
    if (!authorityIsCurrent(authority)) return;
    if (!toNumber.trim()) return toast.error("Please enter a recipient fax number");
    if (uploadedImages.length === 0) return toast.error("Please upload at least one image");
    const operation = beginOperation();
    if (!operation || !authorityIsCurrent(authority)) return;
    const images = uploadedImages.map(image => ({ ...image }));
    const recipientNumber = toNumber;
    const coverSheet = coverSheetUrl;
    setIsSending(true);
    try {
      let pdfUrl = await generatePDF(operation, images);
      operation.assertCurrent();
      if (coverSheet) {
        operation.assertCurrent();
        const merged = await base44.functions.invoke('mergePDFs', {
          pdf_urls: [coverSheet, pdfUrl]
        });
        operation.assertCurrent();
        pdfUrl = merged.data?.merged_pdf_url || pdfUrl;
      }
      operation.assertCurrent();
      const faxRes = await base44.functions.invoke('sendFax', {
        to_number: recipientNumber,
        file_url: pdfUrl,
        document_name: 'Photo Fax'
      });
      operation.assertCurrent();
      const faxData = faxRes?.data ?? faxRes;
      if (faxData?.error) throw new Error(faxData.error);
      if (!authorityIsCurrent(authority)) return;
      toast.success("Fax sent successfully!");
      setUploadedImages([]);
      setToNumber("");
      setCoverSheetUrl(null);
      queryClient.invalidateQueries({ queryKey: ['fax-logs'] });
    } catch (error) {
      if (authorityIsCurrent(authority)) {
        toast.error("Failed to send fax: " + error.message);
      }
    } finally {
      if (authorityIsCurrent(authority)) setIsSending(false);
      finishOperation(operation);
    }
  };

  return (
    <Card ref={rootRef} className="overflow-hidden border-slate-200/80 bg-white/95">
      <CardContent className="pt-6 space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">Photo Fax</h2>
          <p className="text-sm text-slate-500">Upload one or more photos and send them as a clean fax packet.</p>
        </div>

        <div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple disabled={!authorityReady} onChange={handleFileSelect} className="hidden" />
          <Button onClick={() => fileInputRef.current?.click()} disabled={!authorityReady || isProcessing} className="w-full h-14 rounded-2xl border-dashed border-slate-300 bg-slate-50 text-slate-900 hover:bg-slate-100" size="lg" variant="outline">
            {isProcessing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Camera className="w-5 h-5 mr-2" />}
            {isProcessing ? "Uploading..." : "Select Photos"}
          </Button>
        </div>

        {/* Preview */}
        {uploadedImages.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {uploadedImages.map((image, index) => (
              <div key={index} className="relative group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
                <img
                  src={authorityReady ? image.url : undefined}
                  alt={image.name}
                  draggable={false}
                  onContextMenu={(event) => event.preventDefault()}
                  onDragStart={(event) => event.preventDefault()}
                  className="w-full h-24 object-cover"
                />
                <button
                  type="button"
                  disabled={!authorityReady}
                  onClick={() => {
                    const authority = authorityRef.current;
                    if (!authorityIsCurrent(authority)) return;
                    setUploadedImages(prev => (
                      authorityIsCurrent(authority)
                        ? prev.filter((_, imageIndex) => imageIndex !== index)
                        : prev
                    ));
                  }}
                  className="absolute right-2 top-2 rounded-full bg-white/95 p-1 text-slate-600 shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Recipient */}
        <div className="space-y-2">
          <Label>Recipient Fax Number</Label>
          <Input
            type="tel"
            placeholder="+1234567890"
            value={toNumber}
            disabled={!authorityReady}
            onChange={(event) => {
              if (authorityIsCurrent()) setToNumber(event.target.value);
            }}
          />
          <FaxAddressBook onSelectContact={(contact) => {
            if (authorityIsCurrent()) setToNumber(contact.fax_number);
          }} />
        </div>

        <FaxCoverSheetGenerator
          recipientNumber={toNumber}
          pageCount={uploadedImages.length}
          onCoverSheetReady={(url) => {
            if (authorityIsCurrent()) setCoverSheetUrl(url);
          }}
        />

        {/* Send */}
        <Button
          onClick={handleSendFax}
          disabled={!authorityReady || uploadedImages.length === 0 || isSending || !toNumber.trim()}
          className="w-full"
          size="lg"
        >
          {isSending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
          {isSending ? "Sending..." : "Send Fax"}
        </Button>
      </CardContent>
    </Card>
  );
}
