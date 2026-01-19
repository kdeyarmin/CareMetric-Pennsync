import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { History, Upload } from "lucide-react";
import { toast } from "sonner";

export default function DocumentVersionHistory({ document, onVersionUpdated }) {
  const [isUploadingNewVersion, setIsUploadingNewVersion] = useState(false);
  const [changeNotes, setChangeNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);

  const handleUploadNewVersion = async () => {
    if (!selectedFile) {
      toast.error("Please select a file");
      return;
    }

    if (!changeNotes.trim()) {
      toast.error("Please enter change notes");
      return;
    }

    setIsUploadingNewVersion(true);
    try {
      const uploadedFile = await base44.integrations.Core.UploadFile({
        file: selectedFile,
      });

      const user = await base44.auth.me();

      // Store current version in history
      const previousVersions = document.previous_versions || [];
      previousVersions.push({
        version_number: document.version_number,
        file_url: document.file_url,
        uploaded_by: document.uploaded_by,
        uploaded_date: document.created_date,
        change_notes: "Previous version",
      });

      // Update document with new version
      await base44.entities.DocumentRecord.update(document.id, {
        file_url: uploadedFile.file_url,
        file_name: selectedFile.name,
        file_type: selectedFile.type,
        file_size: selectedFile.size,
        version_number: document.version_number + 1,
        previous_versions: previousVersions,
        uploaded_by: user.email,
      });

      toast.success("New version uploaded successfully");
      setSelectedFile(null);
      setChangeNotes("");
      if (onVersionUpdated) {
        onVersionUpdated();
      }
    } catch (error) {
      toast.error("Failed to upload new version");
      console.error(error);
    } finally {
      setIsUploadingNewVersion(false);
    }
  };

  const handleRestoreVersion = async (versionData) => {
    if (!window.confirm("Restore this version? Current version will be preserved.")) {
      return;
    }

    try {
      const currentVersion = {
        version_number: document.version_number,
        file_url: document.file_url,
        uploaded_by: document.uploaded_by,
        uploaded_date: document.created_date,
        change_notes: "Replaced by version restoration",
      };

      const previousVersions = document.previous_versions || [];
      previousVersions.push(currentVersion);

      await base44.entities.DocumentRecord.update(document.id, {
        file_url: versionData.file_url,
        file_name: `${document.file_name} (v${versionData.version_number})`,
        version_number: document.version_number + 1,
        previous_versions: previousVersions,
      });

      toast.success("Version restored successfully");
      if (onVersionUpdated) {
        onVersionUpdated();
      }
    } catch (error) {
      toast.error("Failed to restore version");
      console.error(error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Version History
          </span>
          <span className="text-sm font-normal text-gray-600">
            Current: v{document.version_number}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Dialog>
          <DialogTrigger asChild>
            <Button className="w-full gap-2">
              <Upload className="w-4 h-4" />
              Upload New Version
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload New Version</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files?.[0])}
                  className="hidden"
                  id="version-file-input"
                />
                <label
                  htmlFor="version-file-input"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <Upload className="w-6 h-6 text-gray-400" />
                  <span className="text-sm">Click to upload file</span>
                </label>
              </div>

              {selectedFile && (
                <div className="p-3 bg-gray-50 rounded">
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">
                  Change Notes *
                </label>
                <Textarea
                  placeholder="Describe what changed in this version"
                  value={changeNotes}
                  onChange={(e) => setChangeNotes(e.target.value)}
                  className="h-20"
                />
              </div>

              <Button
                onClick={handleUploadNewVersion}
                disabled={isUploadingNewVersion || !selectedFile}
                className="w-full"
              >
                {isUploadingNewVersion ? "Uploading..." : "Create Version"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Version History Timeline */}
        <div className="space-y-3">
          <div className="p-3 border-l-4 border-blue-500 bg-blue-50 rounded">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-medium">v{document.version_number} (Current)</p>
                <p className="text-xs text-gray-600">
                  {new Date(document.created_date).toLocaleString()}
                </p>
                {document.uploaded_by && (
                  <p className="text-xs text-gray-500">by {document.uploaded_by}</p>
                )}
              </div>
              <span className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded">
                Current
              </span>
            </div>
          </div>

          {document.previous_versions?.map((version, idx) => (
            <div key={idx} className="p-3 border border-gray-200 rounded">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium">v{version.version_number}</p>
                  <p className="text-xs text-gray-600">
                    {new Date(version.uploaded_date).toLocaleString()}
                  </p>
                  {version.change_notes && (
                    <p className="text-xs text-gray-700 mt-1">
                      {version.change_notes}
                    </p>
                  )}
                  {version.uploaded_by && (
                    <p className="text-xs text-gray-500">by {version.uploaded_by}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRestoreVersion(version)}
                >
                  Restore
                </Button>
              </div>
            </div>
          ))}

          {!document.previous_versions || document.previous_versions.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">
              No previous versions
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}