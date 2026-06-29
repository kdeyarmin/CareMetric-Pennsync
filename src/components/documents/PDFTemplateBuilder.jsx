import { useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload,
  Loader2,
  CheckCircle2,
  FileStack,
  FileText,
  Signature,
  UserRound,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import VisualFieldEditor from "./VisualFieldEditor";

const TEMPLATE_CATEGORIES = [
  { value: 'consent', label: 'Consent Form' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'care_plan', label: 'Care Plan' },
  { value: 'discharge', label: 'Discharge Summary' },
  { value: 'admission', label: 'Admission Form' },
  { value: 'other', label: 'Other' },
];

const createDocumentDefinition = (file, fileUrl, order) => ({
  id: `${Date.now()}-${order}-${file.name}`,
  order,
  name: file.name.replace(/\.pdf$/i, ''),
  fileName: file.name,
  fileUrl,
  fields: [],
});

export default function PDFTemplateBuilder({ open, onClose }) {
  const [step, setStep] = useState('info');
  const [formData, setFormData] = useState({
    template_name: '',
    template_category: 'consent',
    description: '',
  });
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [activeDocumentId, setActiveDocumentId] = useState(null);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  const activeDocument = useMemo(
    () => documents.find((document) => document.id === activeDocumentId) || documents[0] || null,
    [documents, activeDocumentId],
  );

  const normalizedDocuments = useMemo(() => documents.map((document, index) => {
    const signatureFields = document.fields
      .filter((field) => field.field_type === 'signature')
      .map((field) => ({
        field_name: field.field_name,
        label: field.label,
        role: field.role || 'patient',
        required: field.required !== false,
        position: field.position,
        size: field.size,
        document_id: document.id,
        document_name: document.name,
      }));

    const fieldMappings = document.fields
      .filter((field) => field.field_type !== 'signature')
      .map((field) => ({
        pdf_field_name: field.field_name,
        data_source: field.data_source,
        field_path: field.field_path,
        label: field.label,
        field_type: field.field_type,
        default_value: field.default_value,
        placeholder: field.placeholder,
        required: field.required,
        document_id: document.id,
        document_name: document.name,
        position: field.position,
        size: field.size,
        format: field.field_type === 'date' ? 'MM/dd/yyyy' : undefined,
      }));

    const carryForwardFields = fieldMappings
      .filter((field) => field.data_source === 'patient' && field.field_path)
      .map((field) => ({
        field_name: field.pdf_field_name,
        patient_field: field.field_path,
        label: field.label,
        document_id: document.id,
      }));

    return {
      ...document,
      order: index + 1,
      signatureFields,
      fieldMappings,
      carryForwardFields,
    };
  }), [documents]);

  const createTemplateMutation = useMutation({
    mutationFn: async (templateData) => {
      const packetDocuments = normalizedDocuments.map((document) => ({
        document_id: document.id,
        document_name: document.name,
        original_file_name: document.fileName,
        template_file_url: document.fileUrl,
        order: document.order,
        field_mappings: document.fieldMappings,
        signature_fields: document.signatureFields,
        carry_forward_fields: document.carryForwardFields,
        visual_elements: document.fields.map((field) => ({
          id: field.id,
          type: field.field_type,
          label: field.label,
          position: field.position || { x: 50, y: 50 },
          size: field.size || { width: 200, height: 30 },
          properties: {
            required: field.required,
            placeholder: field.placeholder,
            defaultValue: field.default_value,
            conditional: field.conditional,
            data_source: field.data_source,
            field_path: field.field_path,
          },
        })),
      }));

      return base44.entities.PDFTemplate.create({
        template_name: templateData.template_name,
        template_category: templateData.template_category,
        description: templateData.description,
        template_file_url: packetDocuments[0]?.template_file_url || '',
        is_packet: packetDocuments.length > 1,
        document_count: packetDocuments.length,
        packet_documents: packetDocuments,
        version: '1.0',
        is_active: true,
        field_mappings: packetDocuments.flatMap((document) => document.field_mappings),
        signature_fields: packetDocuments.flatMap((document) => document.signature_fields),
        carry_forward_fields: packetDocuments.flatMap((document) => document.carry_forward_fields),
        visual_elements: packetDocuments.flatMap((document) => document.visual_elements),
        usage_count: 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdfTemplates'] });
      queryClient.invalidateQueries({ queryKey: ['pdf-templates'] });
      toast.success('Template created successfully!');
      handleClose();
    },
    onError: (error) => {
      toast.error(`Failed to create template: ${error.message}`);
    },
  });

  const resetForm = () => {
    setFormData({
      template_name: '',
      template_category: 'consent',
      description: '',
    });
    setDocuments([]);
    setActiveDocumentId(null);
    setStep('info');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleFileSelect = async (event) => {
    const selectedFiles = Array.from(event.target.files || []).filter((file) => file.type === 'application/pdf');
    if (selectedFiles.length === 0) {
      toast.error('Please select one or more PDF files');
      return;
    }

    setUploading(true);
    try {
      const uploadedDocuments = [];
      for (const [index, file] of selectedFiles.entries()) {
        const uploadedFile = await base44.integrations.Core.UploadFile({ file });
        uploadedDocuments.push(createDocumentDefinition(file, uploadedFile.file_url, documents.length + index + 1));
      }

      const nextDocuments = [...documents, ...uploadedDocuments];
      setDocuments(nextDocuments);
      setActiveDocumentId((current) => current || nextDocuments[0]?.id || null);
      setStep('fields');
      toast.success(`${uploadedDocuments.length} PDF${uploadedDocuments.length > 1 ? 's' : ''} uploaded`);
    } catch (error) {
      toast.error(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const updateDocumentFields = (documentId, fields) => {
    setDocuments((currentDocuments) => currentDocuments.map((document) => (
      document.id === documentId ? { ...document, fields } : document
    )));
  };

  const removeDocument = (documentId) => {
    setDocuments((currentDocuments) => {
      const nextDocuments = currentDocuments.filter((document) => document.id !== documentId);
      if (activeDocumentId === documentId) {
        setActiveDocumentId(nextDocuments[0]?.id || null);
      }
      return nextDocuments;
    });
  };

  const handleCreate = () => {
    if (!formData.template_name.trim()) {
      toast.error('Please enter a template name');
      return;
    }
    if (documents.length === 0) {
      toast.error('Please upload at least one PDF document');
      return;
    }
    createTemplateMutation.mutate(formData);
  };

  const totalSignatureFields = normalizedDocuments.reduce((total, document) => total + document.signatureFields.length, 0);
  const totalCarryForwardFields = normalizedDocuments.reduce((total, document) => total + document.carryForwardFields.length, 0);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleClose();
      }
    }}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create E-Signature Template</DialogTitle>
          <DialogDescription>
            Upload one PDF or a packet of PDFs, place every signature/data field visually, and define which patient details should carry forward automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex gap-2">
            {[
              { id: 'info', label: 'Template Info' },
              { id: 'upload', label: 'Upload PDFs' },
              { id: 'fields', label: 'Place Fields' },
              { id: 'confirm', label: 'Review' },
            ].map((item, index, allItems) => {
              const currentIndex = allItems.findIndex((stepItem) => stepItem.id === step);
              return (
                <div key={item.id} className="flex-1">
                  <div className={`h-1 rounded-full ${index <= currentIndex ? 'bg-blue-600' : 'bg-slate-200'}`} />
                  <p className="mt-1 text-xs text-slate-600">{item.label}</p>
                </div>
              );
            })}
          </div>

          {step === 'info' && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Template Name</Label>
                <Input
                  placeholder="e.g., Admission Packet with Consents"
                  value={formData.template_name}
                  onChange={(event) => setFormData((current) => ({ ...current, template_name: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={formData.template_category}
                  onValueChange={(value) => setFormData((current) => ({ ...current, template_category: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_CATEGORIES.map((category) => (
                      <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Packet Type</Label>
                <div className="rounded-md border p-3 text-sm text-slate-700 bg-slate-50">
                  {documents.length > 1 ? 'Multi-document packet' : 'Single document template'}
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="Describe the workflow, which forms are included, and who signs them."
                  value={formData.description}
                  onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                  rows={4}
                />
              </div>
            </div>
          )}

          {step === 'upload' && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="space-y-2">
                  {uploading ? (
                    <>
                      <Loader2 className="w-12 h-12 text-blue-600 mx-auto animate-spin" />
                      <p className="text-sm text-slate-600">Uploading PDF files...</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-12 h-12 text-slate-400 mx-auto" />
                      <p className="text-sm font-medium text-slate-700">Upload a document or packet of documents</p>
                      <p className="text-xs text-slate-500">Select one PDF or multiple PDFs for a packet</p>
                    </>
                  )}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />

              {documents.length > 0 && (
                <div className="space-y-3">
                  {documents.map((document, index) => (
                    <Card key={document.id}>
                      <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          {documents.length > 1 ? <FileStack className="w-5 h-5 text-indigo-600 shrink-0" /> : <FileText className="w-5 h-5 text-blue-600 shrink-0" />}
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 truncate">{document.name}</p>
                            <p className="text-xs text-slate-500">Document {index + 1} of {documents.length}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{document.fields.length} field(s)</Badge>
                          <Button size="icon" variant="ghost" onClick={() => removeDocument(document.id)}>
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'fields' && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Place signature and carry-forward fields</h3>
                  <p className="text-sm text-slate-600">Choose a document, then add signature fields and any patient data that should carry forward automatically.</p>
                </div>
                {documents.length > 0 && (
                  <Tabs value={activeDocument?.id} onValueChange={setActiveDocumentId} className="w-full lg:w-auto">
                    <TabsList className="flex flex-wrap h-auto justify-start">
                      {documents.map((document, index) => (
                        <TabsTrigger key={document.id} value={document.id}>
                          {documents.length > 1 ? `Doc ${index + 1}` : 'Document'}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Card className="md:col-span-1">
                  <CardContent className="p-4 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">Current document</p>
                      <p className="text-sm text-slate-600">{activeDocument?.name || 'None selected'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-md border p-3">
                        <div className="flex items-center gap-2 text-navy-700">
                          <Signature className="w-4 h-4" />
                          <span>Signatures</span>
                        </div>
                        <p className="mt-2 text-lg font-semibold">{activeDocument ? activeDocument.fields.filter((field) => field.field_type === 'signature').length : 0}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="flex items-center gap-2 text-blue-700">
                          <UserRound className="w-4 h-4" />
                          <span>Patient carry-forward</span>
                        </div>
                        <p className="mt-2 text-lg font-semibold">
                          {activeDocument ? activeDocument.fields.filter((field) => field.data_source === 'patient' && field.field_type !== 'signature').length : 0}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                      Tip: use <strong>Data Source = Patient Data</strong> for any field you want auto-carried forward from the patient record.
                    </div>
                  </CardContent>
                </Card>

                <div className="md:col-span-2">
                  {activeDocument ? (
                    <VisualFieldEditor
                      pdfUrl={activeDocument.fileUrl}
                      initialFields={activeDocument.fields}
                      onFieldsChange={(fields) => updateDocumentFields(activeDocument.id, fields)}
                    />
                  ) : (
                    <Card>
                      <CardContent className="p-10 text-center text-slate-500">
                        Upload at least one PDF to start placing fields.
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              <Card className="bg-green-50 border-green-200">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-slate-900">{formData.template_name}</p>
                      <p className="text-sm text-slate-600">{documents.length > 1 ? 'Packet template' : 'Single document template'} • {documents.length} PDF(s)</p>
                      <div className="mt-2 inline-block">
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                          {TEMPLATE_CATEGORIES.find(c => c.value === formData.template_category)?.label}
                        </span>
                      </div>
                    </div>
                  </div>
                  {formData.description && (
                    <p className="text-sm text-slate-700 p-3 bg-white rounded border">
                      {formData.description}
                    </p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs text-slate-500">Documents</p>
                      <p className="text-lg font-semibold text-slate-900">{documents.length}</p>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs text-slate-500">Signature fields</p>
                      <p className="text-lg font-semibold text-slate-900">{totalSignatureFields}</p>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs text-slate-500">Patient carry-forward fields</p>
                      <p className="text-lg font-semibold text-slate-900">{totalCarryForwardFields}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {normalizedDocuments.map((document) => (
                  <Card key={document.id}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">{document.name}</p>
                          <p className="text-xs text-slate-500">{document.fileName}</p>
                        </div>
                        <Badge variant="outline">{document.order}</Badge>
                      </div>
                      <div className="text-sm text-slate-600 flex flex-wrap gap-4">
                        <span>{document.signatureFields.length} signature field(s)</span>
                        <span>{document.fieldMappings.length} mapped field(s)</span>
                        <span>{document.carryForwardFields.length} patient carry-forward field(s)</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === 'info' && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => setStep('upload')}>Next</Button>
            </>
          )}

          {step === 'upload' && (
            <>
              <Button variant="outline" onClick={() => setStep('info')}>Back</Button>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading...' : 'Add PDF Files'}
              </Button>
              <Button onClick={() => setStep('fields')} disabled={documents.length === 0}>Configure Fields</Button>
            </>
          )}

          {step === 'fields' && (
            <>
              <Button variant="outline" onClick={() => setStep('upload')}>Back</Button>
              <Button onClick={() => setStep('confirm')} disabled={documents.length === 0}>Review & Create</Button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <Button variant="outline" onClick={() => setStep('fields')}>Edit Fields</Button>
              <Button onClick={handleCreate} disabled={createTemplateMutation.isPending}>
                {createTemplateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : 'Create Template'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
