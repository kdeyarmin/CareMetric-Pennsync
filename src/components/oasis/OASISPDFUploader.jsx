import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Edit,
  Save,
  Eye,
  FolderOpen
} from "lucide-react";

const OASIS_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    patient_info: {
      type: "object",
      properties: {
        name: { type: "string" },
        dob: { type: "string" },
        medicare_number: { type: "string" },
        soc_date: { type: "string" },
        assessment_date: { type: "string" },
        assessment_type: { type: "string" },
        assessment_reason: { type: "string" }
      }
    },
    m0100_reason_for_assessment: { type: "string" },
    clinical_record_items: {
      type: "object",
      properties: {
        m1021_primary_diagnosis: { type: "string" },
        m1021_icd10_code: { type: "string" },
        m1023_other_diagnoses: { type: "array", items: { type: "object", properties: { code: { type: "string" }, description: { type: "string" } } } },
        m1033_risk_hospitalization: { type: "string" }
      }
    },
    adl_iadl_status: {
      type: "object",
      properties: {
        m1800_grooming: { type: "string" },
        m1810_dress_upper: { type: "string" },
        m1820_dress_lower: { type: "string" },
        m1830_bathing: { type: "string" },
        m1840_toilet_transfer: { type: "string" },
        m1850_transferring: { type: "string" },
        m1860_ambulation: { type: "string" }
      }
    },
    integumentary_status: {
      type: "object",
      properties: {
        m1302_risk_pressure_ulcer: { type: "string" },
        m1306_pressure_ulcer_present: { type: "string" },
        m1330_stasis_ulcer: { type: "string" },
        m1340_surgical_wound: { type: "string" }
      }
    },
    medications: {
      type: "object",
      properties: {
        m2001_drug_regimen_review: { type: "string" },
        m2010_high_risk_drugs: { type: "string" },
        m2020_oral_med_management: { type: "string" }
      }
    },
    gg_functional_abilities: {
      type: "object",
      properties: {
        gg0130_self_care: { type: "object" },
        gg0170_mobility: { type: "object" }
      }
    }
  }
};

