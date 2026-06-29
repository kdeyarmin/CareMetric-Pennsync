import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, File, X, CheckCircle, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function CustomPDFUploader({ onFileAdded, existingFiles = [] }) {
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState(existingFiles);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      file => file.type === "application/pdf"
    );
    
    if (droppedFiles.length > 0) {
      handleFiles(droppedFiles);
    } else {
      toast.error("Please upload PDF files only");
    }
  };

  const handleChange = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    handleFiles(selectedFiles);
  };

  const handleFiles = async (filesToProcess) => {
    setUploading(true);
    
    for (const file of filesToProcess) {
      try {
        const fileData = await base44.integrations.Core.UploadFile({ file });
        
        const newFile = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          size: file.size,
          url: fileData.file_url,
          uploadedAt: new Date().toISOString(),
          status: "ready"
        };
        
        setFiles(prev => [...prev, newFile]);
        onFileAdded(newFile);
        toast.success(`${file.name} uploaded successfully`);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    
    setUploading(false);
  };

  const removeFile = (fileId) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Custom PDFs</h3>
        <p className="text-sm text-slate-600">Upload additional documents to include in the package</p>
      </div>

      {/* Upload Area */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`relative rounded-lg border-2 border-dashed transition-all ${
          dragActive
            ? "border-indigo-500 bg-indigo-50"
            : "border-slate-300 bg-slate-50"
        } p-6 sm:p-8`}
      >
        <input
          type="file"
          multiple
          accept=".pdf"
          onChange={handleChange}
          disabled={uploading}
          className="hidden"
          id="pdf-upload"
        />
        
        <label
          htmlFor="pdf-upload"
          className="flex flex-col items-center justify-center cursor-pointer"
        >
          <Upload className="w-8 h-8 sm:w-10 sm:h-10 text-slate-400 mb-2" />
          <p className="text-sm sm:text-base font-medium text-slate-700 text-center">
            Drag and drop PDFs here
          </p>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">or click to browse</p>
        </label>

        <Button
          variant="outline"
          size="sm"
          className="w-full mt-4 text-xs sm:text-sm"
          disabled={uploading}
          onClick={() => document.getElementById("pdf-upload").click()}
        >
          {uploading ? "Uploading..." : "Select PDFs"}
        </Button>
      </div>

      {/* Uploaded Files List */}
      {files.length > 0 && (
        <Card className="p-4">
          <div className="space-y-2">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg gap-2"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <File className="w-4 h-4 text-red-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                </div>
                <button
                  onClick={() => removeFile(file.id)}
                  className="p-1 hover:bg-slate-200 rounded text-slate-600 flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* File Info */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <p className="text-xs sm:text-sm text-blue-700">
          Uploaded PDFs will be included in the document package and sent to signers along with generated documents.
        </p>
      </div>
    </div>
  );
}