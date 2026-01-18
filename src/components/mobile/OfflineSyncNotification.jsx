import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WifiOff, Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useOfflineNotes } from "./OfflineNoteCache";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function OfflineSyncNotification({ currentUser }) {
  const { isOnline, unsyncedCount, syncNotes, getUnsyncedDrafts } = useOfflineNotes();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAttempt, setLastSyncAttempt] = useState(null);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && unsyncedCount > 0 && !syncing) {
      handleAutoSync();
    }
  }, [isOnline]);

  const handleAutoSync = async () => {
    if (unsyncedCount === 0) return;
    
    setSyncing(true);
    try {
      const results = await syncNotes(async (draft) => {
        // Save to patient record
        const patient = await base44.entities.Patient.get(draft.patientId);
        const currentHistory = patient.enhanced_notes_history || [];
        
        const newEntry = {
          date: draft.timestamp,
          visit_type: draft.visitType,
          diagnosis: draft.diagnosis,
          enhanced_note: draft.enhancedNote,
          rough_note: draft.roughNotes,
          nurse_email: currentUser?.email,
          vital_signs: draft.vitalSigns
        };

        await base44.entities.Patient.update(draft.patientId, {
          enhanced_notes_history: [...currentHistory, newEntry]
        });
      });

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      setLastSyncAttempt({ success: successCount, failed: failCount });
      
      if (successCount > 0) {
        toast.success(`Synced ${successCount} offline note${successCount !== 1 ? 's' : ''}`);
      }
      if (failCount > 0) {
        toast.error(`Failed to sync ${failCount} note${failCount !== 1 ? 's' : ''}`);
      }
    } catch (error) {
      console.error('Auto-sync error:', error);
      toast.error('Failed to sync offline notes');
    } finally {
      setSyncing(false);
    }
  };

  if (unsyncedCount === 0 && isOnline) {
    return null;
  }

  return (
    <Card className={`border-2 ${
      !isOnline ? 'border-orange-400 bg-orange-50 dark:bg-orange-950' :
      syncing ? 'border-blue-400 bg-blue-50 dark:bg-blue-950' :
      'border-yellow-400 bg-yellow-50 dark:bg-yellow-950'
    }`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {!isOnline ? (
              <WifiOff className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600 flex-shrink-0" />
            ) : syncing ? (
              <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 animate-spin flex-shrink-0" />
            ) : (
              <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-600 flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-xs sm:text-sm truncate">
                {!isOnline ? 'Offline Mode' :
                 syncing ? 'Syncing Notes...' :
                 'Unsynced Notes'}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                {!isOnline ? 
                  `${unsyncedCount} note${unsyncedCount !== 1 ? 's' : ''} saved locally` :
                  syncing ?
                  'Uploading to server' :
                  `${unsyncedCount} note${unsyncedCount !== 1 ? 's' : ''} pending sync`
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {unsyncedCount > 0 && (
              <Badge className="bg-yellow-600 text-white text-xs">
                {unsyncedCount}
              </Badge>
            )}
            {isOnline && !syncing && unsyncedCount > 0 && (
              <Button
                size="sm"
                onClick={handleAutoSync}
                className="bg-blue-600 hover:bg-blue-700 h-7 sm:h-8 text-xs px-2 sm:px-3"
              >
                <Upload className="w-3 h-3 mr-1" />
                Sync Now
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}