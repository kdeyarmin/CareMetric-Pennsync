const LOGO_URL =
  "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png";

/**
 * Branded full-page loading state — a navy ring spinning around the PennSync
 * mark with the wordmark beneath. Rendered inside the app's `fixed inset-0`
 * loading wrappers (App.jsx) so it covers the screen during auth checks and
 * route/code-split transitions. Reduced-motion users get a calm static mark
 * via the global prefers-reduced-motion guard.
 */
export default function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="relative h-16 w-16">
        <span
          className="absolute inset-0 rounded-full border-[3px] border-navy-100 border-t-navy-600 animate-spin"
          aria-hidden="true"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <img src={LOGO_URL} alt="" className="h-8 w-8 rounded-lg" />
        </span>
      </div>
      <p className="text-sm font-bold tracking-tight text-navy-900">
        Penn<span className="text-gold-600">Sync</span>
      </p>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
