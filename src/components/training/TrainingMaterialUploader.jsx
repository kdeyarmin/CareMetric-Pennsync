import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileText, Video, File, CheckCircle2, X } from "lucide-react";
import { validateFileUpload } from "@/components/utils/security";

export default function TrainingMaterialUploader({ _moduleId, existingContent, onUploadComplete }) {
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState(existingContent || []);
  const [error, setError] = useState(null);

  const handleFileUpload = async (file, fileType) => {
    // Validate type + size before uploading (the picker's accept is only a hint).
    const check = validateFileUpload(file, {
      maxSize: 200 * 1024 * 1024,
      allowedTypes: [
        'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
        'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ],
      allowedExtensions: ['.mp4', '.webm', '.mov', '.avi', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.ppt', '.pptx'],
    });
    if (!check.valid) { setError(check.error); return; }

    setUploading(true);
    setError(null);

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      const fileData = {
        url: file_url,
        name: file.name,
        type: fileType,
        size: file.size,
        uploaded_at: new Date().toISOString()
      };

      const updated = [...uploadedFiles, fileData];
      setUploadedFiles(updated);
      onUploadComplete?.(updated);
    } catch (err) {
      console.error('Upload failed:', err);
      setError('Upload failed. Please try again.');
    }

    setUploading(false);
  };

  const handleRemoveFile = (index) => {
    const updated = uploadedFiles.filter((_, i) => i !== index);
    setUploadedFiles(updated);
    onUploadComplete?.(updated);
  };

  const getFileIcon = (type) => {
    if (type === 'video') return <Video className="w-5 h-5 text-navy-600" />;
    if (type === 'document') return <FileText className="w-5 h-5 text-blue-600" />;
    return <File className="w-5 h-5 text-slate-600" />;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Upload className="w-4 h-4" />
          Training Materials
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-sm text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {/* Upload Areas */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Video Upload */}
          <div className="border-2 border-dashed border-navy-300 rounded-lg p-4 text-center hover:bg-navy-50 transition-colors">
            <input
              type="file"
              id="video-upload"
              className="hidden"
              accept="video/*"
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) handleFileUpload(file, 'video');
              }}
              disabled={uploading}
            />
            <label htmlFor="video-upload" className="cursor-pointer">
              <Video className="w-10 h-10 text-navy-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-900">Upload Video</p>
              <p className="text-xs text-slate-500 mt-1">MP4, WebM, etc.</p>
            </label>
          </div>

          {/* Document Upload */}
          <div className="border-2 border-dashed border-blue-300 rounded-lg p-4 text-center hover:bg-blue-50 transition-colors">
            <input
              type="file"
              id="document-upload"
              className="hidden"
              accept=".pdf,.doc,.docx,.ppt,.pptx"
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) handleFileUpload(file, 'document');
              }}
              disabled={uploading}
            />
            <label htmlFor="document-upload" className="cursor-pointer">
              <FileText className="w-10 h-10 text-blue-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-900">Upload Document</p>
              <p className="text-xs text-slate-500 mt-1">PDF, DOC, PPT, etc.</p>
            </label>
          </div>
        </div>

        {uploading && (
          <div className="text-center py-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2" />
            <p className="text-sm text-slate-600">Uploading...</p>
          </div>
        )}

        {/* Uploaded Files List */}
        {uploadedFiles.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-slate-500">Uploaded Materials ({uploadedFiles.length})</Label>
            {uploadedFiles.map((file, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {getFileIcon(file.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{file.name}</p>
                    <p className="text-xs text-slate-500">
                      {file.type} • {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveFile(idx)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}