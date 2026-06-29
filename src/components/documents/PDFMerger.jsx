import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Upload, 
  X, 
  ArrowUp, 
  ArrowDown, 
  Combine,
  Loader2,
  FileText
} from "lucide-react";
import { toast } from "sonner";

export default function PDFMerger({ onMergeComplete }) {
  const [files, setFiles] = useState([]);
  const [isMerging, setIsMerging] = useState(false);

  const handleFileUpload = async (e) => {
    const newFiles = Array.from(e.target.files);
    
    const uploadPromises = newFiles.map(async (file) => {
      try {
        const result = await base44.integrations.Core.UploadFile({ file });
        return {
          // Stable id so the reorderable/removable list keys by identity, not array
          // index (index keys tie row state to position and desync after move/remove).
          id: `${file.name}-${file.size}-${result.file_url}`,
          name: file.name,
          url: result.file_url,
          size: file.size
        };
      } catch {
        toast.error(`Failed to upload ${file.name}`);
        return null;
      }
    });

    const uploadedFiles = (await Promise.all(uploadPromises)).filter(Boolean);
    setFiles(prev => [...prev, ...uploadedFiles]);
  };

  const moveFile = (index, direction) => {
    const newFiles = [...files];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (newIndex >= 0 && newIndex < files.length) {
      [newFiles[index], newFiles[newIndex]] = [newFiles[newIndex], newFiles[index]];
      setFiles(newFiles);
    }
  };

  const removeFile = (index) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleMerge = async () => {
    if (files.length < 2) {
      toast.error("Please upload at least 2 PDF files");
      return;
    }

    setIsMerging(true);
    try {
      const response = await base44.functions.invoke('mergePDFs', {
        pdf_urls: files.map(f => f.url)
      });

      toast.success("PDFs merged successfully!");
      if (onMergeComplete) {
        onMergeComplete(response.data.merged_pdf_url);
      }
    } catch (error) {
      console.error("Merge error:", error);
      toast.error(`Failed to merge PDFs: ${error.message}`);
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Combine className="w-5 h-5 text-blue-600" />
          Merge PDF Documents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload Area */}
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
          <Input
            id="pdf-upload"
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileUpload}
            className="hidden"
          />
          <label htmlFor="pdf-upload" className="cursor-pointer">
            <Upload className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-700">
              Click to upload PDF files
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Select multiple files to merge
            </p>
          </label>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">
              Files to merge ({files.length})
            </p>
            {files.map((file, index) => (
              <div
                key={file.id ?? index}
                className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg"
              >
                <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => moveFile(index, 'up')}
                    disabled={index === 0}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => moveFile(index, 'down')}
                    disabled={index === files.length - 1}
                  >
                    <ArrowDown className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFile(index)}
                  >
                    <X className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Merge Button */}
        <Button
          onClick={handleMerge}
          disabled={files.length < 2 || isMerging}
          className="w-full"
          size="lg"
        >
          {isMerging ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Merging PDFs...
            </>
          ) : (
            <>
              <Combine className="w-5 h-5 mr-2" />
              Merge {files.length} PDFs
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}