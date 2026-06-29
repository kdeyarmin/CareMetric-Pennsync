import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  UserX,
  FolderArchive
} from "lucide-react";
import { toast } from "sonner";

export default function DischargeReportUploader() {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const queryClient = useQueryClient();

  const handleFileUpload = async (event) => {
    const selectedFile = event.target.files[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setIsProcessing(true);
    setResults(null);

    try {
      toast.info('Uploading discharge report...');
      
      // Upload file
      const uploadResponse = await base44.integrations.Core.UploadFile({ 
        file: selectedFile 
      });
      const fileUrl = uploadResponse.file_url;

      toast.info('Processing discharge report...');
      
      // Process discharge report
      const response = await base44.functions.invoke('processDischargeReport', { 
        file_url: fileUrl 
      });
      
      const processResults = response.data || response;

      if (processResults.success) {
        setResults(processResults);
        toast.success(`Processed ${processResults.discharged_count} patient discharge(s)`);
        queryClient.invalidateQueries({ queryKey: ['patients'] });
        queryClient.invalidateQueries({ queryKey: ['allPatients'] });
      } else {
        throw new Error(processResults.error || 'Failed to process discharge report');
      }
    } catch (error) {
      console.error('Error processing discharge report:', error);
      toast.error('Error: ' + (error.message || 'Failed to process file'));
    }
    
    setIsProcessing(false);
  };

  return (
    <Card className="border-2 border-orange-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderArchive className="w-5 h-5 text-orange-600" />
          Discharge Report Processor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-orange-50 border-orange-300">
          <AlertCircle className="w-4 h-4 text-orange-600" />
          <AlertDescription className="text-orange-900">
            <p className="font-semibold mb-1">Automated Discharge Processing</p>
            <p className="text-sm">
              Upload a discharge report (PDF, CSV, or image). The system will identify discharged patients 
              and automatically close their files, update their status, and archive their records.
            </p>
          </AlertDescription>
        </Alert>

        {/* File Upload */}
        <div className="border-2 border-dashed border-orange-300 rounded-lg p-8 text-center hover:border-orange-500 transition-colors bg-orange-50/30">
          <input
            type="file"
            accept=".pdf,.csv,.png,.jpg,.jpeg"
            onChange={handleFileUpload}
            className="hidden"
            id="discharge-report-upload"
            disabled={isProcessing}
          />
          <label htmlFor="discharge-report-upload" className="cursor-pointer">
            <Upload className="w-12 h-12 mx-auto mb-3 text-orange-400" />
            <p className="text-sm font-medium text-slate-700 mb-1">
              {file ? file.name : 'Click to upload discharge report'}
            </p>
            <p className="text-xs text-slate-500">
              PDF, CSV, PNG, or JPG format accepted
            </p>
          </label>
        </div>

        {/* Processing Indicator */}
        {isProcessing && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-orange-600" />
              <span className="text-sm text-slate-600 font-medium">Processing discharge report...</span>
            </div>
            <Progress value={50} className="h-2" />
            <p className="text-xs text-slate-500">Extracting patient data and updating records...</p>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs text-blue-600 font-semibold mb-1">Patients Found</p>
                <p className="text-2xl font-bold text-blue-700">{results.total_processed}</p>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                <p className="text-xs text-orange-600 font-semibold mb-1">Discharged</p>
                <p className="text-2xl font-bold text-orange-700">{results.discharged_count}</p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <p className="text-xs text-green-600 font-semibold mb-1">Files Closed</p>
                <p className="text-2xl font-bold text-green-700">{results.files_closed}</p>
              </div>
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <p className="text-xs text-red-600 font-semibold mb-1">Not Found</p>
                <p className="text-2xl font-bold text-red-700">{results.not_found}</p>
              </div>
            </div>

            {/* Success Alert */}
            {results.discharged_count > 0 && (
              <Alert className="bg-green-50 border-green-300">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  <strong>✅ Discharge Processing Complete!</strong>
                  <div className="mt-2 text-sm">
                    Successfully discharged {results.discharged_count} patient(s) and closed their active files.
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Discharged Patients List */}
            {results.discharged_patients && results.discharged_patients.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <UserX className="w-5 h-5 text-orange-600" />
                  Discharged Patients ({results.discharged_patients.length})
                </h3>
                <ScrollArea className="h-64 border rounded-lg">
                  <div className="p-4 space-y-2">
                    {results.discharged_patients.map((patient, idx) => (
                      <div key={idx} className="border rounded-lg p-3 bg-orange-50 border-orange-200">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <UserX className="w-4 h-4 text-orange-600" />
                              <span className="font-medium text-orange-900">{patient.name}</span>
                            </div>
                            <p className="text-xs text-slate-600 mt-1">
                              MRN: {patient.mrn} • Discharge Date: {patient.discharge_date || 'N/A'}
                            </p>
                            {patient.discharge_reason && (
                              <p className="text-xs text-slate-700 mt-1 italic">
                                Reason: {patient.discharge_reason}
                              </p>
                            )}
                          </div>
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Not Found Patients */}
            {results.not_found_patients && results.not_found_patients.length > 0 && (
              <div>
                <h3 className="font-semibold text-red-900 mb-3 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Patients Not Found ({results.not_found_patients.length})
                </h3>
                <ScrollArea className="h-48 border rounded-lg border-red-300 bg-red-50">
                  <div className="p-4 space-y-2">
                    {results.not_found_patients.map((patient, idx) => (
                      <div key={idx} className="text-sm text-red-800">
                        • {patient.name} {patient.mrn && `(MRN: ${patient.mrn})`}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Errors */}
            {results.errors && results.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  <strong>Errors encountered:</strong>
                  <ul className="mt-2 text-sm list-disc pl-4">
                    {results.errors.map((error, idx) => (
                      <li key={idx}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Reset Button */}
            <Button
              onClick={() => {
                setFile(null);
                setResults(null);
              }}
              variant="outline"
              className="w-full"
            >
              Upload Another Report
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}