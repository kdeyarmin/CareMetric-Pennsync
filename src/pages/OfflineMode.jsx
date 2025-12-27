import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WifiOff, Wifi, Users, FileText, Database } from "lucide-react";
import OfflinePatientSelector from "../components/mobile/OfflinePatientSelector";
import OfflineSyncManager from "../components/mobile/OfflineSyncManager";
import OfflineNoteEditor from "../components/mobile/OfflineNoteEditor";
import EnhancedOfflineSync from "../components/mobile/EnhancedOfflineSync";

export default function OfflineMode() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [selectedPatientId, setSelectedPatientId] = useState("");

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

  const cachedPatients = JSON.parse(localStorage.getItem('offline_patient_data') || '[]');

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${
            isOnline ? 'bg-green-500' : 'bg-orange-500'
          }`}>
            {isOnline ? <Wifi className="w-6 h-6 text-white" /> : <WifiOff className="w-6 h-6 text-white" />}
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Offline Mode</h1>
            <p className="text-sm text-gray-600">Work without internet, sync when ready</p>
          </div>
        </div>

        <Alert className={isOnline ? 'bg-green-50 border-green-300' : 'bg-orange-50 border-orange-300'}>
          <AlertDescription className="text-sm flex items-center gap-2">
            {isOnline ? (
              <>
                <Wifi className="w-4 h-4 text-green-600" />
                <span className="text-green-800">✅ Connected - Data will sync automatically</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-orange-600" />
                <span className="text-orange-800">⚠️ Offline - Using cached data</span>
              </>
            )}
          </AlertDescription>
        </Alert>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600 font-medium mb-1">Cached Patients</p>
                <p className="text-3xl font-bold text-blue-900">{cachedPatients.length}</p>
              </div>
              <Users className="w-10 h-10 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-yellow-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-yellow-600 font-medium mb-1">Pending Sync</p>
                <p className="text-3xl font-bold text-yellow-900">
                  {JSON.parse(localStorage.getItem('offline_visit_drafts') || '[]').length}
                </p>
              </div>
              <FileText className="w-10 h-10 text-yellow-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-purple-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-purple-600 font-medium mb-1">Storage Used</p>
                <p className="text-3xl font-bold text-purple-900">
                  {(
                    (localStorage.getItem('offline_patient_data')?.length || 0) / 1024
                  ).toFixed(0)}
                  <span className="text-lg ml-1">KB</span>
                </p>
              </div>
              <Database className="w-10 h-10 text-purple-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6">
        <EnhancedOfflineSync />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <OfflineSyncManager />
          <OfflinePatientSelector onCacheComplete={() => {}} />
        </div>

        <div className="space-y-6">
          {/* Cached Patients List */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cached Patients</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {cachedPatients.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <Users className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm">No patients cached</p>
                  <p className="text-xs mt-1">Download patient data to work offline</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {cachedPatients.map((cache, idx) => (
                    <div
                      key={idx}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedPatientId === cache.patient.id 
                          ? 'bg-blue-50 border-blue-300' 
                          : 'bg-white hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedPatientId(cache.patient.id)}
                    >
                      <p className="font-medium text-sm">
                        {cache.patient.first_name} {cache.patient.last_name}
                      </p>
                      <p className="text-xs text-gray-600">{cache.patient.primary_diagnosis}</p>
                      <div className="flex gap-2 mt-2">
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

          {/* Offline Note Editor */}
          {selectedPatientId && (
            <OfflineNoteEditor
              patientId={selectedPatientId}
              onSaveOffline={() => setSelectedPatientId("")}
            />
          )}
        </div>
      </div>
    </div>
  );
}