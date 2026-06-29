import { lazy, Suspense, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WifiOff, Wifi, Users, FileText, Database, Activity, Upload, Loader2 } from "lucide-react";
import OfflinePatientSelector from "../components/mobile/OfflinePatientSelector";
import OfflineSyncManager from "../components/mobile/OfflineSyncManager";
import OfflineTaskManager from "../components/mobile/OfflineTaskManager";
import PageContainer from "@/components/ui/PageContainer";
import EmbeddedPage from "@/components/ui/embeddedPage";
import PageHeader from "@/components/ui/PageHeader";

const OfflineVisitDocumentation = lazy(() => import("@/components/hub-tabs/OfflineVisitDocumentation"));
const OfflineDocumentation = lazy(() => import("@/components/hub-tabs/OfflineDocumentation"));

// Tab keys, kept in sync with the TabsTrigger values below. Used to validate the
// ?tab= deep-link so the retired offline pages redirect to the right tab.
const TAB_KEYS = ["status", "visit", "pending"];

const tabLoader = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

export default function OfflineMode() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedPatient, setSelectedPatient] = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "status";
  // Reflect the active tab in the URL so tabs are shareable/bookmarkable and the
  // retired offline pages deep-link correctly. "status" is the default, so it
  // stays a clean /OfflineMode with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "status" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= so the
  // default tab is plain /OfflineMode. Only fires when the param resolved to the
  // default tab, so a valid deep-link like ?tab=visit is left untouched.
  useEffect(() => {
    if (requestedTab !== null && activeTab === "status") {
      setSearchParams({}, { replace: true });
    }
  }, [requestedTab, activeTab, setSearchParams]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  let cachedPatients = [];
  try {
    cachedPatients = JSON.parse(localStorage.getItem('offline_patient_data') || '[]');
  } catch (e) {
    console.warn('Failed to parse cached patient data:', e);
  }

  return (
    <PageContainer>
      <PageHeader
        icon={WifiOff}
        eyebrow="Tools"
        title="Offline Mode"
        description="Work without internet, sync when ready"
        favoritePage="OfflineMode"
      />

      <EmbeddedPage>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="status" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Activity className="h-4 w-4 mr-2" />
              Status &amp; Sync
            </TabsTrigger>
            <TabsTrigger value="visit" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <FileText className="h-4 w-4 mr-2" />
              Document Visit
            </TabsTrigger>
            <TabsTrigger value="pending" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Upload className="h-4 w-4 mr-2" />
              Pending Sync
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="status" className="space-y-4 sm:space-y-6">
      <Alert className={isOnline ? 'bg-emerald-50 border-emerald-300' : 'bg-orange-50 border-orange-300'}>
        <AlertDescription className="text-sm flex items-center gap-2">
          {isOnline ? (
            <>
              <Wifi className="w-4 h-4 text-emerald-600" />
              <span className="text-emerald-800">Connected — data will sync automatically</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-amber-600" />
              <span className="text-amber-800">Offline — using cached data</span>
            </>
          )}
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6">
        <Card className="border-blue-200">
          <CardContent className="p-3 sm:p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-blue-600 font-medium mb-1 truncate">Cached Patients</p>
                <p className="text-2xl sm:text-3xl font-bold text-blue-900">{cachedPatients.length}</p>
              </div>
              <Users className="w-8 h-8 sm:w-10 sm:h-10 text-blue-400 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-200">
          <CardContent className="p-3 sm:p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-amber-600 font-medium mb-1 truncate">Pending Sync</p>
                <p className="text-2xl sm:text-3xl font-bold text-amber-900">
                  {(() => { try { return JSON.parse(localStorage.getItem('offline_visit_drafts') || '[]').length; } catch { return 0; } })()}
                </p>
              </div>
              <FileText className="w-8 h-8 sm:w-10 sm:h-10 text-amber-400 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-navy-200">
          <CardContent className="p-3 sm:p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-navy-600 font-medium mb-1 truncate">Storage Used</p>
                <p className="text-2xl sm:text-3xl font-bold text-navy-900">
                  {(
                    (localStorage.getItem('offline_patient_data')?.length || 0) / 1024
                  ).toFixed(0)}
                  <span className="text-base sm:text-lg ml-1">KB</span>
                </p>
              </div>
              <Database className="w-8 h-8 sm:w-10 sm:h-10 text-navy-400 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="space-y-6">
          <OfflineSyncManager />
          <OfflinePatientSelector onCacheComplete={() => {
            toast.success('Patient data cached for offline use');
          }} />
        </div>

        <div className="space-y-4 sm:space-y-6">
          {/* Cached Patients List */}
          <Card>
            <CardHeader className="p-3 sm:p-4 md:p-6">
              <CardTitle className="text-sm sm:text-base">Cached Patients</CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              {cachedPatients.length === 0 ? (
                <div className="text-center py-4 sm:py-6 text-slate-500">
                  <Users className="w-10 h-10 sm:w-12 sm:h-12 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs sm:text-sm">No patients cached</p>
                  <p className="text-xs mt-1">Download patient data to work offline</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 sm:max-h-96 overflow-y-auto">
                  {cachedPatients.map((cache, idx) => (
                    <div
                     key={idx}
                     className={`p-3 sm:p-4 border rounded-lg cursor-pointer transition-colors min-h-[60px] touch-target ${
                       selectedPatientId === cache.patient.id 
                         ? 'bg-blue-50 border-blue-300' 
                         : 'bg-white hover:bg-slate-50'
                     }`}
                     onClick={() => {
                       setSelectedPatientId(cache.patient.id);
                       setSelectedPatient(cache.patient);
                     }}
                    >
                      <p className="font-medium text-sm sm:text-base">
                        {cache.patient.first_name} {cache.patient.last_name}
                      </p>
                      <p className="text-xs sm:text-sm text-slate-600 truncate">{cache.patient.primary_diagnosis}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge variant="outline" className="text-xs">
                          {cache.carePlans?.length || 0} care plans
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {cache.recentVisits?.length || 0} visits
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Offline Task Manager */}
          {selectedPatientId && selectedPatient && (
            <OfflineTaskManager
              patientId={selectedPatientId}
              patientName={`${selectedPatient.first_name} ${selectedPatient.last_name}`}
            />
          )}
        </div>
      </div>
        </TabsContent>

        <TabsContent value="visit">
          <Suspense fallback={tabLoader}>
            <OfflineVisitDocumentation />
          </Suspense>
        </TabsContent>

        <TabsContent value="pending">
          <Suspense fallback={tabLoader}>
            <OfflineDocumentation />
          </Suspense>
        </TabsContent>
      </Tabs>
      </EmbeddedPage>
    </PageContainer>
  );
}