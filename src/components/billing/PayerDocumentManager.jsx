import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { Upload, FileText, Download, Trash2, Loader2, Calendar } from 'lucide-react';
import { toast } from 'sonner';

export default function PayerDocumentManager({ payerId }) {
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    document_type: 'fee_schedule',
    document_name: '',
    description: '',
    effective_date: '',
    expiration_date: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);

  const queryClient = useQueryClient();

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['payerDocuments', payerId],
    queryFn: async () => {
      return await base44.entities.PayerDocument.filter({ payer_id: payerId }, '-created_date');
    },
    enabled: !!payerId
  });

  const deleteMutation = useMutation({
    mutationFn: (docId) => base44.entities.PayerDocument.delete(docId),
    onSuccess: () => {
      queryClient.invalidateQueries(['payerDocuments', payerId]);
      toast.success('Document deleted');
    }
  });

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!formData.document_name) {
        setFormData({ ...formData, document_name: file.name });
      }
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      toast.error('Please select a file');
      return;
    }

    setUploading(true);
    try {
      // Upload file
      const uploadResponse = await base44.integrations.Core.UploadFile({ file: selectedFile });
      const fileUrl = uploadResponse.file_url;

      // Create document record
      await base44.entities.PayerDocument.create({
        payer_id: payerId,
        document_type: formData.document_type,
        document_name: formData.document_name,
        description: formData.description,
        file_url: fileUrl,
        file_size: selectedFile.size,
        effective_date: formData.effective_date || null,
        expiration_date: formData.expiration_date || null
      });

      queryClient.invalidateQueries(['payerDocuments', payerId]);
      toast.success('Document uploaded successfully');

      // Reset form
      setFormData({
        document_type: 'fee_schedule',
        document_name: '',
        description: '',
        effective_date: '',
        expiration_date: ''
      });
      setSelectedFile(null);
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const documentTypes = {
    fee_schedule: 'Fee Schedule',
    policy_manual: 'Policy Manual',
    provider_agreement: 'Provider Agreement',
    billing_guidelines: 'Billing Guidelines',
    authorization_form: 'Authorization Form',
    claim_form: 'Claim Form',
    other: 'Other'
  };

  return (
    <div className="space-y-6">
      {/* Upload Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Document
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Document Type *</Label>
                <Select
                  value={formData.document_type}
                  onValueChange={(val) => setFormData({ ...formData, document_type: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(documentTypes).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Document Name *</Label>
                <Input
                  value={formData.document_name}
                  onChange={(e) => setFormData({ ...formData, document_name: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Effective Date</Label>
                <Input
                  type="date"
                  value={formData.effective_date}
                  onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                />
              </div>
              <div>
                <Label>Expiration Date</Label>
                <Input
                  type="date"
                  value={formData.expiration_date}
                  onChange={(e) => setFormData({ ...formData, expiration_date: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Select File *</Label>
              <Input
                type="file"
                onChange={handleFileSelect}
                accept=".pdf,.doc,.docx,.xls,.xlsx"
                required
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground mt-1">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            <Button type="submit" disabled={uploading}>
              {uploading ? (
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
          </form>
        </CardContent>
      </Card>

      {/* Documents List */}
      <Card>
        <CardHeader>
          <CardTitle>Uploaded Documents ({documents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center py-4 text-muted-foreground">Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground">No documents uploaded yet</p>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-3 flex-1">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{doc.document_name}</p>
                        <Badge variant="outline" className="text-xs">
                          {documentTypes[doc.document_type]}
                        </Badge>
                      </div>
                      {doc.description && (
                        <p className="text-xs text-muted-foreground">{doc.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {doc.effective_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Effective: {new Date(doc.effective_date).toLocaleDateString()}
                          </span>
                        )}
                        {doc.file_size && (
                          <span>{(doc.file_size / 1024).toFixed(1)} KB</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(doc.file_url, '_blank')}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm('Delete this document?')) {
                          deleteMutation.mutate(doc.id);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}