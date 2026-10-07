import { useState } from "react";
import { Video } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import TelehealthCall from "@/components/telehealth/TelehealthCall";
import { APP_NAME, PLATFORM_NAME } from "@/lib/brand";

// Public patient join page. Access is granted by the per-session join token
// (?t=) in the invite link; the server verifies it against the stored hash.
export default function JoinTelehealth() {
  const [{ room, token }] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return { room: p.get("room"), token: p.get("t") };
  });
  const [ended, setEnded] = useState(false);
  const valid = room && token;

  return (
    <>
      <title>{`Telehealth visit | ${APP_NAME} by ${PLATFORM_NAME}`}</title>
      <main className="min-h-screen bg-gradient-to-br from-navy-50 to-slate-100 p-4">
        {valid && !ended ? (
          <TelehealthCall role="patient" roomName={room} joinToken={token}
            waitingMessage="Waiting for your clinician to join..." onDisconnect={() => setEnded(true)} />
        ) : (
          <Card className="mx-auto mt-24 w-full max-w-lg">
            <CardContent className="p-8 text-center">
              <Video className="mx-auto mb-3 h-12 w-12 text-navy-600" aria-hidden="true" />
              <h1 className="text-xl font-bold">{ended ? "Your visit has ended" : "This join link is not valid"}</h1>
              <p className="mt-2 text-sm text-slate-600">
                {ended ? "Thank you. You can close this window." : "Please contact your care team for a new link."}
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}