// AdminOperations — admin command center [2026-06-29]. Tabs: overview, activity,
// data-quality, system-health, settings. Deep-linkable via ?tab=<key>.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { base44 } from "@/api/base44Client";
import { isAdminView } from "@/lib/roles";
import { isAdminLike } from "@/lib/superAdmin";
import AccessDeniedState from "@/components/ui/AccessDeniedState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, Database, Settings, Zap } from "lucide-react";
import AdminConsoleDirectory from "@/components/admin/AdminConsoleDirectory";
import AdminDashboardOverview from "@/components/admin/AdminDashboardOverview";
import UserActivityDashboard from "@/components/admin/UserActivityDashboard";
import DataQualityDashboard from "@/components/admin/DataQualityDashboard";
import SystemHealthPanel from "@/components/admin/SystemHealthPanel";
import SystemSettings from "@/components/admin/SystemSettings";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";

// Console tab keys, kept in sync with the TabsTrigger values below. Used to
// validate the ?tab= deep-link so the retired standalone pages (System Health,
// Data Quality) can redirect straight to the right tab.
// [Force recompile: 2026-06-29 12:05:00 UTC]
const TAB_KEYS = ["overview", "activity", "data-quality", "system-health", "settings"];

export default function AdminOperations() {
  const { data: currentUser, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });
  const adminView = isAdminView(currentUser);
  // User Activity is paused for every role, and System Health actions still
  // require Base44's protected built-in admin role. Keep both tabs out of a
  // facility-only view; the protected view receives the explicit paused state.
  const canUseProtectedAdminTools = isAdminLike(currentUser);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const visibleTabKeys = canUseProtectedAdminTools
    ? TAB_KEYS
    : ["overview", "data-quality", "settings"];
  const activeTab = visibleTabKeys.includes(requestedTab) ? requestedTab : "overview";
  // Reflect the active tab in the URL so console tabs are shareable/bookmarkable
  // and redirects from the retired pages deep-link correctly. "overview" is the
  // default, so it stays a clean /AdminOperations with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "overview" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= (e.g. a
  // bookmarked ?tab=overview, or a stale tab key from an old link) so the default
  // tab is plain /AdminOperations. Only fires when the param resolved to the
  // default tab, so a valid deep-link like ?tab=data-quality is left untouched.
  useEffect(() => {
    if (requestedTab !== null && activeTab === "overview") {
      setSearchParams({}, { replace: true });
    }
  }, [requestedTab, activeTab, setSearchParams]);

  if (isLoading) return null;

  if (!adminView) {
    return (
      <AccessDeniedState
        title="Access Restricted"
        description="Only administrators can access Admin Operations."
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Settings}
        eyebrow="Administration"
        title="Admin Console"
        description="Your command center — reach every administrative tool, plus system monitoring, data quality, user activity, and settings."
        favoritePage="AdminOperations"
      />

      {!canUseProtectedAdminTools && (
        <Alert className="mb-4 border-blue-200 bg-blue-50">
          <AlertDescription className="text-blue-900">
            User Activity is unavailable for every role until a tenant-authorized audit broker is verified. System Health requires protected administrator access. Facility-admin access remains limited to the visible console sections while tenant-scoped operations brokers are pending.
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="overview" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Activity className="h-4 w-4 mr-2" />
              Overview
            </TabsTrigger>
            {canUseProtectedAdminTools && (
              <TabsTrigger value="activity" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                <Activity className="h-4 w-4 mr-2" />
                User Activity
              </TabsTrigger>
            )}
            <TabsTrigger value="data-quality" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Database className="h-4 w-4 mr-2" />
              Data Quality
            </TabsTrigger>
            {canUseProtectedAdminTools && (
              <TabsTrigger value="system-health" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                <Zap className="h-4 w-4 mr-2" />
                System Health
              </TabsTrigger>
            )}
            <TabsTrigger value="settings" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6">
          <AdminConsoleDirectory />
          <AdminDashboardOverview />
        </TabsContent>

        {canUseProtectedAdminTools && (
          <TabsContent value="activity">
            <UserActivityDashboard />
          </TabsContent>
        )}

        <TabsContent value="data-quality">
          <DataQualityDashboard />
        </TabsContent>

        {canUseProtectedAdminTools && (
          <TabsContent value="system-health">
            <SystemHealthPanel />
          </TabsContent>
        )}

        <TabsContent value="settings">
          <SystemSettings />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
