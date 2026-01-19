import React, { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Upload, 
  FileText, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  X,
  Download,
  Copy,
  Save,
  Plus,
  History,
  FileDown,
  Sparkles,
  Brain,
  Zap,
  Search,
  Filter,
  Eye,
  Trash2,
  Calendar,
  User
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import jsPDF from "jspdf";
import ExtractedDataReview from "../components/documents/ExtractedDataReview";
import CarePlanSuggestions from "../components/documents/CarePlanSuggestions";
import ComplianceAuditResults from "../components/documents/ComplianceAuditResults";
import AIPatientSummaryGenerator from "../components/documents/AIPatientSummaryGenerator";
import AutomatedAdminPanel from "../components/admin/AutomatedAdminPanel";
import AnalysisHistoryDetailModal from "../components/documents/AnalysisHistoryDetailModal";
import AdvancedDocumentAnalysis from "../components/documents/AdvancedDocumentAnalysis";
import CDSSWidget from "../components/clinical/CDSSWidget";

export default function DocumentAnalyzer() {
  const [activeTab, setActiveTab] = useState('analyze');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [analysisMode, setAnalysisMode] = useState('comprehensive');
  const [documentType, setDocumentType] = useState('auto');
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showAdminTools, setShowAdminTools] = useState(false);
  
  // History filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPatientFilter, setSelectedPatientFilter] = useState("all");
  const [selectedDocType, setSelectedDocType] = useState("all");
  const [selectedDateRange, setSelectedDateRange] = useState("all");
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState(null);
  const [deletingId, setDeleteId] = useState(null);
  const [selectedForAdvanced, setSelectedForAdvanced] = useState([]);
  const [showAdvancedAnalysis, setShowAdvancedAnalysis] = useState(false);
  const [cdssData, setCDSSData] = useState(null);
  const [loadingCDSS, setLoadingCDSS] = useState(false);
  
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: providerSettings } = useQuery({
    queryKey: ['providerSettings', currentUser?.email],
    queryFn: async () => {
      const settings = await base44.entities.ProviderSettings.filter({ provider_email: currentUser.email });
      return settings[0];
    },
    enabled: !!currentUser?.email
  });

  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  const { data: analysisHistory } = useQuery({
    queryKey: ['documentAnalysisHistory', currentUser?.email],
    queryFn: async () => {
      const history = await base44.entities.DocumentAnalysisHistory?.list('-created_date', 10) || [];
      return history;
    },
    enabled: !!currentUser?.email
  });

  const providerType = currentUser?.credential_type || providerSettings?.provider_type || 'RN';
  const careSetting = providerSettings?.primary_care_setting || 'home_health';

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    processFiles(selectedFiles);
  };

  const processFiles = (selectedFiles) => {
    const pdfFiles = selectedFiles.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    
    if (pdfFiles.length !== selectedFiles.length) {
      toast.error('Only PDF files are allowed');
    }
    
    if (pdfFiles.length > 0) {
      setFiles(prev => [...prev, ...pdfFiles]);
      toast.success(`${pdfFiles.length} file${pdfFiles.length > 1 ? 's' : ''} added`);
    }
  };

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    if (files.length === 0) {
      toast.error('Please upload at least one PDF file');
      return;
    }

    setUploading(true);
    setAnalysis(null);
    setUploadProgress(0);

    try {
      // Upload all files with progress
      const uploadedUrls = [];
      for (let i = 0; i < files.length; i++) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: files[i] });
        uploadedUrls.push(file_url);
        setUploadProgress(Math.round(((i + 1) / files.length) * 50));
      }

      setUploading(false);
      setAnalyzing(true);
      setUploadProgress(50);

      // Get patient data if selected for context
      let patientContext = null;
      if (selectedPatient) {
        const patient = patients.find(p => p.id === selectedPatient);
        patientContext = {
          name: `${patient.first_name} ${patient.last_name}`,
          diagnoses: [patient.primary_diagnosis, ...(patient.secondary_diagnoses || [])].filter(Boolean),
          medications: patient.current_medications || [],
          allergies: patient.allergies,
          baseline_vitals: patient.baseline_vitals
        };
      }

      // Analyze with AI
      const prompt = buildAnalysisPrompt(providerType, careSetting, files.map(f => f.name), analysisMode, documentType, selectedPatient, patientContext);
      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        file_urls: uploadedUrls,
        response_json_schema: getAnalysisSchema(providerType, careSetting, documentType)
      });

      setUploadProgress(100);
      setAnalysis({ ...result, uploadedUrls, fileNames: files.map(f => f.name) });
      
      // Save to history
      try {
        await base44.entities.DocumentAnalysisHistory?.create({
          provider_email: currentUser?.email,
          provider_type: providerType,
          care_setting: careSetting,
          document_type: documentType,
          patient_id: selectedPatient,
          file_count: files.length,
          file_names: files.map(f => f.name),
          analysis_summary: result.executive_summary,
          full_analysis: result
        });
      } catch (e) {
        console.log('History save failed (entity may not exist):', e);
      }
      
      toast.success('Documents analyzed successfully');
    } catch (error) {
      toast.error('Failed to analyze documents: ' + error.message);
    } finally {
      setUploading(false);
      setAnalyzing(false);
      setUploadProgress(0);
    }
  };

  const saveToPatient = async () => {
    if (!selectedPatient || !analysis) {
      toast.error('Please select a patient');
      return;
    }

    try {
      const patient = patients.find(p => p.id === selectedPatient);
      const updatedNotes = (patient.clinical_notes || '') + 
        `\n\n--- Document Analysis (${new Date().toLocaleDateString()}) ---\n` +
        analysis.executive_summary;
      
      await base44.entities.Patient.update(selectedPatient, {
        clinical_notes: updatedNotes
      });

      // Create tasks if action items exist
      if (analysis.action_items && analysis.action_items.length > 0) {
        for (const item of analysis.action_items) {
          await base44.entities.Task.create({
            patient_id: selectedPatient,
            title: item.action,
            priority: item.priority || 'medium',
            source: 'ai_generated',
            ai_reason: 'Generated from document analysis',
            type: 'document'
          });
        }
      }

      toast.success('Analysis saved to patient record and tasks created');
      queryClient.invalidateQueries(['patients']);
    } catch (error) {
      toast.error('Failed to save to patient: ' + error.message);
    }
  };

  const downloadPDF = () => {
    const doc = new jsPDF();
    let yPosition = 20;
    
    doc.setFontSize(18);
    doc.text('Document Analysis Report', 20, yPosition);
    yPosition += 10;
    
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, yPosition);
    doc.text(`Provider: ${providerType}`, 20, yPosition + 5);
    yPosition += 15;
    
    doc.setFontSize(14);
    doc.text('Executive Summary', 20, yPosition);
    yPosition += 7;
    
    doc.setFontSize(10);
    const summaryLines = doc.splitTextToSize(analysis.executive_summary, 170);
    summaryLines.forEach(line => {
      if (yPosition > 280) {
        doc.addPage();
        yPosition = 20;
      }
      doc.text(line, 20, yPosition);
      yPosition += 5;
    });
    
    doc.save('document-analysis.pdf');
    toast.success('PDF downloaded');
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  // Filter history
  const filteredHistory = (analysisHistory || []).filter(item => {
    if (searchQuery && !item.file_names?.some(name => 
      name.toLowerCase().includes(searchQuery.toLowerCase())
    ) && !item.analysis_summary?.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (selectedPatientFilter !== "all" && item.patient_id !== selectedPatientFilter) {
      return false;
    }
    if (selectedDocType !== "all" && item.document_type !== selectedDocType) {
      return false;
    }
    if (selectedDateRange !== "all") {
      const createdDate = new Date(item.created_date);
      const now = new Date();
      const daysAgo = parseInt(selectedDateRange);
      if (createdDate < new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000)) {
        return false;
      }
    }
    return true;
  });

  const handleDeleteHistory = async (analysisId) => {
    setDeleteId(analysisId);
    try {
      await base44.entities.DocumentAnalysisHistory.delete(analysisId);
      toast.success("Analysis deleted");
      queryClient.invalidateQueries({ queryKey: ['documentAnalysisHistory'] });
    } catch (error) {
      toast.error("Failed to delete analysis");
    } finally {
      setDeleteId(null);
    }
  };

  const toggleSelection = (analysisId) => {
    setSelectedForAdvanced(prev => 
      prev.includes(analysisId) 
        ? prev.filter(id => id !== analysisId)
        : [...prev, analysisId]
    );
  };

  const generateCDSSRecommendations = async () => {
    if (!analysis) {
      toast.error('No analysis data available');
      return;
    }

    setLoadingCDSS(true);
    try {
      const response = await base44.functions.invoke('getClinicalDecisionSupport', {
        patient_data: selectedPatient ? patients.find(p => p.id === selectedPatient) : null,
        medications: analysis.extracted_data?.medications || [],
        diagnoses: analysis.extracted_data?.diagnoses || [],
        vitals: analysis.extracted_data?.vitals || {},
        provider_type: providerType,
        care_setting: careSetting
      });

      if (response.cdss_recommendations) {
        setCDSSData(response.cdss_recommendations);
        toast.success('Clinical Decision Support analysis complete');
      }
    } catch (error) {
      toast.error('Failed to generate CDSS recommendations: ' + error.message);
    } finally {
      setLoadingCDSS(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                <Brain className="w-8 h-8 text-indigo-600" />
                Document Analyzer
              </h1>
              <p className="text-slate-600 dark:text-slate-400 mt-1">
                Upload documents for analysis or review past analyses
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-sm">
                {providerType} - {careSetting.replace(/_/g, ' ')}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdminTools(!showAdminTools)}
                className="gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {showAdminTools ? 'Hide' : 'Show'} Admin Tools
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="analyze">Upload & Analyze</TabsTrigger>
              <TabsTrigger value="history">
                <History className="w-4 h-4 mr-2" />
                History
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 dark:bg-indigo-900 rounded-lg">
                    <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {analysisHistory?.length || 0}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Analyses This Month</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                    <Zap className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">~30s</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Avg Analysis Time</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                    <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">AI</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Powered Analysis</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Admin Automation Tools */}
        {showAdminTools && (
          <Card className="border-2 border-purple-200 dark:border-purple-800">
            <CardHeader className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950 dark:to-indigo-950">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                Administrative Automation
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <AutomatedAdminPanel />
            </CardContent>
          </Card>
        )}

        {/* ANALYZE TAB */}
        {activeTab === 'analyze' && (
          <>
            {/* Configuration & Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle>Upload & Configure</CardTitle>
            <CardDescription>
              Configure analysis settings and upload clinical documents
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Configuration Options */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                  Document Type
                </label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto Detect</SelectItem>
                    <SelectItem value="referral">Referral/Admission</SelectItem>
                    <SelectItem value="specialist_report">Specialist Report</SelectItem>
                    <SelectItem value="lab_results">Lab Results</SelectItem>
                    <SelectItem value="imaging">Imaging Report</SelectItem>
                    <SelectItem value="discharge_summary">Discharge Summary</SelectItem>
                    <SelectItem value="consult_note">Consult Note</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                  Analysis Depth
                </label>
                <Select value={analysisMode} onValueChange={setAnalysisMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quick">Quick Scan</SelectItem>
                    <SelectItem value="comprehensive">Comprehensive</SelectItem>
                    <SelectItem value="detailed">Deep Analysis</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                  Link to Patient (Optional)
                </label>
                <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select patient..." />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map(patient => (
                      <SelectItem key={patient.id} value={patient.id}>
                        {patient.first_name} {patient.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Drag & Drop Zone */}
            <div 
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                dragActive 
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950' 
                  : 'border-slate-300 dark:border-slate-600'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <input
                type="file"
                id="file-upload"
                multiple
                accept=".pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <Upload className={`w-12 h-12 mx-auto mb-4 ${dragActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {dragActive ? 'Drop files here' : 'Click to upload or drag and drop'}
                </p>
                <p className="text-xs text-slate-500 mt-1">PDF files only • Multiple files supported</p>
              </label>
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Selected Files ({files.length})
                </p>
                {files.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-slate-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{file.name}</p>
                        <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeFile(index)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Button
                onClick={handleAnalyze}
                disabled={files.length === 0 || uploading || analyzing}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
              >
                {uploading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {analyzing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {uploading ? `Uploading... ${uploadProgress}%` : analyzing ? 'Analyzing with AI...' : 'Analyze Documents'}
              </Button>
              
              {(uploading || analyzing) && (
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div 
                    className="bg-gradient-to-r from-indigo-600 to-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Analysis Results */}
        {analysis && (
          <div className="space-y-4">
            {/* Action Bar */}
            <div className="flex flex-wrap gap-3">
              <Button onClick={downloadPDF} variant="outline">
                <FileDown className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
              <Button onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(analysis, null, 2));
                toast.success('Copied to clipboard');
              }} variant="outline">
                <Copy className="w-4 h-4 mr-2" />
                Copy All
              </Button>
              {selectedPatient && (
                <Button onClick={saveToPatient} variant="default" className="bg-green-600 hover:bg-green-700">
                  <Save className="w-4 h-4 mr-2" />
                  Save Summary to Patient
                </Button>
              )}
            </div>

            {/* Extracted Data Review */}
            {analysis.extracted_data && (
              <ExtractedDataReview 
                extractedData={analysis.extracted_data}
                patientId={selectedPatient}
                onApply={() => {
                  queryClient.invalidateQueries(['patients']);
                }}
              />
            )}

            {/* Care Plan Suggestions */}
            {analysis.care_plan_suggestions && (
              <CarePlanSuggestions
                suggestions={analysis.care_plan_suggestions}
                patientId={selectedPatient}
                onApply={() => {
                  queryClient.invalidateQueries(['carePlans']);
                }}
              />
            )}

            {/* Compliance Audit */}
            {analysis.compliance_audit && (
              <ComplianceAuditResults auditResults={analysis.compliance_audit} />
            )}

            {/* Clinical Decision Support System */}
            <Card className="border-2 border-indigo-200 dark:border-indigo-900">
              <CardHeader className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950 dark:to-blue-950">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-indigo-600" />
                    Clinical Decision Support System
                  </CardTitle>
                  <Button 
                    onClick={generateCDSSRecommendations}
                    disabled={loadingCDSS}
                    className="bg-indigo-600 hover:bg-indigo-700"
                    size="sm"
                  >
                    {loadingCDSS ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                    Generate CDSS
                  </Button>
                </div>
                <CardDescription>
                  AI-powered clinical recommendations, drug interaction screening, and risk assessment
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {cdssData ? (
                  <CDSSWidget 
                    cdssData={cdssData}
                    onRefresh={generateCDSSRecommendations}
                  />
                ) : (
                  <div className="text-center py-6">
                    <Brain className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-600 dark:text-slate-400 text-sm">
                      Click "Generate CDSS" to receive clinical decision support based on the analyzed documents
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* AI Patient Summary Generator */}
            {selectedPatient && (
              <AIPatientSummaryGenerator 
                patientId={selectedPatient}
                documentAnalysis={analysis}
              />
            )}

            <Card className="border-2 border-green-200 dark:border-green-800">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  Analysis Complete
                  <Badge className="ml-auto">{analysisMode}</Badge>
                </CardTitle>
                <CardDescription>
                  Analyzed {files.length} document{files.length > 1 ? 's' : ''} • {documentType === 'auto' ? 'Auto-detected type' : documentType.replace(/_/g, ' ')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                {/* Executive Summary */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">Executive Summary</h3>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(analysis.executive_summary)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
                    {analysis.executive_summary}
                  </p>
                </div>

                {/* Key Findings */}
                {analysis.key_findings && analysis.key_findings.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Key Findings</h3>
                    <div className="grid gap-3">
                      {analysis.key_findings.map((finding, index) => (
                        <div key={index} className="p-3 bg-blue-50 dark:bg-blue-950 border-l-4 border-blue-500 rounded">
                          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">{finding.category}</p>
                          <p className="text-sm text-blue-800 dark:text-blue-200 mt-1">{finding.finding}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Provider-Specific Sections */}
                {renderProviderSpecificSections(analysis, providerType, careSetting, copyToClipboard)}

                {/* Action Items */}
                {analysis.action_items && analysis.action_items.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Recommended Actions</h3>
                    <div className="space-y-2">
                      {analysis.action_items.map((item, index) => (
                        <div key={index} className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950 rounded-lg">
                          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">{item.action}</p>
                            {item.priority && (
                              <Badge className="mt-1" variant={item.priority === 'high' ? 'destructive' : 'secondary'}>
                                {item.priority}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button onClick={() => { setFiles([]); setAnalysis(null); }} variant="outline" className="flex-1">
                <Plus className="w-4 h-4 mr-2" />
                Analyze New Documents
              </Button>
              <Button onClick={downloadPDF} variant="default">
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        )}
          </>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            {/* Search and Filters */}
            <Card>
              <CardContent className="p-4 md:p-6 space-y-4">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search by filename or content..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5 block">
                      Patient
                    </label>
                    <Select value={selectedPatientFilter} onValueChange={setSelectedPatientFilter}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Patients</SelectItem>
                        {patients.map(patient => (
                          <SelectItem key={patient.id} value={patient.id}>
                            {patient.first_name} {patient.last_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5 block">
                      Document Type
                    </label>
                    <Select value={selectedDocType} onValueChange={setSelectedDocType}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="auto">Auto Detect</SelectItem>
                        <SelectItem value="referral">Referral</SelectItem>
                        <SelectItem value="specialist_report">Specialist Report</SelectItem>
                        <SelectItem value="lab_results">Lab Results</SelectItem>
                        <SelectItem value="imaging">Imaging Report</SelectItem>
                        <SelectItem value="discharge_summary">Discharge Summary</SelectItem>
                        <SelectItem value="consult_note">Consult Note</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5 block">
                      Date Range
                    </label>
                    <Select value={selectedDateRange} onValueChange={setSelectedDateRange}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Time</SelectItem>
                        <SelectItem value="7">Last 7 Days</SelectItem>
                        <SelectItem value="30">Last 30 Days</SelectItem>
                        <SelectItem value="90">Last 90 Days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Results */}
            {filteredHistory.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-600 dark:text-slate-400">
                    {analysisHistory?.length === 0 ? "No analyses yet" : "No analyses match your filters"}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-sm">
                    {filteredHistory.length} result{filteredHistory.length === 1 ? '' : 's'}
                  </Badge>
                  {selectedForAdvanced.length > 0 && (
                    <Button 
                      size="sm" 
                      onClick={() => setShowAdvancedAnalysis(true)}
                      className="bg-gradient-to-r from-purple-600 to-indigo-600"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Advanced Analysis ({selectedForAdvanced.length})
                    </Button>
                  )}
                </div>
                
                {filteredHistory.map(item => {
                  const patient = patients.find(p => p.id === item.patient_id);
                  const isSelected = selectedForAdvanced.includes(item.id);
                  return (
                    <Card 
                      key={item.id} 
                      className={`hover:shadow-md transition-all ${
                        isSelected ? 'ring-2 ring-purple-500 bg-purple-50 dark:bg-purple-950' : ''
                      }`}
                    >
                      <CardContent className="p-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelection(item.id)}
                              />
                              <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                                {item.file_names?.[0]?.split('/').pop() || "Analysis"}
                              </h3>
                              <Badge className="text-xs" variant="outline">
                                {item.file_count} file{item.file_count === 1 ? '' : 's'}
                              </Badge>
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-400">
                              <p>{format(new Date(item.created_date), "MMM d, yyyy HH:mm")}</p>
                              {patient && <p>{patient.first_name} {patient.last_name}</p>}
                            </div>
                            {item.analysis_summary && (
                              <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2">
                                {item.analysis_summary}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700"
                              onClick={() => {
                                setSelectedAnalysis(item);
                                setDetailModalOpen(true);
                              }}
                            >
                              <Eye className="w-4 h-4 mr-2" />
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => handleDeleteHistory(item.id)}
                              disabled={deletingId === item.id}
                            >
                              {deletingId === item.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Detail Modal */}
        {selectedAnalysis && (
          <AnalysisHistoryDetailModal
            analysis={selectedAnalysis}
            isOpen={detailModalOpen}
            onClose={() => {
              setDetailModalOpen(false);
              setSelectedAnalysis(null);
            }}
          />
        )}

        {/* Advanced Analysis Modal */}
        {showAdvancedAnalysis && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white dark:bg-slate-900 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
              <div className="sticky top-0 bg-white dark:bg-slate-900 border-b p-4 flex items-center justify-between z-10">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  Advanced Analysis
                </h2>
                <Button variant="outline" onClick={() => setShowAdvancedAnalysis(false)}>
                  Close
                </Button>
              </div>
              <div className="p-6">
                <AdvancedDocumentAnalysis
                  selectedAnalysisIds={selectedForAdvanced}
                  onClose={() => setShowAdvancedAnalysis(false)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildAnalysisPrompt(providerType, careSetting, fileNames, analysisMode, documentType, selectedPatient, patientContext) {
  const depthInstructions = {
    quick: 'Provide a concise summary focusing on critical information only.',
    comprehensive: 'Provide a thorough analysis with all relevant clinical details.',
    detailed: 'Provide an in-depth analysis including subtle findings, trends, and clinical reasoning.'
  };
  
  const typeInstructions = documentType !== 'auto' ? `\n\nDocument Type: ${documentType.replace(/_/g, ' ')}. Focus your analysis accordingly.` : '';
  
  const patientContextStr = patientContext ? `\n\nPATIENT CONTEXT:\n${JSON.stringify(patientContext, null, 2)}\n\nCompare document findings with existing patient data to identify NEW diagnoses, medications, and changes.` : '';
  
  const basePrompt = `You are analyzing clinical documents for a ${providerType} working in ${careSetting.replace(/_/g, ' ')}.\n\nDocuments uploaded: ${fileNames.join(', ')}\n\n${depthInstructions[analysisMode]}${typeInstructions}${patientContextStr}\n\nIMPORTANT:\n1. Extract structured patient data (demographics, diagnoses, medications, allergies, vitals)\n2. Suggest care plan updates based on findings\n3. Perform compliance audit - check for missing documentation, regulatory issues\n4. Identify action items and next steps\n\n`;
  
  const prompts = {
    home_health: {
      RN: `${basePrompt}Focus on:
- Patient demographics and insurance information
- Primary and secondary diagnoses (with ICD-10 codes if available)
- Current medications and allergies
- Functional status and ADL independence
- Homebound status indicators
- Skilled nursing needs
- OASIS-relevant assessment data
- Safety concerns and fall risk
- Orders and care plan recommendations

Provide OASIS item suggestions based on the referral information.`,
      
      LPN: `${basePrompt}Focus on:
- Vital signs monitoring requirements
- Medication administration needs
- Wound care requirements
- Basic ADL assistance needs
- Patient teaching opportunities
- Safety protocols`,
      
      PT: `${basePrompt}Focus on:
- Mobility and transfer status
- Gait and balance assessment
- Range of motion limitations
- Pain reports
- Fall history and risk
- Prior therapy outcomes
- Home safety and DME needs
- Functional goals`,
      
      OT: `${basePrompt}Focus on:
- ADL independence levels
- Fine motor skills
- Cognitive status
- Home modification needs
- Adaptive equipment requirements
- Safety awareness
- Prior therapy progress`,
      
      ST: `${basePrompt}Focus on:
- Swallowing and dysphagia risk
- Speech and language deficits
- Cognitive-communication status
- Diet texture recommendations
- Prior therapy outcomes
- Communication strategies`,
      
      MSW: `${basePrompt}Focus on:
- Psychosocial stressors
- Financial barriers to care
- Caregiver support and burden
- Depression screening results
- Community resources needed
- Advance directives status
- Living situation and safety`
    },
    
    outpatient_clinic: {
      MD: `${basePrompt}Focus on:
- Chief complaint and presenting symptoms
- Relevant history and physical findings
- Diagnostic test results
- Specialist recommendations
- Treatment plan modifications
- Medication changes
- Follow-up requirements
- Red flags or urgent findings`,
      
      NP: `${basePrompt}Focus on:
- Chief complaint and HPI
- Relevant exam findings
- Lab and imaging results
- Differential diagnoses
- Treatment recommendations
- Patient education needs
- Follow-up plan`,
      
      PA: `${basePrompt}Focus on:
- Presenting problem
- Pertinent physical findings
- Diagnostic results
- Specialist opinions
- Treatment modifications
- Patient instructions`
    },
    
    telehealth: {
      default: `${basePrompt}Focus on:
- Virtual visit findings
- Remote monitoring data
- Patient-reported symptoms
- Technology accessibility
- Follow-up telehealth needs
- In-person visit requirements`
    }
  };

  return prompts[careSetting]?.[providerType] || prompts[careSetting]?.default || basePrompt + "Analyze these clinical documents and provide a comprehensive summary.";
}

function getAnalysisSchema(providerType, careSetting, documentType) {
  const baseSchema = {
    type: "object",
    properties: {
      executive_summary: {
        type: "string",
        description: "Brief executive summary of all documents"
      },
      key_findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string" },
            finding: { type: "string" }
          }
        },
        description: "Most important clinical findings"
      },
      extracted_data: {
        type: "object",
        description: "Structured patient data extracted from documents",
        properties: {
          demographics: {
            type: "object",
            description: "Demographic information found"
          },
          diagnoses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                diagnosis: { type: "string" },
                icd10_code: { type: "string" },
                is_new: { type: "boolean" }
              }
            }
          },
          medications: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                dosage: { type: "string" },
                frequency: { type: "string" },
                is_new: { type: "boolean" }
              }
            }
          },
          allergies: {
            type: "array",
            items: { type: "string" }
          },
          vitals: {
            type: "object",
            description: "Most recent vital signs found"
          }
        }
      },
      care_plan_suggestions: {
        type: "array",
        description: "Recommended care plan updates",
        items: {
          type: "object",
          properties: {
            problem: { type: "string" },
            goal: { type: "string" },
            interventions: {
              type: "array",
              items: { type: "string" }
            },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            rationale: { type: "string" },
            baseline_measurement: { type: "string" },
            frequency: { type: "string" }
          }
        }
      },
      compliance_audit: {
        type: "object",
        description: "Compliance and quality audit results",
        properties: {
          overall_score: { type: "number", description: "0-100 score" },
          summary: { type: "string" },
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                category: { type: "string" },
                description: { type: "string" },
                recommendation: { type: "string" },
                regulation_reference: { type: "string" }
              }
            }
          },
          strengths: {
            type: "array",
            items: { type: "string" }
          },
          missing_elements: {
            type: "array",
            items: { type: "string" }
          }
        }
      },
      action_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string" },
            priority: { type: "string" }
          }
        }
      }
    }
  };

  if (careSetting === 'home_health' && (providerType === 'RN' || providerType === 'LPN')) {
    baseSchema.properties.patient_demographics = {
      type: "object",
      properties: {
        name: { type: "string" },
        dob: { type: "string" },
        insurance: { type: "string" },
        physician: { type: "string" }
      }
    };
    baseSchema.properties.diagnoses = {
      type: "array",
      items: {
        type: "object",
        properties: {
          diagnosis: { type: "string" },
          icd10: { type: "string" }
        }
      }
    };
    baseSchema.properties.medications = {
      type: "array",
      items: { type: "string" }
    };
    baseSchema.properties.oasis_suggestions = {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          suggested_value: { type: "string" },
          rationale: { type: "string" }
        }
      }
    };
    baseSchema.properties.homebound_indicators = {
      type: "array",
      items: { type: "string" }
    };
  }

  if (providerType === 'MD' || providerType === 'NP' || providerType === 'PA') {
    baseSchema.properties.specialist_recommendations = {
      type: "array",
      items: { type: "string" }
    };
    baseSchema.properties.diagnostic_results = {
      type: "array",
      items: {
        type: "object",
        properties: {
          test: { type: "string" },
          result: { type: "string" },
          significance: { type: "string" }
        }
      }
    };
  }

  return baseSchema;
}

function renderProviderSpecificSections(analysis, providerType, careSetting, copyToClipboard) {
  const sections = [];

  if (analysis.patient_demographics) {
    sections.push(
      <div key="demographics">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Patient Demographics</h3>
        <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
          {Object.entries(analysis.patient_demographics).map(([key, value]) => (
            value && (
              <div key={key}>
                <p className="text-xs text-slate-500 uppercase">{key.replace(/_/g, ' ')}</p>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{value}</p>
              </div>
            )
          ))}
        </div>
      </div>
    );
  }

  if (analysis.diagnoses && analysis.diagnoses.length > 0) {
    sections.push(
      <div key="diagnoses">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Diagnoses</h3>
        <div className="space-y-2">
          {analysis.diagnoses.map((dx, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{dx.diagnosis}</p>
                {dx.icd10 && <p className="text-xs text-slate-500">{dx.icd10}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (analysis.medications && analysis.medications.length > 0) {
    sections.push(
      <div key="medications">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Medications</h3>
        <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
          <ul className="list-disc list-inside space-y-1">
            {analysis.medications.map((med, index) => (
              <li key={index} className="text-sm text-slate-700 dark:text-slate-300">{med}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (analysis.oasis_suggestions && analysis.oasis_suggestions.length > 0) {
    sections.push(
      <div key="oasis">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">OASIS Item Suggestions</h3>
        <div className="space-y-3">
          {analysis.oasis_suggestions.map((item, index) => (
            <div key={index} className="p-4 bg-purple-50 dark:bg-purple-950 border-l-4 border-purple-500 rounded">
              <p className="text-sm font-medium text-purple-900 dark:text-purple-100">{item.item}</p>
              <p className="text-sm text-purple-800 dark:text-purple-200 mt-1">
                Suggested: <strong>{item.suggested_value}</strong>
              </p>
              <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">{item.rationale}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (analysis.homebound_indicators && analysis.homebound_indicators.length > 0) {
    sections.push(
      <div key="homebound">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Homebound Status Indicators</h3>
        <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
          <ul className="list-disc list-inside space-y-1">
            {analysis.homebound_indicators.map((indicator, index) => (
              <li key={index} className="text-sm text-green-800 dark:text-green-200">{indicator}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (analysis.specialist_recommendations && analysis.specialist_recommendations.length > 0) {
    sections.push(
      <div key="specialist">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Specialist Recommendations</h3>
        <div className="space-y-2">
          {analysis.specialist_recommendations.map((rec, index) => (
            <div key={index} className="p-3 bg-indigo-50 dark:bg-indigo-950 rounded-lg">
              <p className="text-sm text-indigo-900 dark:text-indigo-100">{rec}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (analysis.diagnostic_results && analysis.diagnostic_results.length > 0) {
    sections.push(
      <div key="diagnostics">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Diagnostic Results</h3>
        <div className="space-y-3">
          {analysis.diagnostic_results.map((result, index) => (
            <div key={index} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{result.test}</p>
              <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{result.result}</p>
              {result.significance && (
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 italic">{result.significance}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return sections;
}