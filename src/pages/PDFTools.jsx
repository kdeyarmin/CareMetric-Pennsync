import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PDFEditor from "../components/documents/PDFEditor";
import PDFMerger from "../components/documents/PDFMerger";
import PDFPageManager from "../components/documents/PDFPageManager";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pencil, Combine, Settings, FileText, Upload } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { toast } from "sonner";

export default function PDFTools() {
  const [pdfUrl, setPdfUrl] = useState('');
  const [tempUrl, setTempUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');

  const handleLoadPdf = () => {
    if (!tempUrl.trim()) {
      toast.error("Please enter a PDF URL");
      return;
    }
    setPdfUrl(tempUrl);
    setResultUrl('');
  };

  const handleComplete = (url) => {
    setResultUrl(url);
    setPdfUrl('');
    toast.success("PDF ready! You can now view or download it.");
  };

  return (
    <PageContainer>
      <PageHeader
        icon={FileText}
        eyebrow="Documentation"
        title="PDF Tools"
        description="Edit, merge, and manage PDF documents with powerful tools"
        favoritePage="PDFTools"
      />

      <Tabs defaultValue="edit" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="edit" className="flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Annotate PDF
          </TabsTrigger>
          <TabsTrigger value="merge" className="flex items-center gap-2">
            <Combine className="w-4 h-4" />
            Merge PDFs
          </TabsTrigger>
          <TabsTrigger value="manage" className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Manage Pages
          </TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="space-y-4 mt-6">
          {!pdfUrl ? (
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <Label htmlFor="edit-url">PDF URL</Label>
                  <div className="flex gap-2 mt-2">
                    <Input
                      id="edit-url"
                      placeholder="Enter PDF URL to annotate"
                      value={tempUrl}
                      onChange={(e) => setTempUrl(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleLoadPdf()}
                    />
                    <Button onClick={handleLoadPdf}>
                      <Upload className="w-4 h-4 mr-2" />
                      Load PDF
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <PDFEditor pdfUrl={pdfUrl} onSave={handleComplete} />
          )}
        </TabsContent>

        <TabsContent value="merge" className="mt-6">
          <PDFMerger onMergeComplete={handleComplete} />
        </TabsContent>

        <TabsContent value="manage" className="space-y-4 mt-6">
          {!pdfUrl ? (
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <Label htmlFor="manage-url">PDF URL</Label>
                  <div className="flex gap-2 mt-2">
                    <Input
                      id="manage-url"
                      placeholder="Enter PDF URL to manage pages"
                      value={tempUrl}
                      onChange={(e) => setTempUrl(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleLoadPdf()}
                    />
                    <Button onClick={handleLoadPdf}>
                      <Upload className="w-4 h-4 mr-2" />
                      Load PDF
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <PDFPageManager pdfUrl={pdfUrl} onSave={handleComplete} />
          )}
        </TabsContent>
      </Tabs>

      {/* Result Display */}
      {resultUrl && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <FileText className="w-8 h-8 text-emerald-600 shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-emerald-900 mb-2">
                  PDF Ready!
                </h3>
                <p className="text-sm text-emerald-700 mb-4">
                  Your PDF has been processed successfully. You can now view or download it.
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => window.open(resultUrl, '_blank')}
                    variant="outline"
                    className="border-emerald-600 text-emerald-700 hover:bg-emerald-100"
                  >
                    View PDF
                  </Button>
                  <Button
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = resultUrl;
                      link.download = `processed-${Date.now()}.pdf`;
                      link.click();
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    Download PDF
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}