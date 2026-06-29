import { useEffect, useState, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { queryClientInstance } from "@/lib/query-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock, RefreshCw } from "lucide-react";
import { logSecurityEvent } from "../utils/security";
import { clearCachedPHI } from "@/lib/phiStorage";

/**
 * Session Timeout Manager Component
 * HIPAA-compliant automatic session timeout with warning
 */
export default function SessionTimeoutManager({ 
  timeoutMinutes = 15,
  warningMinutes = 2 
}) {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(warningMinutes * 60);
  const [lastActivity, setLastActivity] = useState(Date.now());
  // Latch so the 1-second checkInterval can't re-enter handleLogout on every
  // tick while the logout redirect is still in flight — otherwise each tick
  // re-fires the SESSION_TIMEOUT audit write and another logout/clear call.
  const loggingOutRef = useRef(false);

  const handleLogout = useCallback(async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;

    await logSecurityEvent('SESSION_TIMEOUT', {
      timeout_minutes: timeoutMinutes,
      last_activity: new Date(lastActivity).toISOString()
    }, 'warning');

    // Clear sensitive data from memory (incl. cached PHI in the query cache)
    sessionStorage.clear();
    try { queryClientInstance.clear(); } catch { /* no-op */ }
    // Purge re-fetchable PHI persisted to localStorage/IndexedDB (preserves
    // unsynced offline work — see clearCachedPHI). Await so the IndexedDB clear
    // completes before the logout redirect navigates away.
    try { await clearCachedPHI(); } catch { /* no-op */ }

    // Logout and redirect (pass the current URL so the SDK performs a
    // deterministic navigation, matching AuthContext.logout).
    base44.auth.logout(window.location.href);
  }, [timeoutMinutes, lastActivity]);

  const handleExtendSession = useCallback(() => {
    setShowWarning(false);
    setLastActivity(Date.now());
    setSecondsRemaining(warningMinutes * 60);
    
    logSecurityEvent('SESSION_EXTENDED', {
      extended_at: new Date().toISOString()
    }, 'info');
  }, [warningMinutes]);

  const resetActivity = useCallback(() => {
    setLastActivity(Date.now());
    setShowWarning(false);
  }, []);

  useEffect(() => {
    // Activity listeners
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    
    events.forEach(event => {
      window.addEventListener(event, resetActivity, { passive: true });
    });

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, resetActivity);
      });
    };
  }, [resetActivity]);

  useEffect(() => {
    const warningThreshold = (timeoutMinutes - warningMinutes) * 60 * 1000;
    const timeoutThreshold = timeoutMinutes * 60 * 1000;

    const checkInterval = setInterval(() => {
      const inactive = Date.now() - lastActivity;

      if (inactive >= timeoutThreshold) {
        handleLogout();
      } else if (inactive >= warningThreshold && !showWarning) {
        setShowWarning(true);
      }

      if (showWarning) {
        const remaining = Math.max(0, Math.floor((timeoutThreshold - inactive) / 1000));
        setSecondsRemaining(remaining);
      }
    }, 1000);

    return () => clearInterval(checkInterval);
  }, [lastActivity, showWarning, timeoutMinutes, warningMinutes, handleLogout]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    // The warning must not be dismissible by outside-click/Esc: closing it that
    // way left showWarning=false without resetting lastActivity, so the 1s
    // interval immediately re-opened it (flicker), and a user could "close" the
    // warning without actually extending the session. Force the choice through
    // the explicit Keep / Sign Out buttons.
    <Dialog open={showWarning} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-sm p-0 overflow-hidden rounded-2xl border-0 shadow-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Header band */}
        <div className="bg-amber-500 px-6 pt-6 pb-5 text-white text-center">
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <Clock className="w-7 h-7 text-white" />
          </div>
          <DialogTitle className="text-white text-xl font-bold">Still there?</DialogTitle>
          <DialogDescription className="text-amber-100 text-sm mt-1">
            You've been inactive for a while
          </DialogDescription>
        </div>

        {/* Body */}
        <div className="px-6 py-5 text-center bg-white">
          <p className="text-slate-500 text-sm mb-2">Auto sign-out in</p>
          <p className="text-5xl font-bold text-slate-900 tabular-nums tracking-tight mb-1">
            {formatTime(secondsRemaining)}
          </p>
          <p className="text-xs text-slate-400 mb-6">to protect patient data (HIPAA)</p>

          <div className="space-y-2">
            <Button
              onClick={handleExtendSession}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold h-11 rounded-xl text-sm"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Keep Me Signed In
            </Button>
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="w-full text-slate-400 hover:text-slate-600 h-9 text-sm"
            >
              Sign Out Now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}