export default function OASISPDFUploader({ 
  visitId, 
  _patientId,
  onDataExtracted, 
  initialData = null,
  compact = false 
}) {
  const [files, setFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [extractedData, setExtractedData] = useState(initialData);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingData, setEditingData] = useState(null);
  const [error, setError] = useState(null);

  // Load saved data from localStorage on mount
  useEffect(() => {
    if (visitId && !initialData) {
      const savedData = localStorage.getItem(`oasis_data_${visitId}`);
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          setExtractedData(parsed);
          onDataExtracted?.(parsed);
        } catch (e) {
          console.error("Error loading saved OASIS data:", e);
        }
      }
    }
  }, [visitId, initialData, onDataExtracted]);

  // Save data to localStorage when it changes
  useEffect(() => {
    if (visitId && extractedData) {
      try { localStorage.setItem(`oasis_data_${visitId}`, JSON.stringify(extractedData)); } catch {}
    }
  }, [visitId, extractedData]);

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files).filter(
      f => f.type === "application/pdf"
    );
    
    if (selectedFiles.length === 0) {
      setError("Please select valid PDF files.");
      return;
    }

    const fileObjects = selectedFiles.map(f => ({
      file: f,
      name: f.name,
      size: f.size,
      status: 'pending',
      progress: 0,
      result: null,
      error: null,
      retryCount: 0
    }));

    setFiles(prev => [...prev, ...fileObjects]);
    setError(null);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const processFile = async (fileObj, index, updateFiles) => {
    const maxRetries = 3;
    let attempt = 0;
    let _lastError = null;

    while (attempt < maxRetries) {
      try {
        // Update status to uploading
        updateFiles(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], status: 'uploading', progress: 10 + (attempt * 5) };
          return updated;
        });

        // Upload the file
        const { file_url } = await base44.integrations.Core.UploadFile({ 
          file: fileObj.file 
        });

        updateFiles(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], status: 'extracting', progress: 50 };
          return updated;
        });

        // Extract data
        const extractedResult = await base44.integrations.Core.ExtractDataFromUploadedFile({
          file_url: file_url,
          json_schema: OASIS_EXTRACTION_SCHEMA
        });

        if (extractedResult.status === "success" && extractedResult.output) {
          updateFiles(prev => {
            const updated = [...prev];
            updated[index] = { 
              ...updated[index], 
              status: 'success', 
              progress: 100,
              result: extractedResult.output
            };
            return updated;
          });
          return extractedResult.output;
        } else {
          throw new Error(extractedResult.details || "Extraction failed");
        }
      } catch (err) {
        _lastError = err;
        attempt++;
        
        updateFiles(prev => {
          const updated = [...prev];
          updated[index] = { 
            ...updated[index], 
            retryCount: attempt,
            status: attempt < maxRetries ? 'retrying' : 'error',
            error: attempt < maxRetries 
              ? `Retry ${attempt}/${maxRetries}...` 
              : `Failed after ${maxRetries} attempts: ${err.message}`
          };
          return updated;
        });

        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    return null;
  };

  const processAllFiles = async () => {
    if (files.length === 0) return;

    setIsProcessing(true);
    setError(null);
    setOverallProgress(0);

    const results = [];
    const totalFiles = files.filter(f => f.status !== 'success').length;
    let processedCount = 0;

    for (let i = 0; i < files.length; i++) {
      if (files[i].status === 'success') continue;

      const result = await processFile(files[i], i, setFiles);
      if (result) {
        results.push(result);
      }
      
      processedCount++;
      setOverallProgress(Math.round((processedCount / totalFiles) * 100));
    }

    // Merge all extracted data
    if (results.length > 0) {
      const mergedData = mergeOasisData(results);
      setExtractedData(mergedData);
      onDataExtracted?.(mergedData);
    }

    setIsProcessing(false);
  };

  const mergeOasisData = (dataArray) => {
    if (dataArray.length === 0) return null;
    if (dataArray.length === 1) return dataArray[0];

    // Merge multiple OASIS documents, preferring non-null values
    const merged = JSON.parse(JSON.stringify(dataArray[0]));
    
    for (let i = 1; i < dataArray.length; i++) {
      const data = dataArray[i];
      for (const key in data) {
        if (data[key] && !merged[key]) {
          merged[key] = data[key];
        } else if (typeof data[key] === 'object' && data[key] !== null) {
          merged[key] = { ...merged[key], ...data[key] };
        }
      }
    }

    return merged;
  };

  const retryFile = async (index) => {
    const updatedFiles = [...files];
    updatedFiles[index] = { ...updatedFiles[index], status: 'pending', error: null, retryCount: 0 };
    setFiles(updatedFiles);
    
    setIsProcessing(true);
    const result = await processFile(updatedFiles[index], index, setFiles);
    if (result && extractedData) {
      setExtractedData(mergeOasisData([extractedData, result]));
    } else if (result) {
      setExtractedData(result);
      onDataExtracted?.(result);
    }
    setIsProcessing(false);
  };

  const openEditDialog = () => {
    setEditingData(JSON.parse(JSON.stringify(extractedData)));
    setShowEditDialog(true);
  };

  const saveEditedData = () => {
    setExtractedData(editingData);
    onDataExtracted?.(editingData);
    setShowEditDialog(false);
  };

  const updateEditingField = (path, value) => {
    const newData = { ...editingData };
    const parts = path.split('.');
    let current = newData;
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    
    current[parts[parts.length - 1]] = value;
    setEditingData(newData);
  };

  const clearAllData = () => {
    setFiles([]);
    setExtractedData(null);
    setError(null);
    if (visitId) {
      localStorage.removeItem(`oasis_data_${visitId}`);
    }
    onDataExtracted?.(null);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending': return <FileText className="w-4 h-4 text-slate-400" />;
      case 'uploading': return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'extracting': return <Loader2 className="w-4 h-4 text-navy-500 animate-spin" />;
      case 'retrying': return <RefreshCw className="w-4 h-4 text-orange-500 animate-spin" />;
      case 'success': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <FileText className="w-4 h-4 text-slate-400" />;
    }
  };

  const getStatusBadge = (status) => {
    const variants = {
      pending: "bg-slate-100 text-slate-700",
      uploading: "bg-blue-100 text-blue-700",
      extracting: "bg-navy-100 text-navy-700",
      retrying: "bg-orange-100 text-orange-700",
      success: "bg-green-100 text-green-700",
      error: "bg-red-100 text-red-700"
    };
    return variants[status] || "bg-slate-100 text-slate-700";
  };

  const successCount = files.filter(f => f.status === 'success').length;
  const errorCount = files.filter(f => f.status === 'error').length;

  if (compact && extractedData) {
    return (
      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="font-medium text-green-900">OASIS Data Loaded</span>
            <Badge variant="outline" className="text-xs">
              {extractedData.m0100_reason_for_assessment || 'Assessment'}
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={openEditDialog}>
              <Edit className="w-4 h-4 mr-1" /> Review
            </Button>
            <Button variant="ghost" size="sm" onClick={clearAllData} className="text-red-600">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Edit Dialog */}
        <OASISEditDialog 
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          data={editingData}
          onSave={saveEditedData}
          updateField={updateEditingField}
        />
      </div>
    );
  }

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-blue-600" />
          Upload OASIS Documents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload Zone */}
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
          <input
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            id="oasis-multi-upload"
            disabled={isProcessing}
          />
          <label htmlFor="oasis-multi-upload" className={`cursor-pointer ${isProcessing ? 'opacity-50' : ''}`}>
            <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="text-sm text-slate-600 mb-1">
              Click to select OASIS PDF files
            </p>
            <p className="text-xs text-slate-400">
              Multiple files supported • Auto-retry on failure
            </p>
          </label>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                {files.length} file{files.length !== 1 ? 's' : ''} • 
                {successCount > 0 && <span className="text-green-600 ml-1">{successCount} extracted</span>}
                {errorCount > 0 && <span className="text-red-600 ml-1">{errorCount} failed</span>}
              </span>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearAllData}
                disabled={isProcessing}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Clear All
              </Button>
            </div>

            <ScrollArea className="h-40 rounded border">
              <div className="p-2 space-y-2">
                {files.map((file, idx) => (
                  <div 
                    key={idx} 
                    className={`flex items-center justify-between p-2 rounded-lg border ${
                      file.status === 'error' ? 'bg-red-50 border-red-200' :
                      file.status === 'success' ? 'bg-green-50 border-green-200' :
                      file.status === 'retrying' ? 'bg-orange-50 border-orange-200' :
                      'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {getStatusIcon(file.status)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        {file.error && (
                          <p className="text-xs text-red-600 truncate">{file.error}</p>
                        )}
                        {file.status === 'retrying' && (
                          <p className="text-xs text-orange-600">Retrying... ({file.retryCount}/3)</p>
                        )}
                        {(file.status === 'uploading' || file.status === 'extracting') && (
                          <Progress value={file.progress} className="h-1 mt-1" />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <Badge className={getStatusBadge(file.status)}>
                        {file.status}
                      </Badge>
                      {file.status === 'error' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => retryFile(idx)}
                          disabled={isProcessing}
                          className="h-7 px-2"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </Button>
                      )}
                      {file.status !== 'success' && !isProcessing && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(idx)}
                          className="h-7 px-2 text-slate-400"
                        >
                          <XCircle className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Overall Progress */}
        {isProcessing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Processing files...</span>
              <span className="font-medium">{overallProgress}%</span>
            </div>
            <Progress value={overallProgress} className="h-2" />
          </div>
        )}

        {/* Error Message */}
        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        {files.length > 0 && files.some(f => f.status === 'pending' || f.status === 'error') && (
          <Button
            onClick={processAllFiles}
            disabled={isProcessing}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Extract OASIS Data
              </>
            )}
          </Button>
        )}

        {/* Extracted Data Summary */}
        {extractedData && (
          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="font-semibold text-green-900">OASIS Data Extracted</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={openEditDialog}>
                  <Eye className="w-4 h-4 mr-1" /> Review & Edit
                </Button>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {extractedData.m0100_reason_for_assessment && (
                <div className="bg-white p-2 rounded border">
                  <span className="text-slate-500">Assessment:</span>
                  <span className="ml-1 font-medium">{extractedData.m0100_reason_for_assessment}</span>
                </div>
              )}
              {extractedData.clinical_record_items?.m1021_primary_diagnosis && (
                <div className="bg-white p-2 rounded border">
                  <span className="text-slate-500">Primary Dx:</span>
                  <span className="ml-1 font-medium truncate">{extractedData.clinical_record_items.m1021_primary_diagnosis}</span>
                </div>
              )}
              {extractedData.adl_iadl_status?.m1830_bathing && (
                <div className="bg-white p-2 rounded border">
                  <span className="text-slate-500">M1830:</span>
                  <span className="ml-1 font-medium">{extractedData.adl_iadl_status.m1830_bathing}</span>
                </div>
              )}
              {extractedData.adl_iadl_status?.m1860_ambulation && (
                <div className="bg-white p-2 rounded border">
                  <span className="text-slate-500">M1860:</span>
                  <span className="ml-1 font-medium">{extractedData.adl_iadl_status.m1860_ambulation}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Edit Dialog */}
        <OASISEditDialog 
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          data={editingData}
          onSave={saveEditedData}
          updateField={updateEditingField}
        />
      </CardContent>
    </Card>
  );
}

function OASISEditDialog({ open, onOpenChange, data, onSave, updateField }) {
  if (!data) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="w-5 h-5 text-blue-600" />
            Review & Edit OASIS Data
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Accordion type="multiple" defaultValue={["clinical", "functional"]} className="space-y-2">
            {/* Patient Info */}
            <AccordionItem value="patient" className="border rounded-lg">
              <AccordionTrigger className="px-4 hover:no-underline">
                Patient Information
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Assessment Type (M0100)</Label>
                    <Input 
                      value={data.m0100_reason_for_assessment || ''}
                      onChange={(e) => updateField('m0100_reason_for_assessment', e.target.value)}
                      placeholder="SOC, ROC, Recert, etc."
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Assessment Date</Label>
                    <Input 
                      value={data.patient_info?.assessment_date || ''}
                      onChange={(e) => updateField('patient_info.assessment_date', e.target.value)}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Clinical Record */}
            <AccordionItem value="clinical" className="border rounded-lg">
              <AccordionTrigger className="px-4 hover:no-underline">
                Clinical Record (M1021-M1033)
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">M1021 Primary Diagnosis</Label>
                    <Input 
                      value={data.clinical_record_items?.m1021_primary_diagnosis || ''}
                      onChange={(e) => updateField('clinical_record_items.m1021_primary_diagnosis', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">M1021 ICD-10 Code</Label>
                    <Input 
                      value={data.clinical_record_items?.m1021_icd10_code || ''}
                      onChange={(e) => updateField('clinical_record_items.m1021_icd10_code', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">M1033 Risk Hospitalization</Label>
                    <Input 
                      value={data.clinical_record_items?.m1033_risk_hospitalization || ''}
                      onChange={(e) => updateField('clinical_record_items.m1033_risk_hospitalization', e.target.value)}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Functional Status */}
            <AccordionItem value="functional" className="border rounded-lg">
              <AccordionTrigger className="px-4 hover:no-underline">
                Functional Status (M1800-M1860)
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { key: 'm1800_grooming', label: 'M1800 Grooming (0-3)' },
                    { key: 'm1810_dress_upper', label: 'M1810 Dress Upper (0-3)' },
                    { key: 'm1820_dress_lower', label: 'M1820 Dress Lower (0-3)' },
                    { key: 'm1830_bathing', label: 'M1830 Bathing (0-6)' },
                    { key: 'm1840_toilet_transfer', label: 'M1840 Toilet Transfer (0-4)' },
                    { key: 'm1850_transferring', label: 'M1850 Transferring (0-5)' },
                    { key: 'm1860_ambulation', label: 'M1860 Ambulation (0-6)' }
                  ].map(item => (
                    <div key={item.key}>
                      <Label className="text-xs">{item.label}</Label>
                      <Input 
                        value={data.adl_iadl_status?.[item.key] || ''}
                        onChange={(e) => updateField(`adl_iadl_status.${item.key}`, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Integumentary */}
            <AccordionItem value="integumentary" className="border rounded-lg">
              <AccordionTrigger className="px-4 hover:no-underline">
                Integumentary Status
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">M1302 Risk Pressure Ulcer</Label>
                    <Input 
                      value={data.integumentary_status?.m1302_risk_pressure_ulcer || ''}
                      onChange={(e) => updateField('integumentary_status.m1302_risk_pressure_ulcer', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">M1306 Pressure Ulcer Present</Label>
                    <Input 
                      value={data.integumentary_status?.m1306_pressure_ulcer_present || ''}
                      onChange={(e) => updateField('integumentary_status.m1306_pressure_ulcer_present', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">M1330 Stasis Ulcer</Label>
                    <Input 
                      value={data.integumentary_status?.m1330_stasis_ulcer || ''}
                      onChange={(e) => updateField('integumentary_status.m1330_stasis_ulcer', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">M1340 Surgical Wound</Label>
                    <Input 
                      value={data.integumentary_status?.m1340_surgical_wound || ''}
                      onChange={(e) => updateField('integumentary_status.m1340_surgical_wound', e.target.value)}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Medications */}
            <AccordionItem value="medications" className="border rounded-lg">
              <AccordionTrigger className="px-4 hover:no-underline">
                Medications
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">M2001 Drug Regimen Review</Label>
                    <Input 
                      value={data.medications?.m2001_drug_regimen_review || ''}
                      onChange={(e) => updateField('medications.m2001_drug_regimen_review', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">M2010 High Risk Drugs</Label>
                    <Input 
                      value={data.medications?.m2010_high_risk_drugs || ''}
                      onChange={(e) => updateField('medications.m2010_high_risk_drugs', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">M2020 Oral Med Management</Label>
                    <Input 
                      value={data.medications?.m2020_oral_med_management || ''}
                      onChange={(e) => updateField('medications.m2020_oral_med_management', e.target.value)}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} className="bg-green-600 hover:bg-green-700">
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}