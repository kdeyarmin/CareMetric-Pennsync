import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * LoadingState — the standard centered spinner for in-section / early-return
 * "still loading" states (transcript lists, dashboard tabs, and the like).
 *
 * Replaces the hand-rolled `<div className="flex justify-center py-12">
 * <Loader2 ... /></div>` blocks that had drifted apart across the learning
 * pages (some indigo, some blue, none announced to assistive tech). One
 * spinner, one color, one vertical rhythm.
 */
export default function LoadingState({ label, className }) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 py-12", className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="w-6 h-6 animate-spin text-navy-600" aria-hidden="true" />
      {label ? (
        <p className="text-sm text-slate-500">{label}</p>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );
}
