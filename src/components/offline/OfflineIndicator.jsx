import { WifiOff } from "lucide-react";
import { useOfflineQueue } from "@/lib/offlineSync";

/**
 * OfflineIndicator — a persistent, unmissable "you're offline" banner rendered
 * at the top of the page content in the app shell.
 *
 * PennSync is used by nurses in the field, often in low-signal homes. Without a
 * clear connectivity signal a stale cached page looks identical to a live one,
 * so a nurse can act on yesterday's data without knowing the connection dropped.
 * The floating sync-status card (OfflineSyncStatus) handles the *queue* — pending
 * counts and a manual "Sync now" — but sits bottom-right and is easy to miss.
 * This banner is the top-of-sightline *awareness* piece; it shows only while
 * offline and gets out of the way the moment connectivity returns.
 */
export default function OfflineIndicator() {
  const { isOnline } = useOfflineQueue();
  if (isOnline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <WifiOff className="h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden="true" />
      <span>
        <span className="font-semibold">You're offline.</span>{" "}
        You're viewing cached data — changes will sync automatically when you reconnect.
      </span>
    </div>
  );
}
