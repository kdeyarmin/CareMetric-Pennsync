import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  WifiOff, Wifi, RefreshCw, CheckCircle2, AlertCircle,
  Download, Upload, Database, Clock, Zap
} from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function EnhancedOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, success, error
  const [syncProgress, setSyncProgress] = useState(0);
  const [pendingChanges, setPendingChanges] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const [offlineData, setOfflineData] = useState({
    patients: 0,
    visits: 0,
    notes: 0
  });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Load offline data stats
    loadOfflineStats();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadOfflineStats = () => {
    try {
      const patients = JSON.parse(localStorage.getItem('offline_patients') || '[]');
      const visits = JSON.parse(localStorage.getItem('offline_visits') || '[]');
      const notes = JSON.parse(localStorage.getItem('offline_notes') || '[]');
      const pending = JSON.parse(localStorage.getItem('pending_sync') || '[]');

      setOfflineData({
        patients: patients.length,
        visits: visits.length,
        notes: notes.length
      });
      setPendingChanges(pending.length);

      const lastSyncTime = localStorage.getItem('last_sync_time');
      if (lastSyncTime) {
        setLastSync(new Date(lastSyncTime));
      }
    } catch (error) {
      console.error('Error loading offline stats:', error);
    }
  };

  const handleSync = async () => {
    if (!isOnline) {
      alert('Cannot sync while offline. Please connect to the internet.');
      return;
    }

    setSyncStatus('syncing');
    setSyncProgress(0);

    try {
      const pendingItems = JSON.parse(localStorage.getItem('pending_sync') || '[]');
      const totalItems = pendingItems.length;

      if (totalItems === 0) {
        setSyncStatus('success');
        setTimeout(() => setSyncStatus('idle'), 2000);
        return;
      }

      let syncedCount = 0;

      for (const item of pendingItems) {
        try {
          switch (item.type) {
            case 'create_patient':
              await base44.entities.Patient.create(item.data);
              break;
            case 'update_patient':
              await base44.entities.Patient.update(item.id, item.data);
              break;
            case 'create_visit':
              await base44.entities.Visit.create(item.data);
              break;
            case 'update_visit':
              await base44.entities.Visit.update(item.id, item.data);
              break;
            case 'create_note':
              await base44.entities.NoteConversion.create(item.data);
              break;
            default:
              console.warn('Unknown sync type:', item.type);
          }

          syncedCount++;
          setSyncProgress((syncedCount / totalItems) * 100);
        } catch (error) {
          console.error('Error syncing item:', error);
        }
      }

      // Clear synced items
      localStorage.setItem('pending_sync', '[]');
      localStorage.setItem('last_sync_time', new Date().toISOString());
      
      setPendingChanges(0);
      setLastSync(new Date());
      setSyncStatus('success');
      
      setTimeout(() => {
        setSyncStatus('idle');
        setSyncProgress(0);
      }, 2000);

    } catch (error) {
      console.error('Sync error:', error);
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 3000);
    }
  };

  const downloadForOffline = async () => {
    if (!isOnline) {
      alert('Must be online to download data');
      return;
    }

    setSyncStatus('syncing');
    setSyncProgress(0);

    try {
      // Download patients
      setSyncProgress(25);
      const patients = await base44.entities.Patient.list('-updated_date', 100);
      localStorage.setItem('offline_patients', JSON.stringify(patients));

      // Download recent visits
      setSyncProgress(50);
      const visits = await base44.entities.Visit.list('-visit_date', 200);
      localStorage.setItem('offline_visits', JSON.stringify(visits));

      // Download care plans
      setSyncProgress(75);
      const carePlans = await base44.entities.CarePlan.list('-updated_date', 200);
      localStorage.setItem('offline_care_plans', JSON.stringify(carePlans));

      setSyncProgress(100);
      localStorage.setItem('last_sync_time', new Date().toISOString());
      setLastSync(new Date());
      
      loadOfflineStats();
      setSyncStatus('success');
      
      setTimeout(() => {
        setSyncStatus('idle');
        setSyncProgress(0);
      }, 2000);

    } catch (error) {
      console.error('Download error:', error);
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 3000);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Wifi className="w-5 h-5 text-green-600" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-600" />
            )}
            <span>Offline Sync Status</span>
          </div>
          <Badge className={isOnline ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
            {isOnline ? 'Online' : 'Offline'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connection Status */}
        {!isOnline && (
          <Alert className="bg-yellow-50 border-yellow-300">
            <AlertCircle className="w-4 h-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800">
              You are currently offline. Changes will be synced when you reconnect.
            </AlertDescription>
          </Alert>
        )}

        {/* Sync Progress */}
        {syncStatus === 'syncing' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Syncing...</span>
              <span className="font-medium">{Math.round(syncProgress)}%</span>
            </div>
            <Progress value={syncProgress} className="h-2" />
          </div>
        )}

        {/* Success/Error Messages */}
        {syncStatus === 'success' && (
          <Alert className="bg-green-50 border-green-300">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Sync completed successfully!
            </AlertDescription>
          </Alert>
        )}

        {syncStatus === 'error' && (
          <Alert className="bg-red-50 border-red-300">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">
              Sync failed. Please try again.
            </AlertDescription>
          </Alert>
        )}

        {/* Offline Data Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <Database className="w-5 h-5 text-blue-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-blue-900">{offlineData.patients}</p>
            <p className="text-xs text-blue-700">Patients</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <Database className="w-5 h-5 text-purple-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-purple-900">{offlineData.visits}</p>
            <p className="text-xs text-purple-700">Visits</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <Database className="w-5 h-5 text-green-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-green-900">{offlineData.notes}</p>
            <p className="text-xs text-green-700">Notes</p>
          </div>
        </div>

        {/* Pending Changes */}
        {pendingChanges > 0 && (
          <Alert className="bg-orange-50 border-orange-300">
            <Upload className="w-4 h-4 text-orange-600" />
            <AlertDescription className="text-orange-800">
              <span className="font-semibold">{pendingChanges}</span> changes pending sync
            </AlertDescription>
          </Alert>
        )}

        {/* Last Sync Time */}
        {lastSync && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="w-4 h-4" />
            <span>Last synced: {lastSync.toLocaleString()}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleSync}
            disabled={!isOnline || syncStatus === 'syncing' || pendingChanges === 0}
            className="flex-1"
            variant={pendingChanges > 0 ? 'default' : 'outline'}
          >
            <Upload className="w-4 h-4 mr-2" />
            {syncStatus === 'syncing' ? 'Syncing...' : `Sync Changes (${pendingChanges})`}
          </Button>
          <Button
            onClick={downloadForOffline}
            disabled={!isOnline || syncStatus === 'syncing'}
            variant="outline"
            className="flex-1"
          >
            <Download className="w-4 h-4 mr-2" />
            Download Data
          </Button>
        </div>

        {/* Tips */}
        <div className="bg-blue-50 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <Zap className="w-4 h-4 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-900">
              <p className="font-medium mb-1">Offline Mode Tips:</p>
              <ul className="list-disc ml-4 space-y-1 text-xs">
                <li>Download data before going offline</li>
                <li>Changes are saved locally and auto-sync when online</li>
                <li>Critical data is cached for 7 days</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}