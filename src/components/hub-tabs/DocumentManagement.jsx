import { useState } from "react";
import { useAuthorizedDocuments } from '@/hooks/useAuthorizedDocuments';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Upload, TrendingUp, Users, FolderOpen, ShieldAlert } from "lucide-react";
import DocumentUploader from "@/components/documents/DocumentUploader";
import DocumentList from "@/components/documents/DocumentList";

export default function DocumentManagement() {
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  const documentQuery = useAuthorizedDocuments();
  const documents = documentQuery.data;
  const agencyId = documentQuery.tenantScope?.agency_id || null;

  const stats = {
    total: documents.length,
    withPatient: documents.filter(d => d.patient_id).length,
    withoutPatient: documents.filter(d => !d.patient_id).length,
    sensitive: documents.filter(d => d.is_sensitive).length
  };

  const categoryCounts = documents.reduce((acc, doc) => {
    acc[doc.category] = (acc[doc.category] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex justify-end">
        <Button
          onClick={() => setIsUploaderOpen(true)}
          size="lg"
          disabled={!agencyId}
        >
          <Upload className="w-5 h-5 mr-2" />
          Upload Document
        </Button>
      </div>

      {documentQuery.isError && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-amber-900">
            <ShieldAlert className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
            Documents are unavailable until a current agency and document grant can be verified.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Documents</p>
                <p className="text-3xl font-bold text-slate-900">{stats.total}</p>
              </div>
              <FileText className="w-8 h-8 text-navy-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">With Patient</p>
                <p className="text-3xl font-bold text-slate-900">{stats.withPatient}</p>
              </div>
              <Users className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Unassigned</p>
                <p className="text-3xl font-bold text-slate-900">{stats.withoutPatient}</p>
              </div>
              <FolderOpen className="w-8 h-8 text-amber-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Sensitive</p>
                <p className="text-3xl font-bold text-slate-900">{stats.sensitive}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Documents by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(categoryCounts).map(([category, count]) => (
              <div key={category} className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-2xl font-bold text-navy-600">{count}</p>
                <p className="text-xs text-slate-600 mt-1 capitalize">{category.replace(/_/g, ' ')}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="all">All Documents</TabsTrigger>
              <TabsTrigger value="with-patient">With Patient</TabsTrigger>
              <TabsTrigger value="unassigned">Unassigned</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="mt-6">
              <DocumentList
                documents={documents}
                agencyId={agencyId}
                isLoading={documentQuery.isLoading}
                showPatientInfo={true}
              />
            </TabsContent>
            <TabsContent value="with-patient" className="mt-6">
              <DocumentList
                documents={documents}
                agencyId={agencyId}
                isLoading={documentQuery.isLoading}
                showPatientInfo={true}
                assignment="with_patient"
              />
            </TabsContent>
            <TabsContent value="unassigned" className="mt-6">
              <DocumentList
                documents={documents}
                agencyId={agencyId}
                isLoading={documentQuery.isLoading}
                showPatientInfo={false}
                assignment="unassigned"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <DocumentUploader
        agencyId={agencyId}
        open={isUploaderOpen}
        onOpenChange={setIsUploaderOpen}
        onUploadComplete={() => setIsUploaderOpen(false)}
      />
    </div>
  );
}
