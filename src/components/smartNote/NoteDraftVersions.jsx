import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Trash2, RotateCcw, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function NoteDraftVersions({ patientId, visitType, diagnosis, onVersionSelect }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (patientId && patientId !== "no_patient") {
      loadVersions();
    }
  }, [patientId]);

  const loadVersions = async () => {
    setLoading(true);
    try {
      const drafts = localStorage.getItem(`note_versions_${patientId}`) 
        ? JSON.parse(localStorage.getItem(`note_versions_${patientId}`))
        : [];
      setVersions(drafts);
    } catch (error) {
      console.error("Error loading versions:", error);
    } finally {
      setLoading(false);
    }
  };

  const saveVersion = (noteContent, label = "Manual Save") => {
    try {
      const newVersion = {
        id: Date.now(),
        content: noteContent,
        label,
        timestamp: new Date().toISOString(),
        visitType,
        diagnosis,
        autoSaved: label === "Auto-save"
      };

      const updated = [newVersion, ...versions].slice(0, 10); // Keep last 10 versions
      localStorage.setItem(`note_versions_${patientId}`, JSON.stringify(updated));
      setVersions(updated);
      toast.success(`Version saved: ${label}`);
    } catch (error) {
      console.error("Error saving version:", error);
      toast.error("Failed to save version");
    }
  };

  const loadVersion = (version) => {
    setSelectedVersion(version);
    onVersionSelect?.(version);
    toast.success(`Loaded version from ${format(new Date(version.timestamp), "MMM d, HH:mm")}`);
  };

  const deleteVersion = (versionId) => {
    const updated = versions.filter(v => v.id !== versionId);
    localStorage.setItem(`note_versions_${patientId}`, JSON.stringify(updated));
    setVersions(updated);
    if (selectedVersion?.id === versionId) {
      setSelectedVersion(null);
    }
    toast.success("Version deleted");
  };

  if (!patientId || patientId === "no_patient") {
    return null;
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 p-2 rounded transition-colors"
        >
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-600" />
            <CardTitle className="text-sm">Draft Versions ({versions.length})</CardTitle>
          </div>
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-2 pt-0">
          {loading ? (
            <p className="text-xs text-slate-500">Loading versions...</p>
          ) : versions.length === 0 ? (
            <p className="text-xs text-slate-500">No saved versions yet</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className={`p-2 rounded border transition-colors ${
                    selectedVersion?.id === version.id
                      ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300"
                      : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium truncate">{version.label}</span>
                        {version.autoSaved && (
                          <Badge variant="outline" className="text-xs">Auto</Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        {format(new Date(version.timestamp), "MMM d, yyyy HH:mm:ss")}
                      </p>
                      <p className="text-[10px] text-slate-600 mt-1 truncate">
                        {version.content.substring(0, 80)}...
                      </p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        onClick={() => loadVersion(version)}
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 p-0"
                        title="Restore this version"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </Button>
                      <Button
                        onClick={() => deleteVersion(version.id)}
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="Delete this version"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t">
            <Button
              onClick={() => saveVersion("", "Manual Checkpoint")}
              size="sm"
              variant="outline"
              className="text-xs h-8"
              disabled={!patientId || patientId === "no_patient"}
            >
              Save Current Version
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}