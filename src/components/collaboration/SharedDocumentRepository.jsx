import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Upload, FileText, Eye, Download, MessageSquare, History,
  Share2, Lock, Search, Filter, Users, Plus, Clock
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SharedDocumentRepository({ currentUser, currentAgency }) {
  const queryClient = useQueryClient();
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);

  const [uploadData, setUploadData] = useState({
    document_name: "",
    document_type: "care_plan",
    description: "",
    shared_with_agencies: [],
    tags: [],
    related_patient_id: ""
  });

  const { data: agencies = [] } = useQuery({
    queryKey: ['allAgencies'],
    queryFn: () => base44.asServiceRole.entities.Agency.list(),
    enabled: !!currentUser
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['myPatients'],
    queryFn: () => base44.entities.Patient.list(),
    enabled: !!currentUser
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['sharedDocuments', currentAgency?.agency_code],
    queryFn: async () => {
      const owned = await base44.entities.SharedDocument.filter({ owner_agency_code: currentAgency.agency_code });
      const shared = await base44.entities.SharedDocument.list();
      return [...owned, ...shared.filter(d => d.shared_with_agencies?.includes(currentAgency.agency_code))]
        .filter((doc, index, self) => self.findIndex(d => d.id === doc.id) === index)
        .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    },
    enabled: !!currentAgency?.agency_code
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.SharedDocument.create({
        ...data,
        owner_agency_code: currentAgency.agency_code,
        current_version: 1,
        versions: [{
          version_number: 1,
          file_url: data.file_url,
          uploaded_by: currentUser.email,
          uploaded_date: new Date().toISOString(),
          change_notes: 'Initial upload'
        }],
        last_modified_by: currentUser.email,
        last_modified_date: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['sharedDocuments']);
      toast.success('Document uploaded successfully');
      setShowUpload(false);
      resetUpload();
    }
  });

  const addCommentMutation = useMutation({
    mutationFn: ({ docId, comment }) => {
      const doc = documents.find(d => d.id === docId);
      const newComments = [...(doc.comments || []), {
        commenter_email: currentUser.email,
        commenter_name: currentUser.full_name,
        comment_text: comment,
        timestamp: new Date().toISOString()
      }];
      return base44.entities.SharedDocument.update(docId, { comments: newComments });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['sharedDocuments']);
      toast.success('Comment added');
    }
  });

  const resetUpload = () => {
    setUploadData({
      document_name: "",
      document_type: "care_plan",
      description: "",
      shared_with_agencies: [],
      tags: [],
      related_patient_id: ""
    });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await uploadDocumentMutation.mutateAsync({ ...uploadData, file_url });
    } catch (error) {
      toast.error('Failed to upload file');
      console.error(error);
    }
    setUploadingFile(false);
  };

  const toggleAgencyAccess = (agencyCode) => {
    setUploadData(prev => ({
      ...prev,
      shared_with_agencies: prev.shared_with_agencies.includes(agencyCode)
        ? prev.shared_with_agencies.filter(a => a !== agencyCode)
        : [...prev.shared_with_agencies, agencyCode]
    }));
  };

  const filteredDocuments = documents.filter(doc =>
    doc.document_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!currentAgency) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-slate-600">Please select or join an agency to use document sharing</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Shared Documents</h2>
          <p className="text-sm text-slate-600">Collaborate on documents with other agencies</p>
        </div>
        <Button onClick={() => setShowUpload(true)} className="gap-2">
          <Upload className="w-4 h-4" />
          Upload Document
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDocuments.map((doc) => {
          const isOwner = doc.owner_agency_code === currentAgency.agency_code;
          const latestVersion = doc.versions?.[doc.versions.length - 1];

          return (
            <Card key={doc.id} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setSelectedDocument(doc)}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <CardTitle className="text-base">{doc.document_name}</CardTitle>
                  </div>
                  {isOwner && <Badge variant="outline">Owner</Badge>}
                </div>
                <CardDescription className="line-clamp-2">{doc.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className="capitalize">{doc.document_type.replace(/_/g, ' ')}</Badge>
                  <Badge variant="outline">v{doc.current_version}</Badge>
                </div>

                {doc.shared_with_agencies && doc.shared_with_agencies.length > 0 && (
                  <div className="flex items-center gap-1 text-xs text-slate-600">
                    <Share2 className="w-3 h-3" />
                    Shared with {doc.shared_with_agencies.length} {doc.shared_with_agencies.length === 1 ? 'agency' : 'agencies'}
                  </div>
                )}

                {doc.comments && doc.comments.length > 0 && (
                  <div className="flex items-center gap-1 text-xs text-slate-600">
                    <MessageSquare className="w-3 h-3" />
                    {doc.comments.length} {doc.comments.length === 1 ? 'comment' : 'comments'}
                  </div>
                )}

                <div className="text-xs text-slate-500">
                  Updated {format(new Date(doc.last_modified_date || doc.created_date), 'MMM d, yyyy')}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredDocuments.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 mb-4">No shared documents yet</p>
            <Button onClick={() => setShowUpload(true)}>Upload First Document</Button>
          </CardContent>
        </Card>
      )}

      {/* Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Shared Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Document Name</label>
              <Input
                value={uploadData.document_name}
                onChange={(e) => setUploadData({ ...uploadData, document_name: e.target.value })}
                placeholder="Enter document name..."
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Document Type</label>
              <Select value={uploadData.document_type} onValueChange={(value) => setUploadData({ ...uploadData, document_type: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="care_plan">Care Plan</SelectItem>
                  <SelectItem value="assessment">Assessment</SelectItem>
                  <SelectItem value="treatment_protocol">Treatment Protocol</SelectItem>
                  <SelectItem value="clinical_note">Clinical Note</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                  <SelectItem value="policy">Policy</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Description</label>
              <Textarea
                value={uploadData.description}
                onChange={(e) => setUploadData({ ...uploadData, description: e.target.value })}
                placeholder="Describe this document..."
                rows={3}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Share With Agencies</label>
              <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                {agencies.filter(a => a.agency_code !== currentAgency?.agency_code).map((agency) => (
                  <div
                    key={agency.id}
                    onClick={() => toggleAgencyAccess(agency.agency_code)}
                    className={`p-2 rounded cursor-pointer transition-colors ${
                      uploadData.shared_with_agencies.includes(agency.agency_code)
                        ? 'bg-blue-50 border border-blue-300'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{agency.agency_name}</span>
                      {uploadData.shared_with_agencies.includes(agency.agency_code) && (
                        <Share2 className="w-4 h-4 text-blue-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Upload File</label>
              <Input
                type="file"
                onChange={handleFileUpload}
                disabled={uploadingFile || !uploadData.document_name}
              />
              {uploadingFile && (
                <p className="text-sm text-blue-600 mt-2">Uploading...</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowUpload(false); resetUpload(); }}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Document Dialog */}
      <Dialog open={!!selectedDocument} onOpenChange={() => setSelectedDocument(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedDocument && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <DialogTitle className="text-xl mb-2">{selectedDocument.document_name}</DialogTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="capitalize">{selectedDocument.document_type.replace(/_/g, ' ')}</Badge>
                      <Badge variant="outline">Version {selectedDocument.current_version}</Badge>
                      {selectedDocument.owner_agency_code === currentAgency?.agency_code && (
                        <Badge className="bg-green-600">You Own This</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-sm font-medium mb-1">Description</p>
                  <p className="text-sm text-slate-700">{selectedDocument.description || 'No description'}</p>
                </div>

                {selectedDocument.shared_with_agencies && selectedDocument.shared_with_agencies.length > 0 && (
                  <div className="p-3 border rounded-lg">
                    <p className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Share2 className="w-4 h-4" />
                      Shared With:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedDocument.shared_with_agencies.map((code) => {
                        const agency = agencies.find(a => a.agency_code === code);
                        return (
                          <Badge key={code} variant="outline">
                            {agency?.agency_name || code}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedDocument.versions && selectedDocument.versions.length > 0 && (
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium flex items-center gap-2">
                        <History className="w-4 h-4" />
                        Version History ({selectedDocument.versions.length})
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowVersionHistory(true);
                        }}
                      >
                        View All
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {selectedDocument.versions.slice(-3).reverse().map((version) => (
                        <div key={version.version_number} className="flex items-center justify-between p-2 bg-slate-50 rounded text-sm">
                          <div>
                            <p className="font-medium">Version {version.version_number}</p>
                            <p className="text-xs text-slate-600">
                              by {version.uploaded_by} • {format(new Date(version.uploaded_date), 'MMM d, yyyy h:mm a')}
                            </p>
                          </div>
                          <Button size="sm" variant="ghost" asChild>
                            <a href={version.file_url} target="_blank" rel="noopener noreferrer">
                              <Download className="w-4 h-4" />
                            </a>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedDocument.comments && selectedDocument.comments.length > 0 && (
                  <div className="border rounded-lg p-4">
                    <p className="text-sm font-medium mb-3 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Comments ({selectedDocument.comments.length})
                    </p>
                    <div className="space-y-3 max-h-60 overflow-y-auto">
                      {selectedDocument.comments.map((comment, idx) => (
                        <div key={idx} className="p-3 bg-slate-50 rounded-lg">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-medium">{comment.commenter_name}</p>
                            <p className="text-xs text-slate-500">
                              {format(new Date(comment.timestamp), 'MMM d, h:mm a')}
                            </p>
                          </div>
                          <p className="text-sm text-slate-700">{comment.comment_text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium mb-2 block">Add Comment</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type your comment..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.target.value.trim()) {
                          addCommentMutation.mutate({ docId: selectedDocument.id, comment: e.target.value });
                          e.target.value = '';
                        }
                      }}
                    />
                    <Button size="icon" variant="outline">
                      <MessageSquare className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedDocument(null)}>
                  Close
                </Button>
                {selectedDocument.versions?.[selectedDocument.versions.length - 1]?.file_url && (
                  <Button asChild>
                    <a href={selectedDocument.versions[selectedDocument.versions.length - 1].file_url} target="_blank" rel="noopener noreferrer">
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </a>
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}