import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  FileText, 
  Upload, 
  Search,
  Filter,
  Download,
  Eye,
  Sparkles,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function DocumentHub({ patientId }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [analyzing, setAnalyzing] = useState(null);
  const queryClient = useQueryClient();

  const { data: documents, isLoading } = useQuery({
    queryKey: ['patient-documents', patientId],
    queryFn: () => base44.entities.PatientDocument.filter({ patient_id: patientId })
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: async (file) => {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      return await base44.entities.PatientDocument.create({
        patient_id: patientId,
        document_name: file.name,
        document_type: 'general',
        file_url,
        upload_date: new Date().toISOString(),
        uploaded_by: (await base44.auth.me()).email
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['patient-documents']);
      toast.success('Document uploaded successfully');
    },
    onError: (error) => {
      toast.error('Upload failed: ' + error.message);
    }
  });

  const analyzeDocumentMutation = useMutation({
    mutationFn: async (documentId) => {
      setAnalyzing(documentId);
      const doc = documents.find(d => d.id === documentId);
      
      const response = await base44.functions.invoke('analyzePatientDocument', {
        file_url: doc.file_url,
        document_type: doc.document_type
      });
      
      await base44.entities.PatientDocument.update(documentId, {
        ai_summary: response.data.summary,
        key_findings: response.data.key_findings,
        critical_items: response.data.critical_items,
        processing_status: 'completed'
      });
      
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['patient-documents']);
      setAnalyzing(null);
      toast.success('Document analyzed successfully');
    },
    onError: (error) => {
      setAnalyzing(null);
      toast.error('Analysis failed: ' + error.message);
    }
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    uploadDocumentMutation.mutate(file);
  };

  const filteredDocuments = documents?.filter(doc => {
    const matchesSearch = !searchQuery || 
      doc.document_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.ai_summary?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = filterType === 'all' || doc.document_type === filterType;
    
    return matchesSearch && matchesFilter;
  }) || [];

  const documentTypes = [...new Set(documents?.map(d => d.document_type) || [])];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Document Hub</h2>
        <div>
          <input
            type="file"
            onChange={handleFileUpload}
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            className="hidden"
            id="doc-upload"
          />
          <label htmlFor="doc-upload">
            <Button asChild disabled={uploadDocumentMutation.isPending}>
              <span>
                {uploadDocumentMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Document
                  </>
                )}
              </span>
            </Button>
          </label>
        </div>
      </div>

      {/* Search and Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {documentTypes.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : filteredDocuments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600 mb-4">No documents found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredDocuments.map(doc => (
            <Card key={doc.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="h-5 w-5 text-blue-600" />
                      <h3 className="font-semibold">{doc.document_name}</h3>
                      <Badge variant="outline">{doc.document_type}</Badge>
                      {doc.processing_status === 'completed' && (
                        <Badge className="bg-green-100 text-green-800">
                          <Sparkles className="h-3 w-3 mr-1" />
                          Analyzed
                        </Badge>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 mb-2">
                      Uploaded {new Date(doc.upload_date).toLocaleDateString()} by {doc.uploaded_by}
                    </p>

                    {doc.ai_summary && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mb-3">
                        <p className="text-sm font-medium text-blue-900 mb-1">AI Summary</p>
                        <p className="text-sm text-blue-800">{doc.ai_summary}</p>
                      </div>
                    )}

                    {doc.critical_items && doc.critical_items.length > 0 && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-3">
                        <p className="text-sm font-medium text-red-900 mb-2 flex items-center gap-1">
                          <AlertCircle className="h-4 w-4" />
                          Critical Findings
                        </p>
                        <ul className="space-y-1">
                          {doc.critical_items.map((item, idx) => (
                            <li key={idx} className="text-sm text-red-800">• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {doc.key_findings && doc.key_findings.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-medium text-slate-700 mb-1">Key Findings:</p>
                        <div className="flex flex-wrap gap-2">
                          {doc.key_findings.map((finding, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {finding}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {!doc.ai_summary && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => analyzeDocumentMutation.mutate(doc.id)}
                        disabled={analyzing === doc.id}
                      >
                        {analyzing === doc.id ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-2" />
                            Analyze
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(doc.file_url, '_blank')}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}