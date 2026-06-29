import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Undo2,
  Redo2,
  Copy,
  CheckCircle2,
  Sparkles
} from "lucide-react";

export default function RichTextNoteEditor({
  value,
  onChange,
  onCopy,
  copied,
  qualityScore
}) {
  const [history, setHistory] = useState([value || '']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [editableText, setEditableText] = useState(value || '');
  const lastValueRef = useRef(value);
  const textareaRef = useRef(null);
  const isInternalChange = useRef(false);

  useEffect(() => {
    // Only sync from parent if it's not an internal change
    if (!isInternalChange.current && value !== editableText) {
      setEditableText(value);
    }
    isInternalChange.current = false;
  }, [value, editableText]);

  // Track changes for undo/redo
  useEffect(() => {
    if (value !== lastValueRef.current && value !== history[historyIndex]) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(value);
      // Keep max 50 history items
      if (newHistory.length > 50) newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      lastValueRef.current = value;
    }
  }, [value, history, historyIndex]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      onChange(history[newIndex]);
      lastValueRef.current = history[newIndex];
    }
  }, [historyIndex, history, onChange]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      onChange(history[newIndex]);
      lastValueRef.current = history[newIndex];
    }
  }, [historyIndex, history, onChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);



  const handleCopyPlainText = () => {
    // Remove all placeholder markers before copying
    const cleanText = editableText
      .replace(/\[nurse to document[^\]]*\]/gi, '')
      .replace(/<[^>]*>/g, '') // Remove any HTML tags
      .trim();
    navigator.clipboard.writeText(cleanText);
    onCopy?.();
  };

  const handleTextChange = (e) => {
    const newText = e.target.value;
    isInternalChange.current = true;
    setEditableText(newText);
    onChange?.(newText);
  };

  // Get text with highlighted placeholders for display overlay
  const renderHighlightedText = () => {
    if (!editableText) return null;
    
    // Split by placeholders - match [nurse to document...] OR [insert...] OR any bracketed placeholder text
    const parts = editableText.split(/(\[nurse to document[^\]]*\]|\[insert[^\]]*\]|\[[^\]]*to fill in[^\]]*\]|\[[^\]]*enter[^\]]*\])/gi);
    
    return parts.map((part, idx) => {
      if (part.match(/\[nurse to document[^\]]*\]|\[insert[^\]]*\]|\[[^\]]*to fill in[^\]]*\]|\[[^\]]*enter[^\]]*\]/i)) {
        return (
          <mark key={idx} className="bg-yellow-200/60" style={{ color: 'inherit', padding: 0 }}>
            {part}
          </mark>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            className="h-8 px-2"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className="h-8 px-2"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-4 h-4" />
          </Button>
          <span className="text-xs text-slate-400 ml-2">
            {historyIndex + 1}/{history.length} versions
          </span>
        </div>

        <div className="flex items-center gap-2">
          {qualityScore && (
            <Badge className="bg-green-600 text-white">
              <Sparkles className="w-3 h-3 mr-1" />
              {qualityScore}% Quality
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopyPlainText}
            className="h-8"
          >
            {copied ? (
              <><CheckCircle2 className="w-4 h-4 mr-1 text-green-600" /> Copied!</>
            ) : (
              <><Copy className="w-4 h-4 mr-1" /> Copy</>
            )}
          </Button>
        </div>
      </div>

      {/* Editable Content with Highlighting */}
      <div className="relative bg-white rounded-lg border min-h-[300px] overflow-hidden">
        <textarea
          ref={textareaRef}
          value={editableText}
          onChange={handleTextChange}
          onScroll={(e) => {
            const overlay = e.target.nextElementSibling;
            if (overlay) {
              overlay.scrollTop = e.target.scrollTop;
              overlay.scrollLeft = e.target.scrollLeft;
            }
          }}
          className="w-full h-full min-h-[300px] p-4 font-sans text-sm leading-relaxed resize-none bg-transparent relative z-10 text-slate-900 focus:outline-none overflow-auto"
          style={{ caretColor: 'black' }}
          placeholder="Enhanced note will appear here..."
        />
        <div 
          className="absolute inset-0 p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap pointer-events-none z-0 overflow-hidden"
          style={{ color: 'transparent' }}
        >
          {renderHighlightedText()}
        </div>
      </div>

      <p className="text-xs text-slate-500 text-center">
        Use undo/redo buttons or Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
      </p>
    </div>
  );
}