import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Upload, File, X } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function TelehealthFileSharing({ visitId, onFileShared }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState([]);

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(prev => [...prev, ...selectedFiles]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadFiles = async () => {
    if (files.length === 0) {
      toast.error("Please select files to upload");
      return;
    }

    setUploading(true);
    try {
      const uploadedFiles = [];

      for (const file of files) {
        const response = await base44.integrations.Core.UploadFile({ file });
        uploadedFiles.push({
          name: file.name,
          url: response.file_url,
          size: file.size,
          type: file.type,
          uploaded_at: new Date().toISOString()
        });
      }

      // Track files in visit
      const visit = await base44.entities.Visit.filter({ id: visitId });
      if (visit[0]) {
        const currentFiles = visit[0].telehealth_shared_files || [];
        await base44.entities.Visit.update(visitId, {
          telehealth_shared_files: [...currentFiles, ...uploadedFiles]
        });
      }

      uploadedFiles.forEach(f => onFileShared(f));
      
      toast.success(`${files.length} file(s) shared successfully`);
      setFiles([]);
      setOpen(false);
    } catch (error) {
      toast.error("Failed to upload files: " + error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="gap-2">
          <Upload className="w-5 h-5" />
          Share Files
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Files with Patient</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <input
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-sm text-gray-600">
                Click to select files or drag and drop
              </p>
              <p className="text-xs text-gray-500 mt-2">
                PDF, images, documents (max 10MB each)
              </p>
            </label>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Selected Files ({files.length})</h4>
              {files.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                  <div className="flex items-center gap-2">
                    <File className="w-4 h-4 text-gray-500" />
                    <span className="text-sm truncate">{file.name}</span>
                    <span className="text-xs text-gray-500">
                      ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeFile(idx)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={uploadFiles} disabled={uploading || files.length === 0}>
              {uploading ? "Uploading..." : `Share ${files.length} File(s)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}