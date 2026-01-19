import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DocumentUploadManager from "../components/documents/DocumentUploadManager";
import DocumentList from "../components/documents/DocumentList";
import DocumentSigningWorkflow from "../components/signature/DocumentSigningWorkflow";
import { FileText, Upload, Signature } from "lucide-react";

export default function DocumentManagement() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
            <FileText className="w-8 h-8 text-blue-600" />
            Document Management
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Upload, organize, and sign documents with version control.
          </p>
        </div>

        <Tabs defaultValue="documents" className="space-y-6">
          <TabsList className="grid w-full max-w-3xl grid-cols-3">
            <TabsTrigger value="documents" className="gap-2">
              <FileText className="w-4 h-4" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="w-4 h-4" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="sign" className="gap-2">
              <Signature className="w-4 h-4" />
              Sign
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents">
            <DocumentList
              key={refreshTrigger}
              showSignatureOption={true}
            />
          </TabsContent>

          <TabsContent value="upload">
            <DocumentUploadManager
              onUploadComplete={() => setRefreshTrigger((t) => t + 1)}
            />
          </TabsContent>

          <TabsContent value="sign">
            <DocumentSigningWorkflow
              onSigningComplete={() => setRefreshTrigger((t) => t + 1)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}