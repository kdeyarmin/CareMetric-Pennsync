import { Badge } from "@/components/ui/badge";
import { Copy, Info } from "lucide-react";
import { getThreshold } from "./compliance/thresholds";

const TONE = {
  green: { frame: "border-emerald-200 bg-emerald-50", badge: "success" },
  slate: { frame: "border-slate-200 bg-slate-50", badge: "secondary" },
  amber: { frame: "border-amber-200 bg-amber-50", badge: "warning" },
  red: { frame: "border-red-200 bg-red-50", badge: "destructive" },
};

/**
 * CopyForwardPanel — visit-specificity review.
 *
 * ADVISORY ONLY, and the wording is a product requirement: it says "review for
 * visit-specific detail", never anything that reads as an accusation of cloning
 * or misconduct. Notes on a stable patient are legitimately similar, so the
 * panel shows the nurse WHAT repeats and lets them judge, rather than asserting
 * anything about intent. It never blocks a save.
 */
export default function CopyForwardPanel({ review }) {
  if (!review || !review.comparedCount) return null;
  const tone = TONE[review.band.tone] || TONE.slate;
  const pct = Math.round(review.score * 100);
  // A band boundary nobody has tuned must not be presented as an authority.
  const bandThreshold = getThreshold("similarity_high");

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${tone.frame}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
          <Copy className="w-4 h-4 shrink-0" aria-hidden="true" /> Visit-specific detail
        </h4>
        {/* Not colour-only: the band is named in text as well as toned. */}
        <Badge variant={tone.badge} className="text-xs shrink-0">{review.band.label} · {pct}%</Badge>
      </div>

      <p className="text-xs text-slate-700">{review.band.advisory}</p>

      {review.reviewPrompts.length > 0 && (
        <ul className="ml-4 list-disc text-xs text-slate-700 space-y-0.5">
          {review.reviewPrompts.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}

      {review.repeatedSentences.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-slate-700 min-h-[32px] flex items-center">
            Sentences that repeat the prior note ({review.repeatedSentences.length})
          </summary>
          <ul className="mt-1 space-y-1">
            {review.repeatedSentences.map((r, i) => (
              <li key={i} className="bg-white/70 border border-slate-200 rounded px-2 py-1 leading-relaxed text-slate-700">
                {r.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Info className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Compared against {review.comparedCount} prior note{review.comparedCount === 1 ? "" : "s"}.
          Advisory only — repeated wording is expected for a stable patient and never blocks saving.
          {bandThreshold && !bandThreshold.calibrated && (
            <> These bands are PennSync defaults that have not been calibrated on your agency&apos;s notes.</>
          )}
        </span>
      </p>
    </div>
  );
}
