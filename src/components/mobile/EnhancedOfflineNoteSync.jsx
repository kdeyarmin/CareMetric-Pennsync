import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, CheckCircle2, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

export default function EnhancedOfflineNoteSync({ userEmail, isOnline }) {
  const [syncStatus, setSyncStatus] = useState("idle");
  const [queuedNotes, setQueuedNotes] = useState([]);
  const [syncErrors, setSyncErrors] = useState([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadQueuedNotes();
  }, []);

  useEffect(() => {
    if (isOnline && queuedNotes.length > 0) {
      syncNotes();
    }
  }, [isOnline]);

  const loadQueuedNotes = () => {
    try {
      const queued = localStorage.getItem(`pending_notes_${userEmail}`)
        ? JSON.parse(localStorage.getItem(`pending_notes_${userEmail}`))
        : [];
      setQueuedNotes(queued);
    } catch (error) {
      console.error("Error loading queued notes:", error);
    }
  };

  const syncNotes = async () => {
    if (!isOnline || syncStatus === "syncing") return;

    setSyncing(true);
    setSyncStatus("syncing");
    const errors = [];

    for (const note of queuedNotes) {
      try {
        if (note.patientId && note.patientId !== "no_patient") {
          // Check for conflicts
          const patient = await base44.entities.Patient.filter({
            id: note.patientId
          });

          if (patient.length > 0) {
            const existingNotes = patient[0].enhanced_notes_history || [];
            const hasConflict = existingNotes.some(
              n => new Date(n.date) > new Date(note.created_at)
            );

            if (hasConflict) {
              // Store conflict for manual resolution
              const conflicts = JSON.parse(
                localStorage.getItem("note_conflicts") || "[]"
              );
              conflicts.push({
                id: note.id,
                patientId: note.patientId,
                offlineVersion: note,
                onlineVersion: existingNotes[existingNotes.length - 1],
                timestamp: new Date().toISOString()
              });
              localStorage.setItem("note_conflicts", JSON.stringify(conflicts));
              continue;
            }

            // Save note to patient
            const newEntry = {
              date: note.created_at,
              visit_type: note.visitType,
              diagnosis: note.diagnosis,
              enhanced_note: note.enhancedNote,
              rough_note: note.roughNotes,
              quality_score: note.qualityScore,
              compliance_score: note.complianceScore,
              nurse_email: userEmail,
              vital_signs: note.vitalSigns || {}
            };

            await base44.entities.Patient.update(note.patientId, {
              enhanced_notes_history: [...existingNotes, newEntry]
            });
          }
        }

        // Remove from queue
        setQueuedNotes(prev => prev.filter(n => n.id !== note.id));
      } catch (error) {
        console.error(`Error syncing note ${note.id}:`, error);
        errors.push({
          noteId: note.id,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    setSyncErrors(errors);
    setSyncing(false);

    if (errors.length === 0) {
      setSyncStatus("success");
      toast.success("All notes synced successfully");
      setTimeout(() => setSyncStatus("idle"), 3000);
    } else {
      setSyncStatus("error");
      toast.warning(`Synced with ${errors.length} error(s)`);
    }
  };

  const clearQueue = () => {
    setQueuedNotes([]);
    localStorage.removeItem(`pending_notes_${userEmail}`);
    toast.success("Queue cleared");
  };

  const retrySync = () => {
    syncNotes();
  };

  if (queuedNotes.length === 0 && syncErrors.length === 0) {
    return null;
  }

  return (
    <Card className="border-slate-300">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Wifi className="w-4 h-4 text-green-600" />
            ) : (
              <WifiOff className="w-4 h-4 text-orange-600" />
            )}
            <CardTitle className="text-sm">Offline Note Sync</CardTitle>
          </div>
          <Badge variant={isOnline ? "default" : "secondary"}>
            {isOnline ? "Online" : "Offline"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {queuedNotes.length > 0 && (
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
            <p className="text-xs font-medium text-blue-900 dark:text-blue-200">
              {queuedNotes.length} note(s) queued for sync
            </p>
            <ul className="text-xs text-slate-600 dark:text-slate-400 mt-1 space-y-1">
              {queuedNotes.slice(0, 3).map(note => (
                <li key={note.id} className="truncate">
                  • {note.diagnosis} ({new Date(note.created_at).toLocaleDateString()})
                </li>
              ))}
              {queuedNotes.length > 3 && (
                <li className="text-slate-500">• +{queuedNotes.length - 3} more</li>
              )}
            </ul>
          </div>
        )}

        {syncErrors.length > 0 && (
          <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-xs font-medium text-red-900 dark:text-red-200">
                {syncErrors.length} sync error(s)
              </p>
            </div>
            <ul className="text-xs text-slate-600 dark:text-slate-400 mt-1 space-y-1">
              {syncErrors.map(err => (
                <li key={err.noteId} className="truncate">
                  • {err.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        {syncStatus === "success" && (
          <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
            <p className="text-xs text-green-900 dark:text-green-200">Sync complete</p>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {isOnline && queuedNotes.length > 0 && (
            <Button
              onClick={retrySync}
              size="sm"
              disabled={syncing}
              className="text-xs h-8"
            >
              {syncing ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Syncing...
                </>
              ) : (
                "Sync Now"
              )}
            </Button>
          )}
          {queuedNotes.length > 0 && (
            <Button
              onClick={clearQueue}
              size="sm"
              variant="outline"
              className="text-xs h-8"
              disabled={syncing}
            >
              Clear Queue
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}