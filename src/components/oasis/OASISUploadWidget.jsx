import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";

export default function OASISUploadWidget() {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile);
      setError(null);
      setUploadComplete(false);
    } else {
      setError("Please select a valid PDF file.");
      setFile(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setError("File size exceeds 10MB. Please upload a smaller file.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(20);
    setError(null);

    try {
      // Upload file
      const uploadResult = await base44.integrations.Core.UploadFile({ file });
      const file_url = uploadResult.file_url;
      setUploadProgress(50);

      // Create OASIS upload record
      await base44.entities.OASISUpload.create({
        file_url: file_url,
        file_name: file.name,
        status: 'uploaded',
        patient_name: 'Pending Analysis'
      });

      setUploadProgress(100);
      setUploadComplete(true);
      
      // Reset after 3 seconds
      setTimeout(() => {
        setFile(null);
        setUploadComplete(false);
        setUploadProgress(0);
      }, 3000);

    } catch (err) {
      console.error("Upload error:", err);
      setError("Failed to upload file. Please try again.");
    }

    setIsUploading(false);
  };

  return (
    <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Upload className="w-5 h-5 text-blue-600" />
          Quick OASIS Upload
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors bg-white">
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            className="hidden"
            id="quick-oasis-upload"
          />
          <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600 mb-2">
            {file ? file.name : "No file selected"}
          </p>
          <p className="text-xs text-slate-400 mb-4">Upload OASIS PDF for analysis</p>
          <Button 
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => document.getElementById('quick-oasis-upload').click()}
          >
            <Upload className="w-4 h-4 mr-2" />
            Choose PDF File
          </Button>
        </div>

        {file && !uploadComplete && (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium">{file.name}</span>
                <Badge variant="outline" className="text-xs">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </Badge>
              </div>
            </div>
            <Button
              onClick={handleUpload}
              disabled={isUploading}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload & Analyze
                </>
              )}
            </Button>
          </div>
        )}

        {isUploading && (
          <div>
            <Progress value={uploadProgress} className="h-2" />
            <p className="text-xs text-slate-500 mt-2 text-center">
              Processing OASIS document...
            </p>
          </div>
        )}

        {uploadComplete && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Upload successful! Go to the OASIS Analyzer to view full analysis.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        <div className="pt-2 border-t">
          <Link to={createPageUrl("SmartOASISAssessment")}>
            <Button variant="outline" size="sm" className="w-full">
              <ExternalLink className="w-4 h-4 mr-2" />
              Go to Full OASIS Analyzer
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}