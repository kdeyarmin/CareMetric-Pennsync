import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Lightbulb, Copy, Check } from "lucide-react";
import ImprovementSuggestionDialog from "./ImprovementSuggestionDialog";

export default function InlineNoteEditor({
  noteContent = "",
  onNotePatch = null,
  patientId = "",
  providerType = "RN",
  visitType = "routine_visit",
  diagnosis = ""
}) {
  const [selectedText, setSelectedText] = useState("");
  const [selectionStart, setSelectionStart] = useState(0);
  const [showSuggestionDialog, setShowSuggestionDialog] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const editorRef = useRef(null);

  const handleTextSelection = () => {
    const selection = window.getSelection();
    const selected = selection.toString().trim();

    if (selected && selected.length > 10) {
      // Only allow selections of meaningful length
      setSelectedText(selected);
      setSelectionStart(selection.anchorOffset);
    } else {
      setSelectedText("");
    }
  };

  const handleCopySelection = () => {
    if (selectedText) {
      navigator.clipboard.writeText(selectedText);
      setCopiedIndex(Date.now());
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const highlightSelection = (text) => {
    if (!selectedText) return text;
    
    const regex = new RegExp(`(${selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark class="bg-yellow-200 dark:bg-yellow-800">$1</mark>');
  };

  return (
    <div className="space-y-3">
      {/* Selection Toolbar */}
      {selectedText && (
        <div className="sticky top-0 z-10 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Selected Text:</p>
            <p className="text-sm text-slate-900 dark:text-slate-100 line-clamp-2 font-medium">
              "{selectedText}"
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopySelection}
              className="gap-1 text-xs h-8"
            >
              {copiedIndex ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copiedIndex ? "Copied" : "Copy"}
            </Button>
            <Button
              size="sm"
              onClick={() => setShowSuggestionDialog(true)}
              className="gap-1 text-xs h-8 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              <Lightbulb className="w-3 h-3" />
              Suggest Improvement
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedText("")}
              className="text-xs h-8"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Note Content Display */}
      <div
        ref={editorRef}
        onMouseUp={handleTextSelection}
        className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 min-h-96 max-h-[500px] overflow-y-auto prose prose-sm dark:prose-invert max-w-none cursor-text select-text"
      >
        <div
          className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100 font-mono leading-relaxed"
          dangerouslySetInnerHTML={{ __html: highlightSelection(noteContent) }}
        />
      </div>

      {/* Note Statistics */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded">
          <p className="text-slate-600 dark:text-slate-400">Word Count</p>
          <p className="font-semibold text-slate-900 dark:text-slate-100">{noteContent.split(/\s+/).length}</p>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded">
          <p className="text-slate-600 dark:text-slate-400">Character Count</p>
          <p className="font-semibold text-slate-900 dark:text-slate-100">{noteContent.length}</p>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded">
          <p className="text-slate-600 dark:text-slate-400">Avg. Sentence</p>
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            {Math.round(noteContent.split(/[.!?]+/).length > 0 
              ? noteContent.split(/\s+/).length / noteContent.split(/[.!?]+/).length 
              : 0)}
          </p>
        </div>
      </div>

      {/* Improvement Suggestion Dialog */}
      {showSuggestionDialog && (
        <ImprovementSuggestionDialog
          selectedText={selectedText}
          patientId={patientId}
          providerType={providerType}
          visitType={visitType}
          diagnosis={diagnosis}
          fullNote={noteContent}
          onClose={() => setShowSuggestionDialog(false)}
          onSuggestionSubmitted={() => {
            setShowSuggestionDialog(false);
            setSelectedText("");
          }}
        />
      )}
    </div>
  );
}