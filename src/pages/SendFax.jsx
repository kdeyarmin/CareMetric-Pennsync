import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Smartphone,
  FileText,
  History,
  Search,
  Upload,
  BookTemplate,
  Layers,
  Activity,
  Send,
  BookUser,
  Archive,
  BarChart3,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import EmbeddedPage from "@/components/ui/embeddedPage";
import PageHeader from "@/components/ui/PageHeader";
import EnhancedCameraFaxSender from "../components/fax/EnhancedCameraFaxSender";
import DocumentFaxSender from "../components/fax/DocumentFaxSender";
import PhotoUploadFaxSender from "../components/fax/PhotoUploadFaxSender";
import EnhancedFaxHistory from "../components/fax/EnhancedFaxHistory";
import FaxSearchInterface from "../components/fax/FaxSearchInterface";
import FaxTemplateManager from "../components/fax/FaxTemplateManager";
import BatchFaxSender from "../components/fax/BatchFaxSender";
import RealtimeFaxStatusTracker from "../components/fax/RealtimeFaxStatusTracker";
import { isSuperAdmin } from "@/lib/superAdmin";

const FaxContacts = lazy(() => import("@/components/hub-tabs/FaxContacts"));
const FaxLogsDashboard = lazy(() => import("@/components/hub-tabs/FaxLogsDashboard"));
const FaxAnalytics = lazy(() => import("@/components/hub-tabs/FaxAnalytics"));

// Tab keys, kept in sync with the TabsTrigger values below. Used to validate the
// ?tab= deep-link so the retired standalone pages (Contacts, Address Book, Logs,
// Analytics) redirect to the right tab. "analytics" is admin-only and part of the
// set so admins can deep-link to it; non-admins who request it fall through to the
// default tab below.
const TAB_KEYS = [
  "upload",
  "camera",
  "documents",
  "batch",
  "templates",
  "status",
  "search",
  "history",
  "contacts",
  "logs",
  "analytics",
];
// Tabs whose source page was admin-only — gated to admins (defense in depth;
// server RLS remains the real boundary). Non-admins requesting these via ?tab=
// fall through to the default tab.
const ADMIN_TABS = ["analytics"];

const tabLoader = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

// Core "Send" actions — always visible as a segmented control.
const SEND_TABS = [
  { value: "upload",    Icon: Upload,     label: "Photo"  },
  { value: "camera",    Icon: Smartphone, label: "Camera" },
  { value: "documents", Icon: FileText,   label: "Doc"    },
  { value: "batch",     Icon: Layers,     label: "Batch"  },
];

// Management tools — tucked into the "Manage" dropdown. Analytics is admin-only.
const MANAGE_TABS = [
  { value: "templates", Icon: BookTemplate, label: "Templates", adminOnly: false },
  { value: "status",    Icon: Activity,     label: "Status",    adminOnly: false },
  { value: "search",    Icon: Search,       label: "Search",    adminOnly: false },
  { value: "history",   Icon: History,      label: "History",   adminOnly: false },
  { value: "contacts",  Icon: BookUser,     label: "Contacts",  adminOnly: false },
  { value: "logs",      Icon: Archive,      label: "Logs",      adminOnly: false },
  { value: "analytics", Icon: BarChart3,    label: "Analytics", adminOnly: true  },
];

