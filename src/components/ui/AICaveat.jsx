import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AICaveat — the single, consistent provenance/trust line shown wherever
 * AI-generated text is surfaced to a clinician.
 *
 * The app drafts summaries, narratives, and insights with an LLM and shows them
 * next to real chart data. Without a consistent marker, a clinician can't tell
 * AI-drafted text from verified data, and there's no "verify before clinical
 * use" nudge — a real risk in a Medicare/HIPAA setting where hallucinated
 * content must never silently enter the record. Dropping this one component
 * under any AI output gives every surface the same honest, unmissable signal
 * (and, when a generation time is passed, tells the reader how fresh it is).
 *
 * @param {string|number|Date} [generatedAt] when the AI output was produced; if
 *   valid, a "generated <local time>" suffix is appended.
 * @param {string} [label] override the default caveat text.
 * @param {string} [className]
 */
export default function AICaveat({
  generatedAt,
  label = "AI-generated — verify before clinical use",
  className,
}) {
  let ts = null;
  if (generatedAt != null && generatedAt !== "") {
    const d = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
    if (!Number.isNaN(d.getTime())) ts = d.toLocaleString();
  }
  return (
    <p
      className={cn("flex items-center gap-1.5 text-[11px] leading-snug text-slate-500", className)}
      role="note"
    >
      <Sparkles className="h-3 w-3 flex-shrink-0 text-navy-500" aria-hidden="true" />
      <span>
        {label}
        {ts ? ` · generated ${ts}` : ""}
      </span>
    </p>
  );
}
