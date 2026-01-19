import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function DocumentUploadManager({ patientId, onUploadComplete }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState([]);
  const [formData, setFormData] = useState({
    document_name: "",
    description: "",
    category: "other",
    tags: "",
  });
  const [isUploading, setIsUploading] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async (fileData) => {
      setIsUploading(true);
      const uploadedFile = await base44.integrations.Core.UploadFile({
        file: fileData.file,
      });

      const docRecord = await base44.entities.DocumentRecord.create({
        document_name: formData.document_name || fileData.file.name,
        description: formData.description,
        category: formData.category,
        file_url: uploadedFile.file_url,
        file_name: fileData.file.name,
        file_type: fileData.file.type,
        file_size: fileData.file.size,
        patient_id: patientId,
        uploaded_by: fileData.userEmail,
        tags: formData.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });

      return docRecord;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document uploaded successfully");
      resetForm();
      setIsUploading(false);
      if (onUploadComplete) {
        onUploadComplete(result);
      }
    },
    onError: (error) => {
      toast.error("Failed to upload document");
      console.error(error);
      setIsUploading(false);
    },
  });

  const resetForm = () => {
    setFiles([]);
    setFormData({
      document_name: "",
      description: "",
      category: "other",
      tags: "",
    });
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(selectedFiles);
    if (selectedFiles.length > 0) {
      setFormData((prev) => ({
        ...prev,
        document_name: selectedFiles[0].name.replace(/\.[^/.]+$/, ""),
      }));
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      toast.error("Please select a file");
      return;
    }

    if (!formData.document_name) {
      toast.error("Please enter a document name");
      return;
    }

    try {
      const user = await base44.auth.me();
      await uploadMutation.mutateAsync({
        file: files[0],
        userEmail: user.email,
      });
    } catch (error) {
      console.error("Upload error:", error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Upload Document
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File Input */}
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
          <input
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            id="file-input"
            accept=".pdf,.doc,.docx,.txt,.xlsx,.jpg,.jpeg,.png"
          />
          <label
            htmlFor="file-input"
            className="cursor-pointer flex flex-col items-center gap-2"
          >
            <Upload className="w-8 h-8 text-gray-400" />
            <span className="text-sm font-medium">
              Click to upload or drag and drop
            </span>
            <span className="text-xs text-gray-500">
              PDF, DOC, DOCX, TXT, XLSX, JPG, PNG (Max 10MB)
            </span>
          </label>
        </div>

        {/* Selected Files */}
        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 bg-gray-50 rounded"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFiles([])}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Form Fields */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">
              Document Name *
            </label>
            <Input
              placeholder="Enter document name"
              value={formData.document_name}
              onChange={(e) =>
                setFormData({ ...formData, document_name: e.target.value })
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Description
            </label>
            <Textarea
              placeholder="Optional description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              className="h-20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <Select
                value={formData.category}
                onValueChange={(value) =>
                  setFormData({ ...formData, category: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consent_form">Consent Form</SelectItem>
                  <SelectItem value="agreement">Agreement</SelectItem>
                  <SelectItem value="medical_record">Medical Record</SelectItem>
                  <SelectItem value="care_plan">Care Plan</SelectItem>
                  <SelectItem value="report">Report</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Tags</label>
              <Input
                placeholder="comma, separated, tags"
                value={formData.tags}
                onChange={(e) =>
                  setFormData({ ...formData, tags: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={resetForm}>
            Clear
          </Button>
          <Button
            onClick={handleUpload}
            disabled={isUploading || files.length === 0}
            className="ml-auto"
          >
            {isUploading ? "Uploading..." : "Upload Document"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}