import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Copy, Eye } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function NoteConflictResolver({ onlineVersion, offlineVersion, patientName, onResolve }) {
  const [selectedVersion, setSelectedVersion] = useState("online");
  const [showComparison, setShowComparison] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergedContent, setMergedContent] = useState("");

  if (!onlineVersion || !offlineVersion) return null;

  const handleMerge = () => {
    setMergeMode(true);
    // Simple merge: combine both versions with markers
    const merged = `[ONLINE VERSION - ${onlineVersion.timestamp}]\n${onlineVersion.content}\n\n[OFFLINE VERSION - ${offlineVersion.timestamp}]\n${offlineVersion.content}`;
    setMergedContent(merged);
  };

  const handleResolve = (choice) => {
    let finalContent = "";
    
    if (choice === "online") {
      finalContent = onlineVersion.content;
    } else if (choice === "offline") {
      finalContent = offlineVersion.content;
    } else if (choice === "merged") {
      finalContent = mergedContent;
    }

    onResolve?.(finalContent, choice);
    toast.success(`Resolved conflict - using ${choice} version`);
  };

  const VersionPreview = ({ version, label, isSelected }) => (
    <div className={`p-3 rounded border-2 transition-colors ${
      isSelected 
        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" 
        : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
    }`}>
      <div className="flex items-center justify-between mb-2">
        <Badge variant={isSelected ? "default" : "outline"}>
          {label}
        </Badge>
        <span className="text-xs text-slate-500">
          {format(new Date(version.timestamp), "MMM d, HH:mm")}
        </span>
      </div>
      <div className="max-h-32 overflow-y-auto text-xs font-mono bg-white dark:bg-slate-900 p-2 rounded border">
        {version.content.substring(0, 200)}...
      </div>
      <p className="text-[10px] text-slate-500 mt-2">
        {version.content.length} characters
      </p>
    </div>
  );

  return (
    <Card className="border-2 border-orange-300 bg-orange-50 dark:bg-orange-900/10">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-600" />
          <CardTitle className="text-sm">Note Conflict Detected</CardTitle>
        </div>
        <p className="text-xs text-slate-600 mt-2">
          Both online and offline versions exist for {patientName}. Choose how to resolve:
        </p>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-2 gap-3">
          <div
            onClick={() => setSelectedVersion("online")}
            className="cursor-pointer"
          >
            <VersionPreview
              version={onlineVersion}
              label="Online Version"
              isSelected={selectedVersion === "online"}
            />
          </div>
          <div
            onClick={() => setSelectedVersion("offline")}
            className="cursor-pointer"
          >
            <VersionPreview
              version={offlineVersion}
              label="Offline Version"
              isSelected={selectedVersion === "offline"}
            />
          </div>
        </div>

        {showComparison && !mergeMode && (
          <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded max-h-48 overflow-y-auto text-xs font-mono">
            <div className="mb-4">
              <h4 className="font-semibold mb-2">Online:</h4>
              <p>{onlineVersion.content}</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Offline:</h4>
              <p>{offlineVersion.content}</p>
            </div>
          </div>
        )}

        {mergeMode && (
          <div className="space-y-2">
            <label className="text-xs font-medium">Merged Content (Edit as needed):</label>
            <textarea
              value={mergedContent}
              onChange={(e) => setMergedContent(e.target.value)}
              className="w-full h-32 p-2 border rounded text-xs font-mono focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => handleResolve("online")}
            size="sm"
            variant={selectedVersion === "online" ? "default" : "outline"}
            className="text-xs"
          >
            Use Online
          </Button>
          <Button
            onClick={() => handleResolve("offline")}
            size="sm"
            variant={selectedVersion === "offline" ? "default" : "outline"}
            className="text-xs"
          >
            Use Offline
          </Button>
          <Button
            onClick={mergeMode ? () => handleResolve("merged") : handleMerge}
            size="sm"
            variant="outline"
            className="text-xs"
          >
            {mergeMode ? "Use Merged" : "Merge Both"}
          </Button>
          <Button
            onClick={() => setShowComparison(!showComparison)}
            size="sm"
            variant="outline"
            className="text-xs"
          >
            <Eye className="w-3 h-3 mr-1" />
            Compare
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}