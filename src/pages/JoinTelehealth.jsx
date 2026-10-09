import { useCallback, useEffect, useState } from "react";
import { Video } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import TelehealthCall from "@/components/telehealth/TelehealthCall";
import { publicCapabilityClient } from "@/api/base44Client";
import { usePublicCapabilityLease } from "@/lib/PublicCapabilityContext";
import { APP_NAME, PLATFORM_NAME } from "@/lib/brand";

export const JOIN_LINK_INVALID_HEADING = "This join link is not valid";

/**
 * Public patient join page. Access is granted only by the per-session join
 * token (?t=) in the invite link; createTelehealthToken verifies it against the
 * stored hash and the visit's join window. The tenant SDK is closed on public
 * routes, so the token request goes through the leased public capability
 * client. The token is read once and then removed from the address bar, so it
 * does not linger in history or a shared screenshot.
 */
export default function JoinTelehealth() {
  const lease = usePublicCapabilityLease();
  const [{ room, token }] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { room: params.get("room"), token: params.get("t") };
  });
  const [ended, setEnded] = useState(false);
  const valid = Boolean(room && token);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("t")) return;
    url.searchParams.delete("t");
    window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const requestToken = useCallback(
    (payload) => publicCapabilityClient.createTelehealthToken(lease, payload),
    [lease],
  );

  return (
    <>
      <title>{`Telehealth visit | ${APP_NAME} by ${PLATFORM_NAME}`}</title>
      <main className="min-h-screen bg-gradient-to-br from-navy-50 to-slate-100 p-4">
        {valid && !ended ? (
          <TelehealthCall
            role="patient"
            roomName={room}
            joinToken={token}
            requestToken={requestToken}
            waitingMessage="Waiting for your clinician to join..."
            onDisconnect={() => setEnded(true)}
          />
        ) : (
          <Card className="mx-auto mt-24 w-full max-w-lg">
            <CardContent className="p-8 text-center">
              <Video className="mx-auto mb-3 h-12 w-12 text-navy-600" aria-hidden="true" />
              <h1 className="text-xl font-bold">{ended ? "Your visit has ended" : JOIN_LINK_INVALID_HEADING}</h1>
              <p className="mt-2 text-sm text-slate-600">
                {ended ? "Thank you. You can close this window." : "Please contact your care team for a new link."}
              </p>
              <a href="/" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                Return to workspace
              </a>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}