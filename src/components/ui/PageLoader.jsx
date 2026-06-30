import { BRAND_LOGO_URL } from "@/lib/brand";

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
          <img src={BRAND_LOGO_URL} alt="" className="h-8 w-8 rounded-lg" />
        </span>
      </div>
      <p className="flex flex-col items-center gap-0.5 leading-none">
        <span className="text-sm font-bold tracking-tight text-navy-900">
          Penn<span className="text-gold-600">Sync</span>
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">by CareMetric</span>
      </p>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
