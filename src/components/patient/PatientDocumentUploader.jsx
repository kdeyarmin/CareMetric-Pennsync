import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Upload, Camera, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function PatientDocumentUploader({ patientId, userEmail, onUploaded }) {
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);

    for (const file of files) {
      const allowed = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp", "image/tiff"];
      if (!allowed.some(t => file.type.startsWith(t.split("/")[0]) || file.type === t)) {
        toast.error(`Unsupported file type: ${file.name}`);
        continue;
      }

      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });

        const doc = await base44.entities.PatientDocument.create({
          patient_id: patientId,
          user_email: userEmail,
          file_url,
          file_name: file.name,
          original_name: file.name,
          file_size: file.size,
          file_type: file.type,
          processing_status: "pending",
          tags: [],
        });

        onUploaded?.(doc);
        toast.success(`Uploaded: ${file.name}`);
      } catch (err) {
        console.error("Upload failed:", err);
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  };

  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        size="sm"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="gap-1.5 bg-blue-600 hover:bg-blue-700"
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        Upload Files
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => cameraRef.current?.click()}
        disabled={uploading}
        className="gap-1.5"
      >
        <Camera className="w-4 h-4" />
        Scan
      </Button>
    </div>
  );
}