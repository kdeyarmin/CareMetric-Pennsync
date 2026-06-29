import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Upload, Loader2, X, Send, FileText, Image, GripVertical,
  ChevronUp, ChevronDown, Layers, AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import FaxAddressBook from "./FaxAddressBook";
import FaxCoverSheetGenerator from "./FaxCoverSheetGenerator";

export default function BatchFaxSender({ prefilledData }) {
  const [files, setFiles] = useState([]);      // { id, name, type, url, pageCount }
  const [toNumber, setToNumber] = useState(prefilledData?.recipient_fax_number || "");
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [coverSheetUrl, setCoverSheetUrl] = useState(null);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (prefilledData?.recipient_fax_number) setToNumber(prefilledData.recipient_fax_number);
  }, [prefilledData]);

  const totalPages = files.reduce((sum, f) => sum + (f.pageCount || 1), 0);

  const handleFileSelect = async (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setIsUploading(true);

    for (const file of selected) {
      const isImage = file.type.startsWith("image/");
      const isPDF = file.type === "application/pdf";
      if (!isImage && !isPDF) {
        toast.error(`${file.name}: only images and PDFs are supported`);
        continue;
      }
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setFiles(prev => [...prev, {
          id: Date.now() + Math.random(),
          name: file.name,
          type: isImage ? "image" : "pdf",
          url: file_url,
          pageCount: isImage ? 1 : null   // PDFs: unknown, treat as 1 for now
        }]);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (id) => setFiles(prev => prev.filter(f => f.id !== id));

  const moveFile = (index, direction) => {
    setFiles(prev => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const convertImagesToPDF = async (imageFiles) => {
    const pdf = new jsPDF();
    let first = true;
    for (const f of imageFiles) {
      if (!first) pdf.addPage();
      const blob = await (await fetch(f.url)).blob();
      const dataUrl = await new Promise(res => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result);
        reader.readAsDataURL(blob);
      });
      const w = pdf.internal.pageSize.getWidth();
      const h = pdf.internal.pageSize.getHeight();
      pdf.addImage(dataUrl, "JPEG", 0, 0, w, h);
      first = false;
    }
    const pdfBlob = pdf.output("blob");
    const pdfFile = new File([pdfBlob], "images.pdf", { type: "application/pdf" });
    const { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });
    return file_url;
  };

  const handleSend = async () => {
    if (!toNumber.trim()) return toast.error("Please enter a recipient fax number");
    if (files.length === 0) return toast.error("Please add at least one file");
    setIsSending(true);

    try {
      // Separate images and PDFs, preserving order via indices
      const orderedUrls = [];
      let imageBatch = [];

      const flushImages = async () => {
        if (imageBatch.length === 0) return;
        const pdfUrl = await convertImagesToPDF(imageBatch);
        orderedUrls.push(pdfUrl);
        imageBatch = [];
      };

      for (const f of files) {
        if (f.type === "image") {
          imageBatch.push(f);
        } else {
          await flushImages();
          orderedUrls.push(f.url);
        }
      }
      await flushImages();

      // Merge all PDFs into one
      let finalUrl;
      if (orderedUrls.length === 1 && !coverSheetUrl) {
        finalUrl = orderedUrls[0];
      } else {
        const allUrls = coverSheetUrl ? [coverSheetUrl, ...orderedUrls] : orderedUrls;
        const merged = await base44.functions.invoke("mergePDFs", { pdf_urls: allUrls });
        finalUrl = merged.data?.merged_pdf_url || finalUrl;
        if (!finalUrl) throw new Error("Merge failed");
      }

      await base44.functions.invoke("sendFax", {
        to_number: toNumber,
        file_url: finalUrl,
        document_name: `Batch Fax (${files.length} file${files.length > 1 ? "s" : ""})`
      });

      toast.success(`Batch fax sent — ${files.length} file${files.length > 1 ? "s" : ""} merged into one transmission!`);
      setFiles([]);
      setToNumber("");
      setCoverSheetUrl(null);
      queryClient.invalidateQueries({ queryKey: ["fax-logs"] });
    } catch (err) {
      toast.error("Failed to send: " + err.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="shadow-lg">
      <CardContent className="p-6 space-y-5">

        {/* Info banner */}
        <div className="flex items-start gap-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-900">
          <Layers className="w-5 h-5 mt-0.5 flex-shrink-0 text-blue-600" />
          <span>Add multiple photos and PDFs — they'll be <strong>merged into one fax</strong>, saving transmission costs.</span>
        </div>

        {/* Upload button */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            variant="outline"
            className="w-full h-12 border-2 border-dashed hover:border-indigo-400 hover:bg-indigo-50"
          >
            {isUploading
              ? <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              : <Upload className="w-5 h-5 mr-2" />}
            {isUploading ? "Uploading..." : "Add Photos or PDFs"}
          </Button>
        </div>

        {/* File queue */}
        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Files to merge ({files.length})
              </Label>
              <Badge variant="secondary" className="text-xs">
                ~{totalPages + (coverSheetUrl ? 1 : 0)} pages total
              </Badge>
            </div>

            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {files.map((f, idx) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2 bg-slate-50 border rounded-lg px-3 py-2"
                >
                  <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
                  {f.type === "image"
                    ? <Image className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    : <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />}
                  <span className="flex-1 text-sm truncate">{f.name}</span>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {f.type === "image" ? "photo" : "PDF"}
                  </Badge>
                  <div className="flex flex-col">
                    <button onClick={() => moveFile(idx, -1)} disabled={idx === 0} className="text-slate-400 hover:text-slate-600 disabled:opacity-20">
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button onClick={() => moveFile(idx, 1)} disabled={idx === files.length - 1} className="text-slate-400 hover:text-slate-600 disabled:opacity-20">
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                  <button onClick={() => removeFile(f.id)} className="text-red-400 hover:text-red-600 flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {files.length > 1 && (
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Files will be merged in the order shown above
              </p>
            )}
          </div>
        )}

        {/* Recipient */}
        <div className="space-y-2">
          <Label className="text-sm font-semibold text-slate-700">Recipient Fax Number</Label>
          <Input
            type="tel"
            placeholder="+1234567890"
            value={toNumber}
            onChange={(e) => setToNumber(e.target.value)}
            className="h-11"
          />
          <FaxAddressBook onSelectContact={(c) => setToNumber(c.fax_number)} />
        </div>

        <FaxCoverSheetGenerator
          recipientNumber={toNumber}
          pageCount={totalPages}
          onCoverSheetReady={(url) => setCoverSheetUrl(url)}
        />

        {/* Send */}
        <Button
          onClick={handleSend}
          disabled={files.length === 0 || isSending || !toNumber.trim()}
          className="w-full bg-indigo-600 hover:bg-indigo-700 h-12 text-base font-semibold shadow-md"
        >
          {isSending
            ? <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            : <Send className="w-5 h-5 mr-2" />}
          {isSending
            ? "Merging & Sending..."
            : `Send Batch Fax (${files.length} file${files.length !== 1 ? "s" : ""})`}
        </Button>
      </CardContent>
    </Card>
  );
}