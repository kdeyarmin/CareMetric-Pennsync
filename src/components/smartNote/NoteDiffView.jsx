import { useState, useMemo } from "react";
import { GitCompare, X } from "lucide-react";

// Simple word-level diff — marks added words in green, removed in red
function computeDiff(original, enhanced) {
  const origWords = original.trim().split(/\s+/);
  const enhWords = enhanced.trim().split(/\s+/);

  // Build a simple LCS-based diff
  const m = origWords.length;
  const n = enhWords.length;

  // Use DP table for LCS (limit size to avoid perf issues)
  const MAX = 800;
  if (m > MAX || n > MAX) {
    // fallback: just show both side by side without inline diff
    return null;
  }

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (origWords[i] === enhWords[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to build diff tokens
  const tokens = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && origWords[i] === enhWords[j]) {
      tokens.push({ type: "same", text: origWords[i] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      tokens.push({ type: "added", text: enhWords[j] });
      j++;
    } else {
      tokens.push({ type: "removed", text: origWords[i] });
      i++;
    }
  }
  return tokens;
}

export default function NoteDiffView({ originalNote, enhancedNote }) {
  const [open, setOpen] = useState(false);

  const tokens = useMemo(() => {
    if (!open || !originalNote || !enhancedNote) return null;
    return computeDiff(originalNote, enhancedNote);
  }, [open, originalNote, enhancedNote]);

  const addedCount = tokens ? tokens.filter(t => t.type === "added").length : 0;
  const removedCount = tokens ? tokens.filter(t => t.type === "removed").length : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-slate-50 to-slate-50 hover:from-slate-100 hover:to-slate-100 transition-colors border-b border-slate-100"
      >
        <div className="flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-semibold text-slate-700">Compare: Raw vs Enhanced</span>
          {!open && (
            <span className="text-xs text-slate-400 hidden sm:inline">see what AI changed</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {tokens && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">+{addedCount}</span>
              <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">−{removedCount}</span>
            </div>
          )}
          {open ? <X className="w-4 h-4 text-slate-400" /> : <GitCompare className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {tokens ? (
            <>
              {/* Inline diff */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Inline Diff</p>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3 text-sm leading-relaxed font-mono whitespace-pre-wrap break-words">
                  {tokens.map((tok, i) => {
                    if (tok.type === "same") return <span key={i}>{tok.text} </span>;
                    if (tok.type === "added") return <span key={i} className="bg-green-100 text-green-800 rounded px-0.5">{tok.text} </span>;
                    return <span key={i} className="bg-red-100 text-red-800 line-through rounded px-0.5 opacity-70">{tok.text} </span>;
                  })}
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-green-100 border border-green-300" /> Added by AI</div>
                <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-300" /> Removed/replaced</div>
                <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-slate-200 border border-slate-300" /> Unchanged</div>
              </div>
            </>
          ) : (
            /* Side-by-side fallback for very long notes */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-red-600 uppercase mb-1.5">Your Original Note</p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap min-h-[200px]">{originalNote}</div>
              </div>
              <div>
                <p className="text-xs font-semibold text-green-600 uppercase mb-1.5">AI Enhanced Note</p>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap min-h-[200px]">{enhancedNote}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}