export default function SendFax() {
  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin' || isSuperAdmin(currentUser);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  // Resolve the active tab, defaulting to the first. The analytics tab is
  // admin-only, so a non-admin requesting ?tab=analytics resolves to the default.
  // Wait for auth to resolve before downgrading an admin tab so an admin
  // deep-linking to ?tab=analytics isn't bounced before currentUser loads.
  let activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "upload";
  if (!isUserLoading && ADMIN_TABS.includes(activeTab) && !isAdmin) {
    activeTab = "upload";
  }

  const manageTabs = MANAGE_TABS.filter((t) => !t.adminOnly || isAdmin);

  const [prefilledData, setPrefilledData] = useState(null);

  const handleApplyTemplate = (tpl) => {
    setPrefilledData(tpl);
    setSearchParams({});
  };

  // Reflect the active tab in the URL so tabs are shareable/bookmarkable and
  // redirects from the retired pages deep-link correctly. "upload" is the
  // default, so it stays a clean /SendFax with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "upload" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= (e.g. a
  // bookmarked ?tab=upload, a stale tab key, or ?tab=analytics for a non-admin)
  // so the default tab is plain /SendFax. Only fires when the param resolved to
  // the default tab, so a valid deep-link like ?tab=contacts is left untouched.
  useEffect(() => {
    if (!isUserLoading && requestedTab !== null && activeTab === "upload") {
      setSearchParams({}, { replace: true });
    }
  }, [isUserLoading, requestedTab, activeTab, setSearchParams]);

  return (
    <PageContainer>
      <PageHeader
        icon={Send}
        eyebrow="Communication"
        title="Fax Center"
        description="Send, review, and track faxes from one professional workspace."
        favoritePage="SendFax"
      />

        <EmbeddedPage>
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          {/* Streamlined for mobile/tablet: the four core "Send" actions stay as a
              segmented control, and the management tools fold into a single
              "Manage" dropdown so the bar never overflows the screen. */}
          <div className="flex items-stretch gap-2">
            <TabsList className="grid grid-cols-4 flex-1 gap-1 h-auto p-1">
              {SEND_TABS.map(({ value, Icon, label }) => (
                <TabsTrigger key={value} value={value} className="flex flex-col sm:flex-row items-center justify-center gap-1 px-2 py-2 min-h-[52px] sm:min-h-[44px] text-xs sm:text-sm whitespace-nowrap">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={manageTabs.some((t) => t.value === activeTab) ? "default" : "outline"}
                  className="h-auto min-h-[52px] sm:min-h-[44px] px-3 flex flex-col sm:flex-row items-center justify-center gap-1 text-xs sm:text-sm"
                >
                  {(() => {
                    const current = manageTabs.find((t) => t.value === activeTab);
                    const Icon = current?.Icon || Layers;
                    return <Icon className="w-4 h-4 flex-shrink-0" />;
                  })()}
                  <span>{manageTabs.find((t) => t.value === activeTab)?.label || "Manage"}</span>
                  <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {manageTabs.map(({ value, Icon, label }) => (
                  <DropdownMenuItem
                    key={value}
                    onSelect={() => handleTabChange(value)}
                    className={`gap-2 ${activeTab === value ? "bg-accent font-medium" : ""}`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <TabsContent value="upload" className="mt-4 sm:mt-6">
            <PhotoUploadFaxSender prefilledData={prefilledData} />
          </TabsContent>

          <TabsContent value="camera" className="mt-4 sm:mt-6">
            <EnhancedCameraFaxSender />
          </TabsContent>

          <TabsContent value="documents" className="mt-4 sm:mt-6">
            <DocumentFaxSender prefilledData={prefilledData} />
          </TabsContent>

          <TabsContent value="batch" className="mt-4 sm:mt-6">
            <BatchFaxSender prefilledData={prefilledData} />
          </TabsContent>

          <TabsContent value="templates" className="mt-4 sm:mt-6">
            <FaxTemplateManager onApplyTemplate={handleApplyTemplate} />
          </TabsContent>

          <TabsContent value="status" className="mt-4 sm:mt-6">
            <RealtimeFaxStatusTracker />
          </TabsContent>

          <TabsContent value="search" className="mt-4 sm:mt-6">
            <FaxSearchInterface onSelectFaxForAI={(faxId) => {
              toast.info(`Fax selected for AI analysis: ${faxId || 'Unknown'}`);
            }} />
          </TabsContent>

          <TabsContent value="history" className="mt-4 sm:mt-6">
            <EnhancedFaxHistory />
          </TabsContent>

          <TabsContent value="contacts" className="mt-4 sm:mt-6">
            <Suspense fallback={tabLoader}>
              <FaxContacts />
            </Suspense>
          </TabsContent>

          <TabsContent value="logs" className="mt-4 sm:mt-6">
            <Suspense fallback={tabLoader}>
              <FaxLogsDashboard />
            </Suspense>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="analytics" className="mt-4 sm:mt-6">
              <Suspense fallback={tabLoader}>
                <FaxAnalytics />
              </Suspense>
            </TabsContent>
          )}
        </Tabs>
        </EmbeddedPage>
    </PageContainer>
  );
}