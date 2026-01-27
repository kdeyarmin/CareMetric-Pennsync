import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FileText, Upload, Brain, History, Sparkles, Loader2, X,
  Download, Copy, Save, Plus, Eye, Trash2, Edit2, ArrowLeft
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import jsPDF from "jspdf";
import PullToRefresh from "../components/mobile/PullToRefresh";
import EmptyState from "../components/ui/EmptyState";
import TemplateSelectionFlow from "../components/documents/TemplateSelectionFlow";
import DocumentDataForm from "../components/documents/DocumentDataForm";
import DocumentPreview from "../components/documents/DocumentPreview";
import AITemplateGenerator from "../components/templates/AITemplateGenerator";
import PrebuiltTemplateLibrary from "../components/templates/PrebuiltTemplateLibrary";
import CustomTemplateEditor from "../components/templates/CustomTemplateEditor";
import ExtractedDataReview from "../components/documents/ExtractedDataReview";
import CarePlanSuggestions from "../components/documents/CarePlanSuggestions";
import ComplianceAuditResults from "../components/documents/ComplianceAuditResults";

export default function DocumentCenter() {
  const [activeTab, setActiveTab] = useState('generate');
  const [step, setStep] = useState('select');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [generatedDocument, setGeneratedDocument] = useState(null);
  const [preFilledData, setPreFilledData] = useState({});
  const [templateStep, setTemplateStep] = useState('list');
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['documentTemplates'],
    queryFn: () => base44.entities.DocumentTemplate.list('-created_date', 100)
  });

  const { data: userTemplates = [] } = useQuery({
    queryKey: ['userTemplates', currentUser?.email],
    queryFn: async () => {
      const all = await base44.entities.DocumentTemplate.list('-created_date', 200);
      return all.filter(t => t.created_by === currentUser?.email);
    },
    enabled: !!currentUser?.email
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 100)
  });

  const { data: generatedDocuments = [] } = useQuery({
    queryKey: ['generatedDocuments', currentUser?.email],
    queryFn: () => base44.entities.GeneratedDocument.filter({ created_by: currentUser?.email }, '-created_date'),
    enabled: !!currentUser?.email
  });

  const generateDocMutation = useMutation({
    mutationFn: async (data) => {
      const response = await base44.functions.invoke('generateDocument', {
        template: selectedTemplate,
        generation_data: data.generation_data,
        custom_text: data.custom_text
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      setGeneratedDocument(data.document);
      setStep('preview');
      queryClient.invalidateQueries({ queryKey: ['generatedDocuments'] });
    }
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (data) => {
      if (selectedTemplate?.id) {
        return base44.entities.DocumentTemplate.update(selectedTemplate.id, data);
      } else {
        return base44.entities.DocumentTemplate.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userTemplates'] });
      setTemplateStep('list');
      setSelectedTemplate(null);
    }
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (templateId) => base44.entities.DocumentTemplate.delete(templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userTemplates'] })
  });

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
    if (selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...selectedFiles]);
      toast.success(`${selectedFiles.length} file(s) added`);
    }
  };

  const handleAnalyze = async () => {
    if (files.length === 0) return;
    setAnalyzing(true);
    try {
      const uploadedUrls = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        uploadedUrls.push(file_url);
      }

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze these clinical documents. Extract key findings, diagnoses, medications, and action items.`,
        file_urls: uploadedUrls,
        response_json_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            key_findings: { type: "array", items: { type: "object", properties: { category: { type: "string" }, finding: { type: "string" } } } },
            extracted_data: { type: "object" },
            action_items: { type: "array", items: { type: "object", properties: { action: { type: "string" }, priority: { type: "string" } } } }
          }
        }
      });

      setAnalysis(result);
      toast.success('Analysis complete');
    } catch (error) {
      toast.error('Analysis failed: ' + error.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const patient = patients.find(p => p.id === generatedDocument?.patient_id);

  return (
    <PullToRefresh onRefresh={() => queryClient.invalidateQueries()}>
      <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto w-full max-w-full overflow-x-hidden min-w-0 pb-20 sm:pb-6">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
            Document Center
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 mt-1">
            Generate documents, manage templates, and analyze clinical files
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-auto">
            <TabsTrigger value="generate">Generate</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="analyze">Analyze</TabsTrigger>
          </TabsList>

          {/* Generate Tab */}
          <TabsContent value="generate" className="space-y-4 sm:space-y-6 mt-4 sm:mt-6 w-full">
            {step === 'select' && (
              <div className="space-y-4 sm:space-y-6 w-full">
                {!selectedPatient ? (
                  <Card className="w-full">
                    <CardContent className="p-4 sm:p-6">
                      <Label className="text-base font-semibold mb-3 block">Select Patient</Label>
                      <Select value={selectedPatient || ''} onValueChange={setSelectedPatient}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose patient..." />
                        </SelectTrigger>
                        <SelectContent>
                          {patients.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.first_name} {p.last_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setSelectedPatient(null)}>Change Patient</Button>
                    <TemplateSelectionFlow
                      patient={patients.find(p => p.id === selectedPatient)}
                      templates={templates}
                      onSelect={(template, prefilled) => {
                        setSelectedTemplate(template);
                        setPreFilledData(prefilled);
                        setStep('form');
                      }}
                    />
                  </>
                )}
              </div>
            )}

            {step === 'form' && selectedTemplate && (
              <DocumentDataForm
                template={selectedTemplate}
                patients={patients}
                onGenerate={(data) => generateDocMutation.mutate({ ...data, generation_data: { ...preFilledData, ...data.generation_data } })}
                onBack={() => { setStep('select'); setSelectedPatient(null); }}
                generating={generateDocMutation.isPending}
              />
            )}

            {step === 'preview' && generatedDocument && (
              <DocumentPreview
                document={generatedDocument}
                patient={patient}
                onClose={() => { setStep('select'); setGeneratedDocument(null); }}
                onSave={(doc) => base44.entities.GeneratedDocument.update(doc.id, { generated_content: doc.generated_content, status: 'final' })}
                onSend={(doc) => base44.integrations.Core.SendEmail({ to: doc.patient_email, subject: `Document: ${doc.document_name}`, body: 'Please find your document attached.' })}
              />
            )}
          </TabsContent>

          {/* Templates Tab */}
          <TabsContent value="templates" className="space-y-4 sm:space-y-6 mt-4 sm:mt-6 w-full">
            {templateStep === 'list' ? (
              <>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <h2 className="text-lg sm:text-xl font-semibold">Document Templates</h2>
                  <Button onClick={() => { setSelectedTemplate(null); setTemplateStep('create'); }} className="w-full sm:w-auto touch-target">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Template
                  </Button>
                </div>

                <Tabs defaultValue="my-templates" className="w-full">
                  <TabsList className="grid w-full grid-cols-3 h-auto">
                    <TabsTrigger value="my-templates">My Templates ({userTemplates.length})</TabsTrigger>
                    <TabsTrigger value="prebuilt">Pre-built</TabsTrigger>
                    <TabsTrigger value="ai-gen">AI Generator</TabsTrigger>
                  </TabsList>

                  <TabsContent value="my-templates" className="mt-4 w-full">
                    {userTemplates.length === 0 ? (
                      <EmptyState icon={FileText} title="No Templates" description="Create your first template" />
                    ) : (
                      <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2">
                        {userTemplates.map(template => (
                          <Card key={template.id} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => { setSelectedTemplate(template); setTemplateStep('edit'); }}>
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between">
                                <div>
                                  <h3 className="font-semibold">{template.template_name}</h3>
                                  <p className="text-sm text-slate-600 mt-1">{template.description}</p>
                                  <Badge variant="outline" className="text-xs mt-2">{template.category?.replace(/_/g, ' ')}</Badge>
                                </div>
                                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete?')) deleteTemplateMutation.mutate(template.id); }}>
                                  <Trash2 className="w-4 h-4 text-red-600" />
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="prebuilt" className="mt-4">
                    <PrebuiltTemplateLibrary onUseTemplate={() => queryClient.invalidateQueries({ queryKey: ['userTemplates'] })} />
                  </TabsContent>

                  <TabsContent value="ai-gen" className="mt-4">
                    <AITemplateGenerator onTemplateGenerated={() => { queryClient.invalidateQueries({ queryKey: ['userTemplates'] }); toast.success("Template saved!"); }} />
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => { setTemplateStep('list'); setSelectedTemplate(null); }}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <CustomTemplateEditor
                  initialTemplate={selectedTemplate}
                  onSave={(data) => saveTemplateMutation.mutate(data)}
                  onCancel={() => { setTemplateStep('list'); setSelectedTemplate(null); }}
                />
              </>
            )}
          </TabsContent>

          {/* Analyze Tab */}
          <TabsContent value="analyze" className="space-y-4 sm:space-y-6 mt-4 sm:mt-6 w-full">
            <Card className="w-full">
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="text-base sm:text-lg">Upload & Analyze Documents</CardTitle>
                <CardDescription className="text-xs sm:text-sm">Upload clinical PDFs for AI-powered analysis</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-4 sm:p-6 pt-0">
                <input
                  type="file"
                  id="file-upload"
                  multiple
                  accept=".pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <label htmlFor="file-upload" className="border-2 border-dashed rounded-lg p-6 sm:p-8 text-center block cursor-pointer hover:border-indigo-500 transition-colors">
                  <Upload className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 sm:mb-4 text-slate-400" />
                  <p className="text-xs sm:text-sm text-slate-600">Click to upload or drag PDF files</p>
                </label>

                {files.length > 0 && (
                  <div className="space-y-2">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-slate-500" />
                          <div>
                            <p className="text-sm font-medium">{file.name}</p>
                            <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setFiles(prev => prev.filter((_, i) => i !== index))}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <Button onClick={handleAnalyze} disabled={files.length === 0 || analyzing} className="w-full bg-indigo-600 touch-target">
                  {analyzing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {analyzing ? 'Analyzing...' : 'Analyze Documents'}
                </Button>
              </CardContent>
            </Card>

            {analysis && (
              <Card className="w-full">
                <CardHeader className="p-4 sm:p-6">
                  <CardTitle className="text-base sm:text-lg">Analysis Results</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 p-4 sm:p-6 pt-0">
                  <div>
                    <h3 className="font-semibold mb-2 text-sm sm:text-base">Executive Summary</h3>
                    <p className="text-xs sm:text-sm bg-slate-50 p-3 sm:p-4 rounded-lg whitespace-pre-wrap break-words">{analysis.executive_summary}</p>
                  </div>

                  {analysis.key_findings && (
                    <div>
                      <h3 className="font-semibold mb-2 text-sm sm:text-base">Key Findings</h3>
                      <div className="space-y-2">
                        {analysis.key_findings.map((finding, idx) => (
                          <div key={idx} className="p-3 bg-blue-50 border-l-4 border-blue-500 rounded overflow-hidden">
                            <p className="text-xs sm:text-sm font-medium text-blue-900 break-words">{finding.category}</p>
                            <p className="text-xs sm:text-sm text-blue-800 mt-1 break-words">{finding.finding}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.extracted_data && <ExtractedDataReview extractedData={analysis.extracted_data} patientId={selectedPatient} onApply={() => queryClient.invalidateQueries(['patients'])} />}

                  <div className="flex gap-2">
                    <Button onClick={() => { setFiles([]); setAnalysis(null); }} variant="outline">Analyze New</Button>
                    <Button onClick={() => { navigator.clipboard.writeText(JSON.stringify(analysis, null, 2)); toast.success('Copied'); }} variant="outline">Copy</Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PullToRefresh>
  );
}