import { Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SmartNoteHeader({ careScope, onReset, step, activeTab }) {
  const getDescription = () => {
    if (careScope === "hospice") return "Comfort-focused, Medicare-compliant documentation";
    if (careScope === "both") return "Home Health & Hospice — Medicare-compliant";
    return "Skilled care, survey-ready documentation";
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-indigo-600" /> Smart Note Assistant
        </h1>
        <p className="text-sm text-slate-500 mt-1">{getDescription()}</p>
      </div>
      {activeTab === "builder" && step > 1 && (
        <Button variant="outline" size="sm" onClick={onReset} className="gap-1.5 text-slate-600">
          <RotateCcw className="w-4 h-4" /> New Note
        </Button>
      )}
    </div>
  );
}