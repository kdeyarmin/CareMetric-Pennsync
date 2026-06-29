import { lazy, Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClipboardCheck,
  Brain,
  Search,
  ClipboardList,
  Stethoscope,
  Shield,
  BarChart3,
  TrendingUp,
  Eye,
  Loader2,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import EmbeddedPage from "@/components/ui/embeddedPage";
import { isSuperAdmin } from "@/lib/superAdmin";

const SmartOASISAssessment = lazy(() => import("@/components/hub-tabs/SmartOASISAssessment"));
const OASISAnalyzer = lazy(() => import("@/components/hub-tabs/OASISAnalyzer"));
const OASISReview = lazy(() => import("@/components/hub-tabs/OASISReview"));
const OASISClinicalReview = lazy(() => import("@/components/hub-tabs/OASISClinicalReview"));
const OASISComplianceReview = lazy(() => import("@/components/hub-tabs/OASISComplianceReview"));
const OASISDocumentationReview = lazy(() => import("@/components/hub-tabs/OASISDocumentationReview"));
const OASISRevenueAnalysis = lazy(() => import("@/components/hub-tabs/OASISRevenueAnalysis"));
const OASISAnalyticsDashboard = lazy(() => import("@/components/hub-tabs/OASISAnalyticsDashboard"));
const OASISAuditDashboard = lazy(() => import("@/components/hub-tabs/OASISAuditDashboard"));

// Tab keys, kept in sync with the TabsTrigger values below. Used to validate the
// ?tab= deep-link so the retired standalone pages (Assessment, Analyzer, Review,
// Clinical, Compliance, Documentation, Analytics, Audit) redirect to the
// right tab. "assessment" (completing an OASIS) is the default landing tab.
// "audit" is admin-only and intentionally part of the set so admins can deep-link
// to it; non-admins who request it fall through to the default tab below.
const TAB_KEYS = ["assessment", "analyze", "review", "clinical", "quality", "revenue", "analytics", "audit"];
// Tabs whose source pages were admin-only — gated to admins (defense in depth;
// server RLS remains the real boundary). Non-admins requesting these via ?tab=
// fall through to the default tab. Revenue (AI OASIS revenue-uplift review) is
// admin-only and intentionally hidden from nurses.
const ADMIN_TABS = ["revenue", "analytics", "audit"];

const tabLoader = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

export default function OASISCenter() {
  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin' || isSuperAdmin(currentUser);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  // Resolve the active tab, defaulting to "assessment". The audit tab is
  // admin-only, so a non-admin requesting ?tab=audit resolves to the default tab.
  let activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "assessment";
  // Wait for auth before canonicalizing an admin tab away: on first render
  // currentUser is undefined (isAdmin false), so an admin deep-linking to e.g.
  // ?tab=revenue must keep that tab until the user query resolves — otherwise the
  // effect below would strip the param and drop them on Assessment. The admin-only
  // tab *content* stays gated regardless.
  if (!isUserLoading && ADMIN_TABS.includes(activeTab) && !isAdmin) {
    activeTab = "assessment";
  }

  // Reflect the active tab in the URL so tabs are shareable/bookmarkable and
  // redirects from the retired pages deep-link correctly. "assessment" is the
  // default, so it stays a clean /OASISCenter with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "assessment" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= (e.g. a
  // bookmarked ?tab=assessment, a stale tab key, or ?tab=audit for a non-admin) so
  // the default tab is plain /OASISCenter. Only fires when the param resolved to
  // the default tab, so a valid deep-link like ?tab=review is left untouched.
  useEffect(() => {
    if (!isUserLoading && requestedTab !== null && activeTab === "assessment") {
      setSearchParams({}, { replace: true });
    }
  }, [isUserLoading, requestedTab, activeTab, setSearchParams]);

  return (
    <PageContainer>
      <PageHeader
        icon={ClipboardCheck}
        eyebrow="OASIS"
        title="OASIS Center"
        description="Complete, analyze, review, and optimize OASIS assessments — assessment entry, accuracy and compliance checks, clinical pathways, analytics, and audit, all in one place."
        favoritePage="OASISCenter"
      />

      <EmbeddedPage>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="assessment" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Brain className="h-4 w-4 mr-2" />
              Assessment
            </TabsTrigger>
            <TabsTrigger value="analyze" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Search className="h-4 w-4 mr-2" />
              Analyze
            </TabsTrigger>
            <TabsTrigger value="review" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <ClipboardList className="h-4 w-4 mr-2" />
              Review &amp; Approve
            </TabsTrigger>
            <TabsTrigger value="clinical" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Stethoscope className="h-4 w-4 mr-2" />
              Clinical
            </TabsTrigger>
            <TabsTrigger value="quality" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Shield className="h-4 w-4 mr-2" />
              Compliance &amp; Documentation
            </TabsTrigger>
            {isAdmin && (
              <>
                <TabsTrigger value="analytics" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Analytics
                </TabsTrigger>
                <TabsTrigger value="revenue" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Revenue
                </TabsTrigger>
                <TabsTrigger value="audit" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                  <Eye className="h-4 w-4 mr-2" />
                  Audit
                </TabsTrigger>
              </>
            )}
          </TabsList>
        </div>

        <TabsContent value="assessment">
          <Suspense fallback={tabLoader}>
            <SmartOASISAssessment />
          </Suspense>
        </TabsContent>

        <TabsContent value="analyze">
          <Suspense fallback={tabLoader}>
            <OASISAnalyzer />
          </Suspense>
        </TabsContent>

        <TabsContent value="review">
          <Suspense fallback={tabLoader}>
            <OASISReview />
          </Suspense>
        </TabsContent>

        <TabsContent value="clinical">
          <Suspense fallback={tabLoader}>
            <OASISClinicalReview />
          </Suspense>
        </TabsContent>

        <TabsContent value="quality">
          <Suspense fallback={tabLoader}>
            <div className="space-y-6">
              {isAdmin && (
                <section className="space-y-4">
                  <h2 className="text-lg font-semibold text-slate-900">Compliance Review</h2>
                  <OASISComplianceReview />
                </section>
              )}
              <section className="space-y-4">
                <h2 className="text-lg font-semibold text-slate-900">Documentation Review</h2>
                <OASISDocumentationReview />
              </section>
            </div>
          </Suspense>
        </TabsContent>

        {isAdmin && (
          <>
            <TabsContent value="analytics">
              <Suspense fallback={tabLoader}>
                <OASISAnalyticsDashboard />
              </Suspense>
            </TabsContent>

            <TabsContent value="audit">
              <Suspense fallback={tabLoader}>
                <OASISAuditDashboard />
              </Suspense>
            </TabsContent>

            <TabsContent value="revenue">
              <Suspense fallback={tabLoader}>
                <OASISRevenueAnalysis />
              </Suspense>
            </TabsContent>
          </>
        )}
      </Tabs>
      </EmbeddedPage>
    </PageContainer>
  );
}