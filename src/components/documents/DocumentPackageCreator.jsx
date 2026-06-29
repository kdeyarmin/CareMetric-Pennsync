import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Package,
  CheckSquare,
  Square,
  Send,
  Upload,
  File,
  X,
  Mail
} from "lucide-react";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";
import SearchablePatientSelect from "../ui/SearchablePatientSelect";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

export default function DocumentPackageCreator({ open, onClose }) {
  const queryClient = useQueryClient();
  const [useExistingPatient, setUseExistingPatient] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [manualPatientInfo, setManualPatientInfo] = useState({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    email: '',
    phone: '',
    address: ''
  });
  const [packageName, setPackageName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [sendForSignature, setSendForSignature] = useState(true);
  const [signerEmail, setSignerEmail] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signatureMessage, setSignatureMessage] = useState('');

  const { data: templates = [] } = useQuery({
    queryKey: ['pdf-templates-active'],
    queryFn: () => base44.entities.PDFTemplate.filter({ is_active: true }),
    initialData: [],
    enabled: open
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients-for-select'],
    queryFn: () => base44.entities.Patient.list('-created_date', 500),
    initialData: [],
    enabled: open,
    refetchOnMount: 'stale',
    staleTime: 0
  });

  // Invalidate patient list when new patients are created
  const _onPatientCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['patients-for-select'] });
  };

  const createPackageMutation = useMutation({
    mutationFn: async () => {
      const patientId = selectedPatient;
      const patientData = useExistingPatient ? null : manualPatientInfo;
      const selectedPatientRecord = patients.find((patient) => patient.id === selectedPatient);
      const patientDisplayName = useExistingPatient && selectedPatientRecord
        ? `${selectedPatientRecord.first_name} ${selectedPatientRecord.last_name}`
        : `${manualPatientInfo.first_name} ${manualPatientInfo.last_name}`.trim();
      const signaturePromises = [];
      // Track template metadata per signature so we can build version records afterwards
      const signatureMeta = [];

      for (const templateId of selectedDocuments) {
        const template = templates.find((item) => item.id === templateId);
        if (!template) {
          continue;
        }

        const packetDocuments = template.packet_documents?.length > 0
          ? template.packet_documents
          : [{
              document_name: template.template_name,
              template_file_url: template.template_file_url,
              signature_fields: template.signature_fields || [],
              field_mappings: template.field_mappings || [],
              carry_forward_fields: template.carry_forward_fields || [],
            }];

        for (const [index, packetDocument] of packetDocuments.entries()) {
          let pdfUrl = packetDocument.template_file_url;

          if (!useExistingPatient) {
            // Backend requires `pdf_template_url` and returns { prepared_pdf_url }
            // on .data (functions.invoke yields the axios response, not the body).
            const result = await base44.functions.invoke('preparePDFWithPatientInfo', {
              pdf_template_url: packetDocument.template_file_url,
              patient_info: patientData,
            });
            pdfUrl = result.data?.prepared_pdf_url || pdfUrl;
          }

          const documentName = packetDocuments.length > 1
            ? `${template.template_name} - ${packetDocument.document_name || `Document ${index + 1}`}`
            : template.template_name;

          signatureMeta.push({
            document_name: documentName,
            document_type: template.template_category || 'other',
          });

          signaturePromises.push(
            base44.entities.DocumentSignature.create({
              patient_id: patientId,
              document_type: template.template_category,
              document_title: documentName,
              document_content: pdfUrl || '',
              document_url: pdfUrl,
              status: 'pending',
              signers: (packetDocument.signature_fields || template.signature_fields || []).map((signer, signerIndex) => ({
                id: signer.signer_id || signer.id || `${template.id}-${index + 1}-${signerIndex + 1}`,
                name: signer.role === 'patient' ? (signerName || patientDisplayName || signer.label || `Signer ${signerIndex + 1}`) : (signer.label || signer.role || `Signer ${signerIndex + 1}`),
                email: signerEmail || '',
                role: signer.role || 'patient',
                required: signer.required !== false,
                signed_date: null,
                signature: null,
                signature_method: null,
                order: signer.order || signerIndex + 1,
              })),
              required_signatures: (packetDocument.signature_fields || template.signature_fields || []).map((signer, signerIndex) => ({
                signer_id: signer.signer_id || signer.id || `${template.id}-${index + 1}-${signerIndex + 1}`,
                name: signer.role === 'patient' ? (signerName || patientDisplayName || signer.label || `Signer ${signerIndex + 1}`) : (signer.label || signer.role || `Signer ${signerIndex + 1}`),
                role: signer.role || 'patient',
                is_required: signer.required !== false,
                is_signed: false,
                order: signer.order || signerIndex + 1,
              })),
              due_date: dueDate || null,
            })
          );
        }
      }

      for (const file of uploadedFiles) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: file.file });
        signatureMeta.push({
          document_name: file.name,
          document_type: 'other',
        });
        signaturePromises.push(
          base44.entities.DocumentSignature.create({
            patient_id: patientId,
            document_type: 'other',
            document_title: file.name,
            document_content: file_url,
            document_url: file_url,
            status: 'pending',
            signers: (signerName || signerEmail)
              ? [{
                  id: 1,
                  name: signerName || patientDisplayName || 'Signer 1',
                  email: signerEmail || '',
                  role: 'patient',
                  required: true,
                  status: 'pending',
                  signed_date: null,
                  signature: null,
                  signature_method: null,
                }]
              : [],
            required_signatures: [],
            due_date: dueDate || null,
          })
        );
      }

      const signatures = await Promise.all(signaturePromises);
      const signatureIds = signatures.map((signature) => signature.id);

      const pkg = await base44.entities.DocumentPackage.create({
        package_name: packageName,
        patient_id: patientId,
        document_signatures: signatureIds,
        status: 'pending',
        due_date: dueDate || null,
        sent_to_patient_at: new Date().toISOString(),
      });

      // Create version 1 record for each signature for audit trail
      let uploadedByEmail = '';
      try {
        uploadedByEmail = (await base44.auth.me()).email;
      } catch {
        // best-effort: version tracking is optional
      }
      for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i];
        const meta = signatureMeta[i] || {};
        await base44.entities.DocumentVersion.create({
          document_signature_id: sig.id,
          package_id: pkg.id,
          version_number: 1,
          document_name: meta.document_name || 'Document',
          document_type: meta.document_type || 'other',
          pdf_url: sig.document_url || sig.original_pdf_url || null,
          uploaded_by: uploadedByEmail,
          uploaded_at: new Date().toISOString(),
          change_reason: 'Initial document upload',
          is_current: true,
          signature_status_at_version: 'pending'
        }).catch(() => {
          // Version tracking is optional, don't fail the whole operation
        });
      }

      if (sendForSignature && signerEmail && signerName && signatures.length > 0) {
        const params = new URLSearchParams({ signature_id: signatures[0].id, patient_id: patientId || '' });
        const signatureUrl = `${window.location.origin}${createPageUrl(`SignDocument?${params.toString()}`)}`;

        await base44.integrations.Core.SendEmail({
          to: signerEmail,
          subject: `Signature Requested: ${packageName}`,
          body: `Hello ${signerName}

You have been requested to sign the following documents: ${packageName}

Patient: ${patientDisplayName || 'See package details'}

${signatureMessage ? `Message: ${signatureMessage}

` : ''}Please click the link below to review and sign:
${signatureUrl}

${dueDate ? `Due Date: ${new Date(dueDate).toLocaleDateString()}

` : ''}Thank you!`,
        });

        toast.success("Package created and signature request sent!");
      }

      return pkg;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-packages'] });
      queryClient.invalidateQueries({ queryKey: ['document-signatures-dashboard'] });
      toast.success("Document package created successfully!");
      resetForm();
      onClose();
    },
    onError: (error) => {
      toast.error(`Failed to create package: ${error.message}`);
    }
  });

  const resetForm = () => {
    setUseExistingPatient(true);
    setSelectedPatient(null);
    setManualPatientInfo({
      first_name: '',
      last_name: '',
      date_of_birth: '',
      email: '',
      phone: '',
      address: ''
    });
    setPackageName('');
    setDueDate('');
    setSelectedDocuments([]);
    setUploadedFiles([]);
    setSendForSignature(true);
    setSignerEmail('');
    setSignerName('');
    setSignatureMessage('');
  };

  const toggleDocument = (templateId) => {
    setSelectedDocuments(prev =>
      prev.includes(templateId)
        ? prev.filter(id => id !== templateId)
        : [...prev, templateId]
    );
  };

  const handleCreate = () => {
    if (useExistingPatient && !selectedPatient) {
      toast.error("Please select a patient");
      return;
    }

    if (!useExistingPatient) {
      if (!manualPatientInfo.first_name || !manualPatientInfo.last_name || !manualPatientInfo.date_of_birth) {
        toast.error("Please enter patient name and date of birth");
        return;
      }
    }

    if (!packageName || (selectedDocuments.length === 0 && uploadedFiles.length === 0)) {
      toast.error("Please fill in package name and select or upload at least one document");
      return;
    }

    if (sendForSignature && (!signerEmail || !signerName)) {
      toast.error("Please enter signer name and email for e-signature");
      return;
    }

    createPackageMutation.mutate();
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    const typeOk = files.filter(file => file.type === 'application/pdf');
    if (typeOk.length !== files.length) {
      toast.error("Only PDF files are allowed");
    }
    // Size guard (was missing): reject oversized PDFs before they're uploaded.
    const MAX_PDF_BYTES = 50 * 1024 * 1024;
    const pdfFiles = typeOk.filter(file => file.size <= MAX_PDF_BYTES);
    if (pdfFiles.length !== typeOk.length) {
      toast.error("Each PDF must be 50MB or smaller");
    }

    const newFiles = pdfFiles.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      file: file
    }));

    setUploadedFiles(prev => [...prev, ...newFiles]);
  };

  const removeUploadedFile = (fileId) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // Preset packages
  const presets = {
    admission: {
      name: 'Admission Onboarding',
      categories: ['consent', 'admission']
    },
    consent: {
      name: 'Consent Packet',
      categories: ['consent']
    },
    discharge: {
      name: 'Discharge Package',
      categories: ['discharge']
    },
    assessment: {
      name: 'Full Assessment',
      categories: ['assessment', 'care_plan']
    }
  };

  const applyPreset = (preset) => {
    const presetTemplates = templates.filter(t =>
      preset.categories.includes(t.template_category)
    ).map(t => t.id);

    setPackageName(preset.name);
    setSelectedDocuments(presetTemplates);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 w-[95vw] sm:w-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Package className="w-5 h-5" />
            Create Document Package
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-6">
          {/* Patient Selection Mode */}
          <div>
            <Label>Patient Information *</Label>
            <div className="flex gap-2 mt-2">
              <Button
                type="button"
                variant={useExistingPatient ? "default" : "outline"}
                size="sm"
                onClick={() => setUseExistingPatient(true)}
                className="flex-1"
              >
                Select Existing Patient
              </Button>
              <Button
                type="button"
                variant={!useExistingPatient ? "default" : "outline"}
                size="sm"
                onClick={() => setUseExistingPatient(false)}
                className="flex-1"
              >
                Enter Patient Info
              </Button>
            </div>
          </div>

          {/* Existing Patient Selection */}
          {useExistingPatient && (
            <div>
              <Label>Select Patient *</Label>
              <SearchablePatientSelect
                patients={patients}
                value={selectedPatient}
                onValueChange={setSelectedPatient}
              />
              {patients.length === 0 && <p className="text-xs text-amber-600 mt-2">No patients found. Create one or check access permissions.</p>}
              <p className="text-xs text-slate-500 mt-1">
                Patient data will auto-populate in documents
                {patients.length > 0 && ` (${patients.length} patients available)`}
              </p>
            </div>
          )}

          {/* Manual Patient Information */}
          {!useExistingPatient && (
            <div className="space-y-3 p-4 border rounded-lg bg-slate-50">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>First Name *</Label>
                  <Input
                    value={manualPatientInfo.first_name}
                    onChange={(e) => setManualPatientInfo({...manualPatientInfo, first_name: e.target.value})}
                    placeholder="Enter first name"
                  />
                </div>
                <div>
                  <Label>Last Name *</Label>
                  <Input
                    value={manualPatientInfo.last_name}
                    onChange={(e) => setManualPatientInfo({...manualPatientInfo, last_name: e.target.value})}
                    placeholder="Enter last name"
                  />
                </div>
              </div>
              <div>
                <Label>Date of Birth *</Label>
                <Input
                  type="date"
                  value={manualPatientInfo.date_of_birth}
                  onChange={(e) => setManualPatientInfo({...manualPatientInfo, date_of_birth: e.target.value})}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={manualPatientInfo.email}
                  onChange={(e) => setManualPatientInfo({...manualPatientInfo, email: e.target.value})}
                  placeholder="patient@example.com"
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  type="tel"
                  value={manualPatientInfo.phone}
                  onChange={(e) => setManualPatientInfo({...manualPatientInfo, phone: e.target.value})}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <Label>Address</Label>
                <Input
                  value={manualPatientInfo.address}
                  onChange={(e) => setManualPatientInfo({...manualPatientInfo, address: e.target.value})}
                  placeholder="123 Main St, City, State ZIP"
                />
              </div>
              <p className="text-xs text-slate-600">This information will be pre-filled in the documents</p>
            </div>
          )}

          {/* Package Name */}
          <div>
            <Label>Package Name *</Label>
            <Input
              placeholder="e.g., Admission Onboarding"
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
            />
          </div>

          {/* Due Date */}
          <div>
            <Label>Due Date (Optional)</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          {/* Presets */}
          <div>
            <Label>Quick Presets</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {Object.entries(presets).map(([key, preset]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(preset)}
                  className="flex-shrink-0"
                >
                  {preset.name}
                </Button>
              ))}
            </div>
          </div>

          {/* File Upload */}
          <div>
            <Label>Upload Additional Documents</Label>
            <p className="text-xs text-slate-500 mt-1 mb-2">Upload custom PDFs to include in this package</p>
            <div className="mt-2">
              <label htmlFor="file-upload" className="cursor-pointer">
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 hover:border-blue-400 hover:bg-blue-50 transition-all text-center">
                  <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-600">Click to upload PDF files</p>
                  <p className="text-xs text-slate-500 mt-1">or drag and drop</p>
                </div>
              </label>
              <input
                id="file-upload"
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />

              {uploadedFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  {uploadedFiles.map((file) => (
                    <div key={file.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <File className="w-4 h-4 text-blue-600 shrink-0" />
                        <span className="text-sm truncate">{file.name}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeUploadedFile(file.id)}
                        className="shrink-0"
                        >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
              ))}
                </div>
              )}
            </div>
          </div>

          {/* Document Selection */}
          <div>
            <Label>Or Select from Templates ({selectedDocuments.length} selected)</Label>
            <p className="text-xs text-slate-500 mt-1 mb-2">Patient information will auto-populate if patient exists in system</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 max-h-96 overflow-y-auto p-2 border rounded-lg">
              {templates.map((template) => (
                <div
                  key={template.id}
                  onClick={() => toggleDocument(template.id)}
                  className={`p-3 border rounded-lg cursor-pointer transition-all ${
                    selectedDocuments.includes(template.id)
                      ? 'bg-blue-50 border-blue-300'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {selectedDocuments.includes(template.id) ? (
                      <CheckSquare className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm break-words">{template.template_name}</h4>
                      <Badge variant="outline" className="mt-1 text-xs capitalize">
                        {template.template_category}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* E-Signature Options */}
          <div className="space-y-4 p-4 border rounded-lg bg-blue-50">
            <div className="flex items-center gap-2">
              <Checkbox
                id="send-signature"
                checked={sendForSignature}
                onCheckedChange={setSendForSignature}
              />
              <Label htmlFor="send-signature" className="cursor-pointer font-semibold">
                Send for E-Signature
              </Label>
            </div>

            {sendForSignature && (
              <div className="space-y-3 pl-6 border-l-2 border-blue-300">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Signer Name *</Label>
                    <Input
                      placeholder="Enter signer name"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Signer Email *</Label>
                    <Input
                      type="email"
                      placeholder="signer@email.com"
                      value={signerEmail}
                      onChange={(e) => setSignerEmail(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label>Message to Signer (Optional)</Label>
                  <Textarea
                    placeholder="Add a message to include with the signature request..."
                    value={signatureMessage}
                    onChange={(e) => setSignatureMessage(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-blue-700">
                  <Mail className="w-4 h-4" />
                  <span>Signer will receive an email with a link to review and sign documents</span>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => { resetForm(); onClose(); }}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createPackageMutation.isPending}
              className="w-full sm:w-auto"
            >
              <Send className="w-4 h-4 mr-2" />
              {createPackageMutation.isPending ? 'Creating...' : sendForSignature ? 'Create & Send' : 'Create Package'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
