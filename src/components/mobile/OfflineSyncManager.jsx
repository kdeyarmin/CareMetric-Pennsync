import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Cloud, CloudOff, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { offlineStorage } from './EnhancedOfflineStorage';

export default function OfflineSyncManager() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [pendingItems, setPendingItems] = useState(0);
  const [lastSync, setLastSync] = useState(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Back online - ready to sync');
      checkPendingItems();
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('You are offline - changes will be saved locally');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    checkPendingItems();
    const interval = setInterval(checkPendingItems, 30000); // Check every 30s

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const checkPendingItems = async () => {
    try {
      const pending = await offlineStorage.getPendingNotes();
      const queue = await offlineStorage.getSyncQueue();
      setPendingItems(pending.length + queue.length);
    } catch (error) {
      console.error('Error checking pending items:', error);
    }
  };

  const syncAll = async () => {
    if (!isOnline) {
      toast.error('Cannot sync while offline');
      return;
    }

    setSyncing(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      // Sync pending notes
      const pendingNotes = await offlineStorage.getPendingNotes();
      
      for (const note of pendingNotes) {
        try {
          // Save note to patient history
          if (note.patient_id) {
            const patient = await base44.entities.Patient.filter({ id: note.patient_id });
            if (patient.length > 0) {
              const currentHistory = patient[0].enhanced_notes_history || [];
              await base44.entities.Patient.update(note.patient_id, {
                enhanced_notes_history: [...currentHistory, {
                  date: note.timestamp,
                  visit_type: note.visit_type,
                  diagnosis: note.diagnosis,
                  enhanced_note: note.enhanced_note,
                  rough_note: note.rough_notes,
                  quality_score: note.quality_score,
                  compliance_score: note.compliance_score,
                  nurse_email: note.nurse_email,
                  vital_signs: note.vital_signs
                }]
              });
            }
          }

          await offlineStorage.markNoteSynced(note.local_id);
          successCount++;
        } catch (error) {
          console.error('Error syncing note:', error);
          errorCount++;
        }
      }

      // Sync queue items
      const queue = await offlineStorage.getSyncQueue();
      for (const item of queue) {
        try {
          // Execute queued action based on type
          switch (item.action) {
            case 'create_task':
              await base44.entities.Task.create(item.data);
              break;
            case 'update_patient':
              await base44.entities.Patient.update(item.data.id, item.data.updates);
              break;
            case 'create_care_plan':
              await base44.entities.CarePlan.create(item.data);
              break;
            default:
              console.warn('Unknown action type:', item.action);
          }
          
          await offlineStorage.clearSyncQueue(item.queue_id);
          successCount++;
        } catch (error) {
          console.error('Error syncing queue item:', error);
          errorCount++;
        }
      }

      setLastSync(new Date());
      await checkPendingItems();

      if (errorCount === 0) {
        toast.success(`Synced ${successCount} items successfully`);
      } else {
        toast.warning(`Synced ${successCount} items, ${errorCount} failed`);
      }
    } catch (error) {
      console.error('Sync error:', error);
      toast.error('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="border-2">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            {isOnline ? (
              <Cloud className="w-5 h-5 text-green-600" />
            ) : (
              <CloudOff className="w-5 h-5 text-orange-600" />
            )}
            Sync Status
          </span>
          <Badge className={isOnline ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}>
            {isOnline ? 'Online' : 'Offline'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm">Pending items:</span>
          <Badge variant="outline">{pendingItems}</Badge>
        </div>

        {lastSync && (
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>Last sync:</span>
            <span>{lastSync.toLocaleTimeString()}</span>
          </div>
        )}

        <Button
          onClick={syncAll}
          disabled={!isOnline || syncing || pendingItems === 0}
          className="w-full"
        >
          {syncing ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Sync {pendingItems} Items
            </>
          )}
        </Button>

        {!isOnline && (
          <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm">
            <AlertCircle className="w-4 h-4 text-orange-600 inline mr-2" />
            Working offline. Changes will sync when connection is restored.
          </div>
        )}
      </CardContent>
    </Card>
  );
}