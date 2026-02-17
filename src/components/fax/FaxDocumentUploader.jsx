import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Camera, FileText, X, Loader2, Image, File } from "lucide-react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";

export default function FaxDocumentUploader({ documents, onDocumentsChange }) {
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const uploadFile = async (file) => {
    setUploading(true);
    try {
      // If it's an image, convert to PDF
      if (file.type.startsWith('image/')) {
        const pdfFile = await convertImageToPDF(file);
        const { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });
        onDocumentsChange([...documents, {
          name: file.name.replace(/\.[^.]+$/, '.pdf'),
          url: file_url,
          type: 'pdf',
          originalType: 'image',
          size: pdfFile.size
        }]);
        toast.success("Photo converted to PDF and uploaded");
      } else if (file.type === 'application/pdf') {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        onDocumentsChange([...documents, {
          name: file.name,
          url: file_url,
          type: 'pdf',
          originalType: 'pdf',
          size: file.size
        }]);
        toast.success("PDF uploaded");
      } else {
        toast.error("Please upload a PDF or image file");
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const convertImageToPDF = (imageFile) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          const doc = new jsPDF({
            orientation: img.width > img.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [img.width, img.height]
          });
          doc.addImage(e.target.result, 'JPEG', 0, 0, img.width, img.height);
          const pdfBlob = doc.output('blob');
          const pdfFile = new File([pdfBlob], imageFile.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' });
          resolve(pdfFile);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  };

  const removeDocument = (index) => {
    onDocumentsChange(documents.filter((_, i) => i !== index));
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <Card>
      <CardHeader className="pb-2 p-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Documents ({documents.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        <input ref={fileInputRef} type="file" accept=".pdf,image/*" onChange={handleFileSelect} className="hidden" />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} className="hidden" />

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="h-20 flex-col gap-1.5">
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5 text-blue-600" />}
            <span className="text-xs">Upload File</span>
            <span className="text-[10px] text-slate-400">PDF or Image</span>
          </Button>
          <Button variant="outline" onClick={() => cameraInputRef.current?.click()} disabled={uploading} className="h-20 flex-col gap-1.5">
            <Camera className="w-5 h-5 text-green-600" />
            <span className="text-xs">Take Photo</span>
            <span className="text-[10px] text-slate-400">Auto-converts to PDF</span>
          </Button>
        </div>

        {documents.length > 0 && (
          <div className="space-y-1.5">
            {documents.map((doc, index) => (
              <div key={index} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border">
                {doc.originalType === 'image' ? (
                  <Image className="w-4 h-4 text-green-600 flex-shrink-0" />
                ) : (
                  <File className="w-4 h-4 text-blue-600 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{doc.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500">{formatSize(doc.size)}</span>
                    {doc.originalType === 'image' && (
                      <Badge className="text-[8px] px-1 py-0 bg-green-100 text-green-700">From photo</Badge>
                    )}
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeDocument(index)}>
                  <X className="w-3 h-3 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {documents.length === 0 && (
          <p className="text-xs text-center text-slate-400 py-2">No documents attached yet</p>
        )}
      </CardContent>
    </Card>
  );
}