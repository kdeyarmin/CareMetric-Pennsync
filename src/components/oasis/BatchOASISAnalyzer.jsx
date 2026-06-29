import { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { toCsvRows } from "@/components/admin/csvExport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Trash2,
  Play,
  FolderArchive,
  AlertTriangle,
  BarChart3,
  GitCompare,
  Pause,
  StopCircle,
  FileSpreadsheet,
  Users,
  AlertCircle
} from "lucide-react";
import { processOASISBatch } from "@/functions/processOASISBatch";
import OASISComparisonView from "./OASISComparisonView";

export default function BatchOASISAnalyzer({ onSingleAnalysis, onBatchComplete }) {
  const [files, setFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // Only the setter is needed for UI state; the loop reads cancelledRef instead.
  const [, setIsCancelled] = useState(false);
  // The async processBatch loop closes over state values captured at call time,
  // so toggling isPaused/isCancelled via setState never reaches the running loop.
  // Mirror them into refs the loop can read live.
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const [currentStep, setCurrentStep] = useState('');
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [batchResults, setBatchResults] = useState(null);
  const [overallProgress, setOverallProgress] = useState(0);
  const [error, setError] = useState(null);
  const [showComparison, setShowComparison] = useState(false);
  const [groupBy, setGroupBy] = useState('none'); // none, patient, issue_type, score
  const [processingStartTime, setProcessingStartTime] = useState(null);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState(null);

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
      status: 'pending', // pending, uploading, analyzing, success, error
      progress: 0,
      result: null,
      error: null
    }));

    setFiles(prev => [...prev, ...fileObjects]);
    setError(null);
    setBatchResults(null);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setFiles([]);
    setBatchResults(null);
    setError(null);
    setOverallProgress(0);
  };

  const processBatch = async () => {
    if (files.length === 0) return;

    setIsProcessing(true);
    setIsPaused(false);
    setIsCancelled(false);
    pausedRef.current = false;
    cancelledRef.current = false;
    setError(null);
    setBatchResults(null);
    setOverallProgress(0);
    setProcessingStartTime(Date.now());

    const updatedFiles = [...files];
    const uploadedUrls = [];
    const fileNames = [];

    try {
      // Step 1: Upload all files with pause/cancel support
      setCurrentStep('uploading');
      for (let i = 0; i < files.length; i++) {
        // Check for pause
        while (pausedRef.current && !cancelledRef.current) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Check for cancel
        if (cancelledRef.current) {
          setError('Batch processing cancelled by user');
          break;
        }

        setCurrentFileIndex(i);
        updatedFiles[i] = { ...updatedFiles[i], status: 'uploading', progress: 0 };
        setFiles([...updatedFiles]);

        // Estimate time remaining
        if (i > 0) {
          const elapsed = Date.now() - processingStartTime;
          const avgTimePerFile = elapsed / i;
          const remaining = (files.length - i) * avgTimePerFile;
          setEstimatedTimeRemaining(Math.round(remaining / 1000));
        }

        try {
          const { file_url } = await base44.integrations.Core.UploadFile({ 
            file: files[i].file 
          });
          uploadedUrls.push(file_url);
          fileNames.push(files[i].name);
          
          updatedFiles[i] = { ...updatedFiles[i], status: 'uploaded', progress: 100 };
          setFiles([...updatedFiles]);
        } catch (uploadError) {
          updatedFiles[i] = { 
            ...updatedFiles[i], 
            status: 'error', 
            error: 'Upload failed: ' + uploadError.message 
          };
          setFiles([...updatedFiles]);
        }

        setOverallProgress(Math.round(((i + 1) / files.length) * 30));
      }

      if (cancelledRef.current) {
        setIsProcessing(false);
        return;
      }

      // Step 2: Process batch on server
      setCurrentStep('analyzing');
      
      // Mark all uploaded files as analyzing
      for (let i = 0; i < updatedFiles.length; i++) {
        if (updatedFiles[i].status === 'uploaded') {
          updatedFiles[i] = { ...updatedFiles[i], status: 'analyzing' };
        }
      }
      setFiles([...updatedFiles]);
      setOverallProgress(40);

      const response = await processOASISBatch({
        fileUrls: uploadedUrls,
        fileNames: fileNames
      });

      setOverallProgress(90);

      // Update file statuses based on results
      if (response.data?.results) {
        response.data.results.forEach((result, _idx) => {
          const fileIndex = files.findIndex(f => f.name === result.fileName);
          if (fileIndex !== -1) {
            updatedFiles[fileIndex] = {
              ...updatedFiles[fileIndex],
              status: result.status,
              result: result.analysis || null,
              error: result.error || null
            };
          }
        });
        setFiles([...updatedFiles]);
      }

      setBatchResults(response.data);
      setOverallProgress(100);
      setCurrentStep('complete');
      setEstimatedTimeRemaining(null);

      // Notify parent of completed batch for multi-report comparison
      if (onBatchComplete && response.data?.results) {
        const successfulResults = response.data.results
          .filter(r => r.status === 'success' && r.analysis)
          .map(r => ({
            ...r.analysis,
            fileName: r.fileName,
            pdgm_data: r.analysis?.pdgm_data,
            timestamp: new Date().toISOString()
          }));
        onBatchComplete(successfulResults);
      }

    } catch (err) {
      console.error("Batch processing error:", err);
      setError(err.message || "Failed to process batch. Please try again.");
    }

    setIsProcessing(false);
    setIsPaused(false);
  };

  const handlePause = () => {
    pausedRef.current = true;
    setIsPaused(true);
  };

  const handleResume = () => {
    pausedRef.current = false;
    setIsPaused(false);
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    pausedRef.current = false;
    setIsCancelled(true);
    setIsPaused(false);
  };

  const downloadAllReports = () => {
    if (!batchResults?.zipBase64) return;

    const binaryString = atob(batchResults.zipBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OASIS_Batch_Reports_${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const downloadCSVReport = () => {
    const successfulFiles = files.filter(f => f.status === 'success' && f.result);
    if (successfulFiles.length === 0) return;

    // CSV Headers
    const headers = [
      'File Name',
      'Patient Name',
      'Assessment Date',
      'Assessment Type',
      'Overall Score',
      'Accuracy Score',
      'Compliance Score',
      'Revenue Score',
      'Primary Diagnosis',
      'Clinical Group',
      'Functional Level',
      'Estimated Payment',
      'Critical Issues',
      'Revenue Opportunities',
      'Status'
    ];

    // Generate CSV rows
    const rows = successfulFiles.map(file => {
      const result = file.result;
      const pdgm = result.pdgm_data || {};
      
      return [
        file.name,
        pdgm.patient_info?.name || 'Unknown',
        pdgm.patient_info?.assessment_date || 'N/A',
        pdgm.patient_info?.assessment_type || 'Unknown',
        result.overall_score || 0,
        result.accuracy_score || 0,
        result.compliance_score || 0,
        result.revenue_optimization_score || 0,
        pdgm.primary_diagnosis || 'Not specified',
        pdgm.clinical_group || 'N/A',
        pdgm.functional_level || 'N/A',
        pdgm.estimated_payment || 0,
        result.accuracy_issues?.length || 0,
        result.revenue_tips?.length || 0,
        file.status
      ];
    });

    // Create CSV content (escaping + formula-injection neutralization via toCsvRows)
    const csvContent = toCsvRows([headers, ...rows]);

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OASIS_Batch_Results_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending': return <FileText className="w-4 h-4 text-slate-400" />;
      case 'uploading': return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'uploaded': return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
      case 'analyzing': return <Loader2 className="w-4 h-4 text-navy-500 animate-spin" />;
      case 'success': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <FileText className="w-4 h-4 text-slate-400" />;
    }
  };

  const getStatusBadge = (status) => {
    const variants = {
      pending: "bg-slate-100 text-slate-700",
      uploading: "bg-blue-100 text-blue-700",
      uploaded: "bg-blue-100 text-blue-700",
      analyzing: "bg-navy-100 text-navy-700",
      success: "bg-green-100 text-green-700",
      error: "bg-red-100 text-red-700"
    };
    return variants[status] || "bg-slate-100 text-slate-700";
  };

  const successCount = files.filter(f => f.status === 'success').length;
  const errorCount = files.filter(f => f.status === 'error').length;

  // Group results based on selected criteria
  const getGroupedResults = () => {
    const successfulFiles = files.filter(f => f.status === 'success' && f.result);
    
    if (groupBy === 'none') {
      return [{ label: 'All Results', files: successfulFiles }];
    }
    
    if (groupBy === 'patient') {
      const groups = {};
      successfulFiles.forEach(file => {
        const patientName = file.result?.pdgm_data?.patient_info?.name || 'Unknown Patient';
        if (!groups[patientName]) {
          groups[patientName] = [];
        }
        groups[patientName].push(file);
      });
      return Object.entries(groups).map(([name, files]) => ({ label: name, files }));
    }
    
    if (groupBy === 'issue_type') {
      const groups = {
        'Critical Issues': [],
        'Compliance Concerns': [],
        'Revenue Opportunities': [],
        'Good Quality': []
      };
      
      successfulFiles.forEach(file => {
        const result = file.result;
        if (result.compliance_score < 70 || result.accuracy_score < 70) {
          groups['Critical Issues'].push(file);
        } else if (result.compliance_concerns?.length > 0) {
          groups['Compliance Concerns'].push(file);
        } else if (result.revenue_tips?.length > 0) {
          groups['Revenue Opportunities'].push(file);
        } else {
          groups['Good Quality'].push(file);
        }
      });
      
      return Object.entries(groups)
        .filter(([_, files]) => files.length > 0)
        .map(([name, files]) => ({ label: name, files }));
    }
    
    if (groupBy === 'score') {
      const groups = {
        'Excellent (85-100%)': [],
        'Good (70-84%)': [],
        'Fair (50-69%)': [],
        'Needs Improvement (<50%)': []
      };
      
      successfulFiles.forEach(file => {
        const score = file.result?.overall_score || 0;
        if (score >= 85) groups['Excellent (85-100%)'].push(file);
        else if (score >= 70) groups['Good (70-84%)'].push(file);
        else if (score >= 50) groups['Fair (50-69%)'].push(file);
        else groups['Needs Improvement (<50%)'].push(file);
      });
      
      return Object.entries(groups)
        .filter(([_, files]) => files.length > 0)
        .map(([name, files]) => ({ label: name, files }));
    }
    
    return [{ label: 'All Results', files: successfulFiles }];
  };

  const formatTime = (seconds) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FolderArchive className="w-5 h-5 text-indigo-600" />
          Batch OASIS Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload Zone */}
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-indigo-400 transition-colors">
          <input
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            id="batch-upload"
            disabled={isProcessing}
          />
          <label htmlFor="batch-upload" className={`cursor-pointer ${isProcessing ? 'opacity-50' : ''}`}>
            <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="text-sm text-slate-600 mb-1">
              Click to select multiple OASIS PDFs
            </p>
            <p className="text-xs text-slate-400">
              PDF files only • Select multiple files at once
            </p>
          </label>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                {files.length} document{files.length !== 1 ? 's' : ''} selected
              </span>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearAll}
                disabled={isProcessing}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Clear All
              </Button>
            </div>

            <ScrollArea className="h-48 rounded border">
              <div className="p-2 space-y-2">
                {files.map((file, idx) => (
                  <div 
                    key={idx} 
                    className={`flex items-center justify-between p-2 rounded-lg border ${
                      file.status === 'error' ? 'bg-red-50 border-red-200' :
                      file.status === 'success' ? 'bg-green-50 border-green-200' :
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
                        {file.result && (
                          <p className="text-xs text-green-600">
                            Score: {file.result.overall_score}%
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getStatusBadge(file.status)}>
                        {file.status}
                      </Badge>
                      {!isProcessing && file.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(idx)}
                          className="h-6 w-6 p-0"
                        >
                          <XCircle className="w-4 h-4 text-slate-400" />
                        </Button>
                      )}
                      {file.status === 'success' && file.result && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onSingleAnalysis?.(file.result)}
                          className="h-6 text-xs"
                        >
                          <BarChart3 className="w-3 h-3 mr-1" />
                          View
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Progress */}
        {isProcessing && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">
                {isPaused && '⏸ Paused - '}
                {currentStep === 'uploading' && `Uploading files (${currentFileIndex + 1}/${files.length})...`}
                {currentStep === 'analyzing' && 'Analyzing documents with AI...'}
                {currentStep === 'complete' && 'Processing complete!'}
              </span>
              <span className="font-medium">{overallProgress}%</span>
            </div>
            <Progress value={overallProgress} className="h-2" />
            
            {estimatedTimeRemaining && (
              <div className="text-xs text-slate-500 text-center">
                Estimated time remaining: ~{formatTime(estimatedTimeRemaining)}
              </div>
            )}

            {/* Pause/Resume/Cancel Controls */}
            <div className="flex gap-2 justify-center">
              {!isPaused ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePause}
                  className="text-orange-600 border-orange-300 hover:bg-orange-50"
                >
                  <Pause className="w-4 h-4 mr-1" />
                  Pause
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleResume}
                  className="text-green-600 border-green-300 hover:bg-green-50"
                >
                  <Play className="w-4 h-4 mr-1" />
                  Resume
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancel}
                className="text-red-600 border-red-300 hover:bg-red-50"
              >
                <StopCircle className="w-4 h-4 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Results Summary */}
        {batchResults && (
          <div className="space-y-4">
            <Alert className={successCount > 0 ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}>
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span>
                    <strong>{successCount}</strong> document{successCount !== 1 ? 's' : ''} analyzed successfully
                    {errorCount > 0 && <span className="text-red-600 ml-2">• {errorCount} failed</span>}
                  </span>
                  <div className="flex gap-2">
                    {successCount > 0 && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={downloadCSVReport}
                        className="border-green-300 text-green-700 hover:bg-green-50"
                      >
                        <FileSpreadsheet className="w-4 h-4 mr-1" />
                        Export CSV
                      </Button>
                    )}
                    {successCount >= 2 && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => setShowComparison(!showComparison)} 
                        className="border-navy-300 text-navy-700 hover:bg-navy-50"
                      >
                        <GitCompare className="w-4 h-4 mr-1" />
                        {showComparison ? 'Hide' : 'Compare'}
                      </Button>
                    )}
                    {successCount > 0 && (
                      <Button size="sm" onClick={downloadAllReports} className="bg-green-600 hover:bg-green-700">
                        <Download className="w-4 h-4 mr-1" />
                        Download ZIP
                      </Button>
                    )}
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            {/* Grouping Controls */}
            {successCount > 0 && (
              <Card className="border-blue-200 bg-blue-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-600" />
                    Group Results By
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant={groupBy === 'none' ? 'default' : 'outline'}
                      onClick={() => setGroupBy('none')}
                      className={groupBy === 'none' ? 'bg-blue-600' : ''}
                    >
                      No Grouping
                    </Button>
                    <Button
                      size="sm"
                      variant={groupBy === 'patient' ? 'default' : 'outline'}
                      onClick={() => setGroupBy('patient')}
                      className={groupBy === 'patient' ? 'bg-blue-600' : ''}
                    >
                      <Users className="w-3 h-3 mr-1" />
                      By Patient
                    </Button>
                    <Button
                      size="sm"
                      variant={groupBy === 'issue_type' ? 'default' : 'outline'}
                      onClick={() => setGroupBy('issue_type')}
                      className={groupBy === 'issue_type' ? 'bg-blue-600' : ''}
                    >
                      <AlertCircle className="w-3 h-3 mr-1" />
                      By Issue Type
                    </Button>
                    <Button
                      size="sm"
                      variant={groupBy === 'score' ? 'default' : 'outline'}
                      onClick={() => setGroupBy('score')}
                      className={groupBy === 'score' ? 'bg-blue-600' : ''}
                    >
                      <BarChart3 className="w-3 h-3 mr-1" />
                      By Score Range
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Grouped Results Display */}
            {successCount > 0 && groupBy !== 'none' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Grouped Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {getGroupedResults().map((group, gIdx) => (
                      <div key={gIdx} className="border rounded-lg p-3 bg-slate-50">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-semibold text-slate-900">{group.label}</h3>
                          <Badge className="bg-blue-100 text-blue-800">
                            {group.files.length} document{group.files.length !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          {group.files.map((file, fIdx) => (
                            <div key={fIdx} className="bg-white p-2 rounded border flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{file.name}</p>
                                <div className="flex gap-2 mt-1">
                                  <Badge className="text-xs bg-green-100 text-green-800">
                                    {file.result?.overall_score}%
                                  </Badge>
                                  {file.result?.pdgm_data?.patient_info?.name && (
                                    <Badge variant="outline" className="text-xs">
                                      {file.result.pdgm_data.patient_info.name}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onSingleAnalysis?.(file.result)}
                                className="ml-2"
                              >
                                View
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Comparison View */}
        {showComparison && successCount >= 2 && (
          <OASISComparisonView 
            availableReports={files.filter(f => f.status === 'success')}
            onClose={() => setShowComparison(false)}
          />
        )}

        {/* Error */}
        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {/* Action Button */}
        {files.length > 0 && !batchResults && (
          <Button
            onClick={processBatch}
            disabled={isProcessing || files.length === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing {files.length} Document{files.length !== 1 ? 's' : ''}...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Analyze {files.length} Document{files.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        )}

        {/* Process More */}
        {batchResults && (
          <Button
            onClick={clearAll}
            variant="outline"
            className="w-full"
          >
            Process More Documents
          </Button>
        )}
      </CardContent>
    </Card>
  );
}