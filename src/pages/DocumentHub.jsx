import { lazy, Suspense, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, FileText, Pen, FolderOpen, ClipboardCheck, BarChart3, BookOpen, Archive, Loader2,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import EmbeddedPage from "@/components/ui/embeddedPage";
import TemplateLibrary from "@/components/documents/TemplateLibrary";
import PDFTemplateBuilder from "@/components/documents/PDFTemplateBuilder";
import DocumentAnalytics from "@/components/documents/DocumentAnalytics";
import { isSuperAdmin } from "@/lib/superAdmin";

const DocumentSignatures = lazy(() => import("@/components/hub-tabs/DocumentSignatures"));
const CreateSignatureRequest = lazy(() => import("@/components/hub-tabs/CreateSignatureRequest"));
const BulkSignatureRequests = lazy(() => import("@/components/hub-tabs/BulkSignatureRequests"));
const DocumentManagement = lazy(() => import("@/components/hub-tabs/DocumentManagement"));
const DocumentIngestion = lazy(() => import("@/components/hub-tabs/DocumentIngestion"));
const DischargeSummaries = lazy(() => import("@/components/hub-tabs/DischargeSummaries"));
const DocumentAuditLogs = lazy(() => import("@/components/hub-tabs/DocumentAuditLogs"));

// Hub tab keys, kept in sync with the TabsTrigger values below. Used to validate
// the ?tab= deep-link so the retired standalone pages (Document Signatures,
// Document Management, Discharge Summaries, etc.) can redirect straight to the
// right tab. "audit" is admin-only and is appended at render time.
const TAB_KEYS = ["signatures", "documents", "discharge", "library", "analytics"];

const SpokeFallback = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

export default function DocumentHub() {
  const [showTemplateBuilder, setShowTemplateBuilder] = useState(false);

  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin' || isSuperAdmin(currentUser);

  const validTabKeys = isAdmin ? [...TAB_KEYS, "audit"] : TAB_KEYS;

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const requestedView = searchParams.get("view");
  // Until auth resolves, honor a requested admin tab (the Audit content stays
  // gated below) so an admin deep-linking to ?tab=audit isn't canonicalized away
  // before currentUser loads.
  const activeTab = isUserLoading
    ? ([...TAB_KEYS, "audit"].includes(requestedTab) ? requestedTab : "signatures")
    : (validTabKeys.includes(requestedTab) ? requestedTab : "signatures");

  // Nested sub-tab selection, driven by ?view= so deep links (e.g. a retired
  // /CreateSignatureRequest or /DocumentIngestion bookmark) open the right inner
  // workflow instead of the sub-tab default.
  const SIGNATURE_VIEWS = ["all", "create", "bulk"];
  const DOCUMENT_VIEWS = ["storage", "intake"];
  const signatureView = SIGNATURE_VIEWS.includes(requestedView) ? requestedView : "all";
  const documentView = DOCUMENT_VIEWS.includes(requestedView) ? requestedView : "storage";
  const handleViewChange = (view) => setSearchParams({ tab: activeTab, view });

  // Reflect the active tab in the URL so hub tabs are shareable/bookmarkable and
  // redirects from the retired pages deep-link correctly. "signatures" is the
  // default, so it stays a clean /DocumentHub with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "signatures" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= so the
  // default tab is plain /DocumentHub. Skipped while a meaningful ?view= is
  // present (a deep-linked sub-tab) and until auth resolves.
  useEffect(() => {
    if (!isUserLoading && requestedTab !== null && activeTab === "signatures" && !requestedView) {
      setSearchParams({}, { replace: true });
    }
  }, [isUserLoading, requestedTab, activeTab, requestedView, setSearchParams]);

  return (
    <PageContainer>
      <PageHeader
        icon={FileText}
        eyebrow="Documentation"
        title="Document Hub"
        description="Manage signatures, documents, discharge summaries, templates, and analytics"
        favoritePage="DocumentHub"
        actions={activeTab === "library" && isAdmin && (
          <Button
            onClick={() => setShowTemplateBuilder(true)}
            variant="outline"
            className="w-full sm:w-auto min-h-[44px]"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Template
          </Button>
        )}
      />

      <EmbeddedPage>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="signatures" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Pen className="h-4 w-4 mr-2" />
              Signatures
            </TabsTrigger>
            <TabsTrigger value="documents" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <FolderOpen className="h-4 w-4 mr-2" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="discharge" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <ClipboardCheck className="h-4 w-4 mr-2" />
              Discharge Summaries
            </TabsTrigger>
            <TabsTrigger value="library" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BookOpen className="h-4 w-4 mr-2" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="analytics" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BarChart3 className="h-4 w-4 mr-2" />
              Analytics
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="audit" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                <Archive className="h-4 w-4 mr-2" />
                Audit Logs
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* Signatures Tab — All / Create / Bulk sub-tabs */}
        <TabsContent value="signatures" className="space-y-6">
          <Tabs value={signatureView} onValueChange={handleViewChange} className="space-y-4">
            <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
              <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
                <TabsTrigger value="all" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  All Signatures
                </TabsTrigger>
                <TabsTrigger value="create" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  Create
                </TabsTrigger>
                <TabsTrigger value="bulk" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  Bulk
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="all">
              <Suspense fallback={SpokeFallback}>
                <DocumentSignatures />
              </Suspense>
            </TabsContent>
            <TabsContent value="create">
              <Suspense fallback={SpokeFallback}>
                <CreateSignatureRequest />
              </Suspense>
            </TabsContent>
            <TabsContent value="bulk">
              <Suspense fallback={SpokeFallback}>
                <BulkSignatureRequests />
              </Suspense>
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Documents Tab — Storage / Intake sub-tabs */}
        <TabsContent value="documents" className="space-y-6">
          <Tabs value={documentView} onValueChange={handleViewChange} className="space-y-4">
            <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
              <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
                <TabsTrigger value="storage" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  Storage
                </TabsTrigger>
                <TabsTrigger value="intake" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  Intake
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="storage">
              <Suspense fallback={SpokeFallback}>
                <DocumentManagement />
              </Suspense>
            </TabsContent>
            <TabsContent value="intake">
              <Suspense fallback={SpokeFallback}>
                <DocumentIngestion />
              </Suspense>
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Discharge Summaries Tab */}
        <TabsContent value="discharge" className="space-y-6">
          <Suspense fallback={SpokeFallback}>
            <DischargeSummaries />
          </Suspense>
        </TabsContent>

        {/* Templates Tab */}
        <TabsContent value="library" className="space-y-6">
          <TemplateLibrary />

          <PDFTemplateBuilder
            open={showTemplateBuilder}
            onClose={() => setShowTemplateBuilder(false)}
          />
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <DocumentAnalytics />
        </TabsContent>

        {/* Audit Logs Tab (Admin Only) */}
        {isAdmin && (
          <TabsContent value="audit" className="space-y-6">
            <Suspense fallback={SpokeFallback}>
              <DocumentAuditLogs />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>
      </EmbeddedPage>
    </PageContainer>
  );
}
