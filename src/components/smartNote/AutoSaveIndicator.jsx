import React, { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function AutoSaveIndicator({ noteContent, onSave, enabled = true }) {
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const [lastSaveTime, setLastSaveTime] = useState(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);

  useEffect(() => {
    if (!enabled || !unsavedChanges) return;

    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await onSave();
        setSaveStatus("saved");
        setLastSaveTime(new Date());
        setUnsavedChanges(false);
        
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (error) {
        setSaveStatus("error");
        console.error("Auto-save failed:", error);
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    }, 3000); // Auto-save after 3 seconds of inactivity

    return () => clearTimeout(timer);
  }, [noteContent, unsavedChanges, enabled, onSave]);

  useEffect(() => {
    setUnsavedChanges(true);
  }, [noteContent]);

  const getStatusDisplay = () => {
    switch (saveStatus) {
      case "saving":
        return (
          <div className="flex items-center gap-1 text-xs text-slate-600">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving...
          </div>
        );
      case "saved":
        return (
          <div className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 className="w-3 h-3" />
            Saved
          </div>
        );
      case "error":
        return (
          <div className="flex items-center gap-1 text-xs text-red-600">
            <AlertCircle className="w-3 h-3" />
            Save failed
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Clock className="w-3 h-3" />
            {lastSaveTime ? `Saved at ${lastSaveTime.toLocaleTimeString()}` : "Ready to save"}
          </div>
        );
    }
  };

  if (!enabled) return null;

  return (
    <div className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
      {getStatusDisplay()}
      {unsavedChanges && saveStatus === "idle" && (
        <span className="text-xs text-orange-600">Unsaved changes</span>
      )}
    </div>
  );
}