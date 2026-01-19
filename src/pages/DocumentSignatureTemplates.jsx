import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import EnhancedDocumentTemplateManager from "../components/signature/EnhancedDocumentTemplateManager";
import SignatureWorkflowAutomation from "../components/signature/SignatureWorkflowAutomation";
import DocumentAnalyticsDashboard from "../components/documents/DocumentAnalyticsDashboard";
import DocumentTemplateFiller from "../components/signature/DocumentTemplateFiller";
import DocumentAutomationBuilder from "../components/documents/DocumentAutomationBuilder";
import DocumentAutomationDashboard from "../components/documents/DocumentAutomationDashboard";
import DocumentEmbedGenerator from "../components/documents/DocumentEmbedGenerator";
import { FileText, Edit, Send, Zap, Code } from "lucide-react";

export default function DocumentSignatureTemplates() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
            <FileText className="w-8 h-8 text-blue-600" />
            Document Signature Templates
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Create reusable templates for common documents with signature fields
            and dynamic placeholders.
          </p>
        </div>

        <Tabs defaultValue="manage" className="space-y-6">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="manage" className="gap-2">
              <Edit className="w-4 h-4" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="workflows" className="gap-2">
              ⚡ Workflows
            </TabsTrigger>
            <TabsTrigger value="automation" className="gap-2">
              <Zap className="w-4 h-4" />
              Automation
            </TabsTrigger>
            <TabsTrigger value="automation-dashboard" className="gap-2">
              📊 Auto-Status
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2">
              📊 Analytics
            </TabsTrigger>
            <TabsTrigger value="use" className="gap-2">
              <Send className="w-4 h-4" />
              Use
            </TabsTrigger>
          </TabsList>

          <TabsContent value="manage">
            <EnhancedDocumentTemplateManager key={refreshTrigger} />
          </TabsContent>
          <TabsContent value="workflows">
            <SignatureWorkflowAutomation />
          </TabsContent>
          <TabsContent value="automation">
            <DocumentAutomationBuilder />
          </TabsContent>
          <TabsContent value="automation-dashboard">
            <DocumentAutomationDashboard />
          </TabsContent>
          <TabsContent value="analytics">
            <DocumentAnalyticsDashboard />
          </TabsContent>

          <TabsContent value="use">
            <DocumentTemplateFiller
              onDocumentSigned={() => setRefreshTrigger((t) => t + 1)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}