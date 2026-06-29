import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Upload, FileImage, Scan, CheckCircle2, AlertCircle, FileText, Camera } from "lucide-react";
import { toast } from 'sonner';

export default function DocumentOCRImporter({ onPatientExtracted }) {
  const [files, setFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [errors, setErrors] = useState([]);

  const patientSchema = {
    type: "object",
    properties: {
      first_name: { type: "string" },
      middle_name: { type: "string" },
      last_name: { type: "string" },
      date_of_birth: { type: "string" },
      medical_record_number: { type: "string" },
      phone: { type: "string" },
      email: { type: "string" },
      address: { type: "string" },
      primary_diagnosis: { type: "string" },
      secondary_diagnoses: { type: "array", items: { type: "string" } },
      physician_name: { type: "string" },
      physician_phone: { type: "string" },
      allergies: { type: "string" },
      emergency_contact_name: { type: "string" },
      emergency_contact_phone: { type: "string" },
      emergency_contact_relationship: { type: "string" },
      payor: { type: "string" },
      admission_date: { type: "string" },
      care_type: { type: "string" },
      status: { type: "string" }
    }
  };

  const handleFileUpload = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    const validFiles = selectedFiles.filter(file => 
      file.type.includes('image') || file.type.includes('pdf')
    );
    
    if (validFiles.length !== selectedFiles.length) {
      toast.error('Only images (JPG, PNG) and PDF files are supported');
    }
    
    setFiles(validFiles);
    setResults([]);
    setErrors([]);
  };

  const processDocuments = async () => {
    if (files.length === 0) {
      toast.error('Please select at least one document to process');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    const extractedPatients = [];
    const processingErrors = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      try {
        // Upload file first
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        
        // Extract patient data using AI OCR
        const extractionResult = await base44.integrations.Core.ExtractDataFromUploadedFile({
          file_url,
          json_schema: patientSchema
        });

        if (extractionResult.status === 'success' && extractionResult.output) {
          const patientData = Array.isArray(extractionResult.output) 
            ? extractionResult.output[0] 
            : extractionResult.output;
          
          extractedPatients.push({
            fileName: file.name,
            data: patientData,
            fileUrl: file_url
          });
        } else {
          processingErrors.push({
            fileName: file.name,
            error: extractionResult.details || 'Failed to extract patient data'
          });
        }
      } catch (error) {
        processingErrors.push({
          fileName: file.name,
          error: error.message || 'Processing failed'
        });
      }

      setProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setResults(extractedPatients);
    setErrors(processingErrors);
    setIsProcessing(false);

    // Send extracted patients to parent
    if (extractedPatients.length > 0 && onPatientExtracted) {
      onPatientExtracted(extractedPatients.map(p => p.data));
    }
  };

  const createPatientRecords = async () => {
    if (results.length === 0) return;

    try {
      // Normalize OCR-extracted enum fields to the Patient schema. The extraction
      // returns free-form strings ("Home Health", "Active", "New", "Skilled
      // Nursing") that don't match the lowercase enums, so Base44 would silently
      // drop them and fall back to defaults. Drop unrecognized values (so the
      // schema default applies) rather than writing an out-of-enum string.
      const CARE_TYPES = ['home_health', 'hospice'];
      const STATUSES = ['active', 'discharged', 'hospitalized', 'merged'];
      const STATUS_SYNONYMS = { new: 'active', admitted: 'active', hospital: 'hospitalized', discharge: 'discharged' };
      const normEnum = (v, allowed, synonyms = {}) => {
        if (!v) return undefined;
        const key = String(v).trim().toLowerCase().replace(/\s+/g, '_');
        const mapped = synonyms[key] ?? key;
        return allowed.includes(mapped) ? mapped : undefined;
      };
      const patientsToCreate = results.map(r => {
        const d = { ...r.data };
        const ct = normEnum(d.care_type, CARE_TYPES);
        if (ct) d.care_type = ct; else delete d.care_type;
        const st = normEnum(d.status, STATUSES, STATUS_SYNONYMS);
        if (st) d.status = st; else delete d.status;
        return d;
      });
      await base44.entities.Patient.bulkCreate(patientsToCreate);
      toast.success(`Successfully created ${results.length} patient record(s)`);
      
      // Reset
      setFiles([]);
      setResults([]);
      setErrors([]);
    } catch (error) {
      toast.error('Failed to create patient records: ' + error.message);
    }
  };

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-gold-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-navy-900">
          <Scan className="w-6 h-6" />
          AI Document Scanner - Extract Patient Data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-blue-50 border-blue-300">
          <Camera className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-sm text-blue-900">
            Upload referral forms, lab reports, or intake documents. AI will automatically extract patient information.
          </AlertDescription>
        </Alert>

        <div>
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={handleFileUpload}
            className="hidden"
            id="ocr-upload"
            disabled={isProcessing}
          />
          <label htmlFor="ocr-upload">
            <span className="sr-only">Select Document(s) to Scan</span>
            <Button
              className="w-full bg-navy-600 hover:bg-navy-700" 
              disabled={isProcessing}
              asChild
            >
              <span>
                <Upload className="w-4 h-4 mr-2" />
                Select Document(s) to Scan
              </span>
            </Button>
          </label>
        </div>

        {files.length > 0 && !isProcessing && results.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">{files.length} file(s) selected:</p>
            <div className="space-y-1">
              {files.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 bg-white rounded border text-sm">
                  <FileImage className="w-4 h-4 text-navy-600" />
                  <span className="flex-1 truncate">{file.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {(file.size / 1024).toFixed(0)} KB
                  </Badge>
                </div>
              ))}
            </div>
            <Button
              onClick={processDocuments}
              className="w-full bg-navy-600 hover:bg-navy-700"
            >
              <Scan className="w-4 h-4 mr-2" />
              Extract Patient Data with AI
            </Button>
          </div>
        )}

        {isProcessing && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">Processing documents...</span>
              <span className="text-sm text-slate-600">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-center text-slate-600 mt-2">
              Using AI to read and extract patient information
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-3">
            <Alert className="bg-green-50 border-green-300">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                Successfully extracted {results.length} patient record(s) from documents
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">Extracted Patient Data:</p>
              {results.map((result, idx) => (
                <Card key={idx} className="border-green-200 bg-green-50">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {result.fileName}
                        </span>
                      </div>
                      <Badge className="bg-green-600 text-white text-xs">Extracted</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 bg-white rounded">
                        <span className="font-medium text-slate-600">Name:</span>
                        <p className="text-slate-900">{result.data.first_name} {result.data.last_name || 'N/A'}</p>
                      </div>
                      {result.data.date_of_birth && (
                        <div className="p-2 bg-white rounded">
                          <span className="font-medium text-slate-600">DOB:</span>
                          <p className="text-slate-900">{result.data.date_of_birth}</p>
                        </div>
                      )}
                      {result.data.medical_record_number && (
                        <div className="p-2 bg-white rounded">
                          <span className="font-medium text-slate-600">MRN:</span>
                          <p className="text-slate-900">{result.data.medical_record_number}</p>
                        </div>
                      )}
                      {result.data.phone && (
                        <div className="p-2 bg-white rounded">
                          <span className="font-medium text-slate-600">Phone:</span>
                          <p className="text-slate-900">{result.data.phone}</p>
                        </div>
                      )}
                      {result.data.primary_diagnosis && (
                        <div className="p-2 bg-white rounded col-span-2">
                          <span className="font-medium text-slate-600">Diagnosis:</span>
                          <p className="text-slate-900">{result.data.primary_diagnosis}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={createPatientRecords}
                className="bg-green-600 hover:bg-green-700"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Create {results.length} Patient{results.length > 1 ? 's' : ''}
              </Button>
              <Button
                onClick={() => {
                  setFiles([]);
                  setResults([]);
                  setErrors([]);
                }}
                variant="outline"
              >
                Clear & Start Over
              </Button>
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>
              <p className="font-semibold mb-2">Failed to process {errors.length} document(s):</p>
              <ul className="text-xs space-y-1">
                {errors.map((err, idx) => (
                  <li key={idx}>• {err.fileName}: {err.error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}