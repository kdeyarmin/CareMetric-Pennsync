import React from "react";
import { Clock, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function TimeSavingsSummary({ timeSavedMinutes, feature }) {
  if (!timeSavedMinutes || timeSavedMinutes <= 0) return null;

  const formatTime = (minutes) => {
    if (minutes < 60) return `${Math.round(minutes)} minutes`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
  };

  const getFeatureName = (feature) => {
    const names = {
      ai_scribe: "AI Scribe",
      note_enhancement: "Note Enhancement",
      compliance_check: "Compliance Check",
      care_plan_generation: "Care Plan Generation",
      task_generation: "Task Generation",
      coding_suggestions: "Coding Suggestions",
      oasis_analysis: "OASIS Analysis",
      voice_transcription: "Voice Transcription",
    };
    return names[feature] || "AI Features";
  };

  return (
    <Alert className="bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200 dark:from-emerald-950/20 dark:to-green-950/20 dark:border-emerald-800">
      <Sparkles className="h-4 w-4 text-emerald-600" />
      <AlertDescription className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
            Time saved with {getFeatureName(feature)}:
          </span>
        </div>
        <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
          ~{formatTime(timeSavedMinutes)}
        </span>
      </AlertDescription>
    </Alert>
  );
}