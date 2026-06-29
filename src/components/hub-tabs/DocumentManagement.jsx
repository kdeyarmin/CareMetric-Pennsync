import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Upload, TrendingUp, Users, FolderOpen } from "lucide-react";
import DocumentUploader from "@/components/documents/DocumentUploader";
import DocumentList from "@/components/documents/DocumentList";

export default function DocumentManagement() {
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  const { data: documents = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: () => base44.entities.Document.list('-created_date', 500),
    initialData: []
  });

  const { data: _patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
    initialData: []
  });

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
        <Button onClick={() => setIsUploaderOpen(true)} size="lg">
          <Upload className="w-5 h-5 mr-2" />
          Upload Document
        </Button>
      </div>

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
              <DocumentList showPatientInfo={true} />
            </TabsContent>
            <TabsContent value="with-patient" className="mt-6">
              <DocumentList showPatientInfo={true} />
            </TabsContent>
            <TabsContent value="unassigned" className="mt-6">
              <DocumentList showPatientInfo={false} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <DocumentUploader
        open={isUploaderOpen}
        onOpenChange={setIsUploaderOpen}
        onUploadComplete={() => setIsUploaderOpen(false)}
      />
    </div>
  );
}