import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileText, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function OCRDocumentExtractor({ onDataExtracted }) {
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [error, setError] = useState(null);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload a PDF or image file (JPG, PNG)');
      return;
    }

    setUploading(true);
    setError(null);
    setExtractedData(null);

    try {
      // Step 1: Upload file
      toast.info('Uploading document...');
      const uploadResponse = await base44.integrations.Core.UploadFile({ file });
      const fileUrl = uploadResponse.file_url;

      // Step 2: Extract patient data using AI
      setUploading(false);
      setExtracting(true);
      toast.info('Extracting patient information with AI...');

      const extractionResponse = await base44.functions.invoke('extractPatientDataFromDocument', {
        file_url: fileUrl
      });

      const data = extractionResponse?.data;
      if (data?.status === 'success') {
        setExtractedData(data.patient_data);
        toast.success('Patient data extracted successfully!');

        // Auto-populate form
        if (onDataExtracted) {
          onDataExtracted(data.patient_data);
        }
      } else {
        setError(data?.details || 'Failed to extract patient data');
        toast.error('Extraction failed - please try another document or enter manually');
      }
    } catch (err) {
      setError(err.message);
      toast.error(`Error: ${err.message}`);
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  };

  const isProcessing = uploading || extracting;

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-r from-navy-50 to-indigo-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" />
          AI Document Scanner
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-700">
          Upload a referral form, patient record, or insurance card to automatically extract patient information.
        </p>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="relative"
            disabled={isProcessing}
            asChild
          >
            <label className="cursor-pointer">
              {isProcessing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-navy-600 border-t-transparent mr-2" />
                  {uploading ? 'Uploading...' : 'Extracting...'}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Document
                </>
              )}
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileUpload}
                className="hidden"
                disabled={isProcessing}
              />
            </label>
          </Button>
          <span className="text-xs text-slate-500">PDF, JPG, or PNG</span>
        </div>

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900 text-sm">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {extractedData && (
          <Alert className="bg-green-50 border-green-300">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900 text-sm">
              <strong>Data extracted successfully!</strong> Fields have been pre-populated below. Review and edit as needed.
            </AlertDescription>
          </Alert>
        )}

        {extractedData && (
          <div className="bg-white rounded-lg border border-slate-200 p-3">
            <div className="flex items-start gap-2 mb-2">
              <FileText className="w-4 h-4 text-slate-600 mt-0.5" />
              <div className="text-xs text-slate-700 space-y-1">
                <p><strong>Extracted:</strong></p>
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                  {extractedData.first_name && <li>Name: {extractedData.first_name} {extractedData.last_name}</li>}
                  {extractedData.date_of_birth && <li>DOB: {extractedData.date_of_birth}</li>}
                  {extractedData.phone && <li>Phone: {extractedData.phone}</li>}
                  {extractedData.address && <li>Address</li>}
                  {extractedData.insurance_primary?.provider && <li>Insurance: {extractedData.insurance_primary.provider}</li>}
                  {extractedData.primary_diagnosis && <li>Diagnosis: {extractedData.primary_diagnosis}</li>}
                </ul>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}