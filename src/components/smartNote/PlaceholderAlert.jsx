import { AlertTriangle, CornerDownRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { countPlaceholders, describePlaceholders } from "./compliance/placeholderGuard";

/**
 * Persistent, actionable warning about unfilled template scaffolding.
 *
 * Inserting a note template seeds the draft with "[diagnosis]" / "BP _/_" blanks,
 * and leaving them in hard-blocks the review step. That block was correct but
 * nearly invisible: it was announced by a toast that appeared after the nurse had
 * already clicked, and then vanished. So the same click failed over and over with
 * no lasting explanation of what to fix or where it was.
 *
 * This states the count, lists the lines involved, and walks the nurse through
 * them one at a time — the blank is selected in the editor, so typing replaces it.
 */
export default function PlaceholderAlert({ note, onJump }) {
  const total = countPlaceholders(note);
  if (!total) return null;
  // Display rows are capped and deduplicated; the count above is the real one.
  const lines = describePlaceholders(note);

  return (
    <Alert variant="warning" aria-live="polite" className="space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {total} unfilled blank{total === 1 ? "" : "s"} left from a template
          </p>
          <p className="text-xs mt-0.5">
            Fill each one in or delete it — the note can&apos;t go to review until they&apos;re gone.
          </p>
        </div>
      </div>

      <ul className="space-y-1">
        {lines.map((l) => (
          <li key={l.line} className="text-xs bg-white/70 border border-amber-200 rounded-lg px-2.5 py-1.5">
            <span className="text-amber-900">{l.line}</span>
            <span className="ml-1.5 font-mono font-semibold text-amber-700">{l.placeholders.join(" ")}</span>
          </li>
        ))}
      </ul>

      {onJump && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onJump}
          className="h-9 gap-1.5 text-xs font-semibold border-amber-300 text-amber-800 hover:bg-amber-100"
        >
          <CornerDownRight className="w-3.5 h-3.5" aria-hidden="true" /> Fill next blank
        </Button>
      )}
    </Alert>
  );
}
