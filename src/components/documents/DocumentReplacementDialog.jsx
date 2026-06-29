import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Upload, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function DocumentReplacementDialog({
  open,
  onClose,
  documentSignature,
  packageId,
}) {
  const queryClient = useQueryClient();
  const [newFile, setNewFile] = useState(null);
  const [changeReason, setChangeReason] = useState('');
  const [carryForwardSignatures, setCarryForwardSignatures] = useState(false);

  const replaceMutation = useMutation({
    mutationFn: async () => {
      if (!newFile) {
        throw new Error('Please select a document to upload');
      }

      if (!changeReason.trim()) {
        throw new Error('Please provide a reason for the document update');
      }

      // Upload new PDF
      const { file_url } = await base44.integrations.Core.UploadFile({
        file: newFile,
      });

      // Get current version number to create next version
      const existingVersions = await base44.entities.DocumentVersion.filter({
        document_signature_id: documentSignature.id,
      });

      // filter() returns no guaranteed order, so don't assume [0] is current and
      // don't derive the next number from length (which collides after a deletion).
      const currentVersion = existingVersions.find((v) => v.is_current) || null;
      const maxVersionNumber = existingVersions.reduce(
        (max, v) => Math.max(max, v.version_number || 0),
        0
      );
      const nextVersionNumber = maxVersionNumber + 1;

      // Mark current version as not current
      if (currentVersion) {
        await base44.entities.DocumentVersion.update(currentVersion.id, {
          is_current: false,
        });
      }

      // Create new version record
      const newVersion = await base44.entities.DocumentVersion.create({
        document_signature_id: documentSignature.id,
        package_id: packageId,
        version_number: nextVersionNumber,
        document_name: documentSignature.document_name,
        document_type: documentSignature.document_type,
        pdf_url: file_url,
        uploaded_by: (await base44.auth.me()).email,
        uploaded_at: new Date().toISOString(),
        change_reason: changeReason,
        is_current: true,
        signature_status_at_version: documentSignature.status,
        invalidated_previous_signatures: !carryForwardSignatures,
        signatures_carried_forward: carryForwardSignatures,
        previous_version_id: currentVersion ? currentVersion.id : null,
      });

      // Update document signature to point to new PDF. The active source PDF is
      // stored on the `document_url` field (the only PDF-url field the
      // DocumentSignature schema defines and the one every signer read path
      // consumes); writing the non-schema `original_pdf_url` was silently dropped,
      // so the signer kept seeing the stale original.
      await base44.entities.DocumentSignature.update(documentSignature.id, {
        document_url: file_url,
        status: carryForwardSignatures ? documentSignature.status : 'pending',
      });

      return newVersion;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-versions'] });
      queryClient.invalidateQueries({ queryKey: ['document-signatures'] });
      queryClient.invalidateQueries({ queryKey: ['document-packages'] });
      toast.success('Document updated successfully. Version history preserved.');
      resetForm();
      onClose();
    },
    onError: (error) => {
      toast.error(`Failed to update document: ${error.message}`);
    },
  });

  const resetForm = () => {
    setNewFile(null);
    setChangeReason('');
    setCarryForwardSignatures(false);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        toast.error('Only PDF files are allowed');
        return;
      }
      setNewFile(file);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        resetForm();
        onClose();
      }
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Document</DialogTitle>
          <DialogDescription>
            Replace this document with a new version while maintaining audit trail and signature history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Upload */}
          <div>
            <Label>Upload New Document *</Label>
            <div className="mt-2">
              <label htmlFor="doc-upload" className="cursor-pointer">
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 hover:border-blue-400 hover:bg-blue-50 transition-all text-center">
                  <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-600">
                    {newFile ? newFile.name : 'Click to upload PDF'}
                  </p>
                </div>
              </label>
              <input
                id="doc-upload"
                type="file"
                accept=".pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>

          {/* Change Reason */}
          <div>
            <Label>Reason for Update *</Label>
            <Textarea
              placeholder="e.g., Corrected patient date of birth, Updated insurance information"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>

          {/* Signature Carry Forward Option */}
          <div className="space-y-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <Label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={carryForwardSignatures}
                    onCheckedChange={setCarryForwardSignatures}
                  />
                  <span className="text-sm font-medium">
                    Existing signatures remain valid
                  </span>
                </Label>
                <p className="text-xs text-amber-700 mt-1">
                  If unchecked, previous signatures will be invalidated and new signatures will be required.
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                onClose();
              }}
              className="flex-1"
              disabled={replaceMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => replaceMutation.mutate()}
              disabled={replaceMutation.isPending || !newFile}
              className="flex-1"
            >
              {replaceMutation.isPending ? 'Updating...' : 'Update Document'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}