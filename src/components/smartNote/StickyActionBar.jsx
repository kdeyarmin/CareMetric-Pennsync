/**
 * Keeps a step's primary action reachable without scrolling back down a long form.
 *
 * The bottom offset clears MobileBottomNav (fixed, h-16 = 4rem) plus the iOS safe
 * area; above `md` that nav is gone and a small inset is enough.
 *
 * This relies on the app shell's <main> not being a scroll container below `md`
 * — see `.overflow-x-clip-safe` in index.css. Before that fix, `overflow-x:
 * hidden` made <main> the sticky container on mobile and every sticky child was
 * inert, which is why this bar was previously position:fixed with a measured
 * spacer.
 */
export default function StickyActionBar({ status = null, children, className = "" }) {
  return (
    <div
      className={`sticky z-20 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] md:bottom-4 ${className}`}
    >
      <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-2xl shadow-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2">
        {/* Always rendered so the live region is stable across status changes. */}
        <div className="text-xs text-slate-600 sm:flex-1 min-w-0" aria-live="polite">
          {status}
        </div>
        <div className="flex gap-2 sm:shrink-0">{children}</div>
      </div>
    </div>
  );
}
