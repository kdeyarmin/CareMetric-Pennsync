import { lazy, Suspense, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AccessDeniedState from "@/components/ui/AccessDeniedState";
import { BarChart3, Activity, Building2, Loader2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import EmbeddedPage from "@/components/ui/embeddedPage";
import ReferralVolumeReport from "@/components/reports/ReferralVolumeReport";
import NursePerformanceReport from "@/components/reports/NursePerformanceReport";
import OASISComplianceReport from "@/components/reports/OASISComplianceReport";
import PDGMReimbursementReport from "@/components/reports/PDGMReimbursementReport";
import KPIDashboard from "@/components/reports/KPIDashboard";

const AdminReportsCenter = lazy(() => import("@/components/hub-tabs/AdminReportsCenter"));
// Performance Analytics (documentation time / AI utilization / quality, with
// per-user drill-down and export) now renders as the "perf-dashboard" tab here.
// /AnalyticsDashboard redirects in (see REDIRECTS in src/routes.jsx).
const AnalyticsDashboard = lazy(() => import("@/pages/AnalyticsDashboard"));

// Tab keys, kept in sync with the TabsTrigger values below. Used to validate the
// ?tab= deep-link so the retired Reports Center / Analytics Dashboard pages
// redirect to the right tab.
const TAB_KEYS = ["kpi", "perf-dashboard", "referrals", "performance", "oasis", "pdgm", "reports-center"];

const tabLoader = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

export default function ReportsAnalytics() {
  const [dateRange, _setDateRange] = useState({
    start: new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "kpi";
  // Reflect the active tab in the URL so tabs are shareable/bookmarkable and the
  // retired Reports Center page deep-links correctly. "kpi" is the default, so it
  // stays a clean /ReportsAnalytics with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "kpi" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= so the
  // default tab is plain /ReportsAnalytics. Only fires when the param resolved to
  // the default tab, so a valid deep-link like ?tab=reports-center is untouched.
  useEffect(() => {
    if (requestedTab !== null && activeTab === "kpi") {
      setSearchParams({}, { replace: true });
    }
  }, [requestedTab, activeTab, setSearchParams]);

  if (!isAdmin) {
    return <AccessDeniedState description="Reports & Analytics are available to administrators only." />;
  }

  return (
    <PageContainer>
      <PageHeader
        icon={BarChart3}
        eyebrow="Analytics"
        title="Reports & Analytics"
        description="KPIs, documentation performance, outcomes, OASIS/PDGM, and agency reports"
        favoritePage="ReportsAnalytics"
      />

      <EmbeddedPage>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="kpi" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BarChart3 className="w-4 h-4 mr-2" />
              KPI Dashboard
            </TabsTrigger>
            <TabsTrigger value="perf-dashboard" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Activity className="w-4 h-4 mr-2" />
              Performance Dashboard
            </TabsTrigger>
            <TabsTrigger value="referrals" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              Referral Volume
            </TabsTrigger>
            <TabsTrigger value="performance" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              Nurse Performance
            </TabsTrigger>
            <TabsTrigger value="oasis" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              OASIS
            </TabsTrigger>
            <TabsTrigger value="pdgm" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              PDGM
            </TabsTrigger>
            <TabsTrigger value="reports-center" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Building2 className="w-4 h-4 mr-2" />
              Reports Center
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="kpi">
          <KPIDashboard dateRange={dateRange} />
        </TabsContent>

        <TabsContent value="perf-dashboard">
          <Suspense fallback={tabLoader}>
            <AnalyticsDashboard />
          </Suspense>
        </TabsContent>

        <TabsContent value="referrals">
          <ReferralVolumeReport dateRange={dateRange} />
        </TabsContent>

        <TabsContent value="performance">
          <NursePerformanceReport dateRange={dateRange} />
        </TabsContent>

        <TabsContent value="oasis">
          <OASISComplianceReport dateRange={dateRange} />
        </TabsContent>

        <TabsContent value="pdgm">
          <PDGMReimbursementReport dateRange={dateRange} />
        </TabsContent>

        <TabsContent value="reports-center">
          <Suspense fallback={tabLoader}>
            <AdminReportsCenter />
          </Suspense>
        </TabsContent>
      </Tabs>
      </EmbeddedPage>
    </PageContainer>
  );
}