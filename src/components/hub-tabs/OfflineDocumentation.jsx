import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SearchablePatientSelect from '@/components/ui/SearchablePatientSelect';
import OfflineSyncStatus from '@/components/offline/OfflineSyncStatus';
import OfflineVisitDocumentation from '@/components/offline/OfflineVisitDocumentation';
import { FileText, Upload, AlertCircle, Info, UserSearch } from 'lucide-react';

export default function OfflineDocumentation() {
  const [selectedPatientId, setSelectedPatientId] = useState(null);

  const { data: patients = [] } = useQuery({
    queryKey: ['patients', 'active'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }),
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Sync Status */}
      <OfflineSyncStatus />

      {/* Info Card */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              {/* Keep this copy honest: describe only what src/lib/offlineSync.js
                  actually does. Overstated claims (30-second auto-save, retry
                  backoff, conflict detection) previously listed here were never
                  implemented and misled clinicians about data-loss risk. */}
              <h3 className="font-semibold text-blue-900 mb-1">How Offline Mode Works</h3>
              <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                <li>Documentation you submit while offline is saved locally on this device</li>
                <li>Saved items sync automatically the next time the app is open with a connection</li>
                <li>Items that fail to sync stay saved and are retried on the next sync</li>
                <li>View pending items and sync status anytime</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="document" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="document" className="gap-2">
            <FileText className="w-4 h-4" />
            Document Visit
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <Upload className="w-4 h-4" />
            Pending Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="document" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>New Visit Documentation</CardTitle>
              <CardDescription>
                Document patient visits with offline support - works seamlessly with or without internet
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 max-w-md">
                <label htmlFor="offline-patient-select" className="text-sm font-medium text-slate-700">Patient</label>
                <SearchablePatientSelect
                  id="offline-patient-select"
                  patients={patients}
                  value={selectedPatientId}
                  onValueChange={setSelectedPatientId}
                  placeholder="Select a patient to document..."
                />
              </div>

              {selectedPatientId ? (
                <OfflineVisitDocumentation
                  patientId={selectedPatientId}
                  onSaved={() => {}}
                />
              ) : (
                <EmptyState
                  icon={UserSearch}
                  title="Select a patient to begin"
                  description="Choose a patient above to start documenting a visit — your notes save locally and sync automatically when you're back online."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pending" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Sync Queue Management</CardTitle>
              <CardDescription>
                View and manage documentation waiting to be synced to the server
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyState icon={AlertCircle} title="No pending items here" description="Use the sync status widget above to view pending items." />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Technical Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage & Sync Information</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <p><strong>Storage Location:</strong> On-device browser storage (IndexedDB), persistent across sessions</p>
          <p><strong>Sync Trigger:</strong> Runs when the connection is restored, and on app startup if items are pending</p>
          <p><strong>Retry Logic:</strong> Items that fail to sync stay queued and are retried on the next sync</p>
          <p><strong>Data Retention:</strong> Unsynced documentation persists until successfully synced — even across logout; cached patient data is purged on logout</p>
          <p><strong>Note:</strong> Offline data is saved per device and per app — items queued in your phone&rsquo;s browser are separate from the installed app</p>
        </CardContent>
      </Card>
    </div>
  );
}