import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, FileText, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { validateFileUpload } from '@/components/utils/security';
import {
  createAuthorizedDocument,
  createDocumentRequestId,
} from '@/functions/createAuthorizedDocument';
import { useScopedPatients } from '@/hooks/useScopedPatients';

const PURPOSES = [
  {
    value: 'patient_document',
    label: 'Patient document',
    description: 'Private clinical file linked to an authorized patient.',
  },
  {
    value: 'referral',
    label: 'Referral',
    description: 'Private referral file; a patient link is optional.',
  },
];

export default function DocumentUploader({
  agencyId,
  patientId,
  onUploadComplete,
  open,
  onOpenChange,
}) {
  const [file, setFile] = useState(null);
  const [purpose, setPurpose] = useState('patient_document');
  const [selectedPatientId, setSelectedPatientId] = useState(patientId || '');
  const requestIdRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: allPatients = [] } = useScopedPatients({
    agencyId: agencyId || undefined,
    sort: '-updated_date',
    limit: 2000,
    enabled: open && !patientId && !!agencyId,
    readMode: 'authorized-roster',
  });

  useEffect(() => {
    setSelectedPatientId(patientId || '');
    requestIdRef.current = null;
  }, [agencyId, patientId]);

  const resetRequestIdentity = () => {
    requestIdRef.current = null;
  };

  const resetForm = () => {
    setFile(null);
    setPurpose('patient_document');
    if (!patientId) setSelectedPatientId('');
    resetRequestIdentity();
  };

  const uploadMutation = useMutation({
    mutationFn: ({ uploadFile, uploadPurpose, uploadPatientId, clientRequestId }) => (
      createAuthorizedDocument({
        file: uploadFile,
        agencyId,
        patientId: uploadPatientId || null,
        purpose: uploadPurpose,
        clientRequestId,
      })
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Document uploaded successfully');
      resetForm();
      onUploadComplete?.();
      onOpenChange?.(false);
    },
    onError: () => {
      // Keep the request id for an exact manual retry. The broker binds that id
      // to tenant, patient, purpose, file metadata, and content hash.
      toast.error('The private document upload could not be authorized');
    },
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!agencyId) {
      toast.error('Select an authorized agency before uploading');
      return;
    }
    if (!file) {
      toast.error('Please select a file');
      return;
    }
    if (purpose === 'patient_document' && !selectedPatientId) {
      toast.error('Select a patient for a patient document');
      return;
    }
    const check = validateFileUpload(file, {
      maxSize: 25 * 1024 * 1024,
      allowedTypes: ['application/pdf', 'image/png', 'image/jpeg'],
      allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg'],
    });
    if (!check.valid) {
      toast.error(check.error);
      return;
    }

    requestIdRef.current ||= createDocumentRequestId();
    uploadMutation.mutate({
      uploadFile: file,
      uploadPurpose: purpose,
      uploadPatientId: selectedPatientId,
      clientRequestId: requestIdRef.current,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Private Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>File *</Label>
            <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-indigo-500 transition-colors">
              <input
                type="file"
                id="file-upload"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  resetRequestIdentity();
                }}
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                {file ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="w-8 h-8 text-indigo-600" />
                    <div>
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-slate-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-12 h-12 mx-auto text-slate-400 mb-2" />
                    <p className="text-sm text-slate-600">Choose a PDF, PNG, or JPEG up to 25 MB</p>
                  </div>
                )}
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Document purpose *</Label>
            <Select
              value={purpose}
              onValueChange={(value) => {
                setPurpose(value);
                resetRequestIdentity();
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PURPOSES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              {PURPOSES.find((item) => item.value === purpose)?.description}
            </p>
          </div>

          {!patientId && (
            <div className="space-y-2">
              <Label>Patient {purpose === 'patient_document' ? '*' : '(Optional)'}</Label>
              <Select
                value={selectedPatientId || 'none'}
                onValueChange={(value) => {
                  setSelectedPatientId(value === 'none' ? '' : value);
                  resetRequestIdentity();
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select patient" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled={purpose === 'patient_document'}>
                    {purpose === 'patient_document' ? 'Select a patient' : 'No patient'}
                  </SelectItem>
                  {allPatients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.first_name} {patient.last_name} - MRN: {patient.medical_record_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
            <p className="text-sm text-amber-900">
              Files are stored privately. The original filename becomes the document title;
              viewing and downloading require a fresh authorization check.
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="submit"
              disabled={uploadMutation.isPending || !agencyId}
              className="flex-1"
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Document
                </>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
