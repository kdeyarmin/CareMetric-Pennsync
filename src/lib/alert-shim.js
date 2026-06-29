import { toast } from "sonner";

/**
 * Route window.alert() through the app's toast system.
 *
 * The app historically used native `window.alert()` in ~180 places for
 * post-action notifications. Native alerts are blocking and render as an
 * off-brand browser popup — a big part of why the UI felt "cheap". Rather than
 * rewrite every call site, we override `window.alert` once at startup so those
 * notifications surface as on-brand toasts instead.
 *
 * A light keyword heuristic picks the toast variant; anything ambiguous falls
 * back to a neutral toast. `confirm()` and `prompt()` are intentionally left
 * native — callers depend on their (blocking) return values.
 */
const FAILURE = /\b(fail|failed|failure|error|could ?not|couldn'?t|cannot|can'?t|unable|invalid|denied|not available)\b/i;
const SUCCESS = /\b(success|successfully|saved|sent|published|enrolled|added|created|updated|deleted|removed|completed|generated)\b/i;

export function installAlertToToastShim() {
  if (typeof window === "undefined" || window.__alertToastShim) return;
  window.__alertToastShim = true;

  window.alert = (message) => {
    const msg = message == null ? "" : String(message);
    if (FAILURE.test(msg)) {
      toast.error(msg);
    } else if (SUCCESS.test(msg)) {
      toast.success(msg);
    } else {
      toast(msg);
    }
  };
}
