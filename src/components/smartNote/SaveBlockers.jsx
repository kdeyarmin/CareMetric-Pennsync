import { AlertTriangle, Circle } from "lucide-react";
import { Alert } from "@/components/ui/alert";

/**
 * Says why "Save to chart" is disabled.
 *
 * Six separate conditions can disable that button, and each announced itself only
 * as a toast fired after the click — so a nurse facing two at once fixed one,
 * clicked again, and got a different message. This lists everything outstanding
 * at the same time, next to the button it is talking about, and stays on screen
 * until the reasons are gone.
 */
export default function SaveBlockers({ items = [], error = null }) {
  const blocked = items.filter((i) => i.blocked);
  if (!blocked.length && !error) return null;

  return (
    <Alert variant="warning" aria-live="polite" className="space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {error ? "This note wasn't saved" : "Before you can save this note"}
          </p>
          {error && <p className="text-xs mt-0.5">{error}</p>}
        </div>
      </div>
      {blocked.length > 0 && (
        <ul className="space-y-1 ml-6">
          {blocked.map((item) => (
            <li key={item.label} className="flex items-start gap-1.5 text-xs text-amber-900">
              <Circle className="w-2 h-2 mt-1.5 shrink-0 fill-current" aria-hidden="true" />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
