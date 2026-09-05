import { Video } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import TelecomUnavailable, {
  TELEHEALTH_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";

/**
 * The token broker is deliberately paused until TelehealthSession authority is
 * server-owned. Do not ask a patient for camera/microphone access before an
 * operation that is guaranteed to fail closed.
 */
export default function JoinTelehealth() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-50 to-slate-100 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-5 p-8">
          <div className="text-center">
            <Video className="mx-auto mb-3 h-12 w-12 text-amber-700" aria-hidden="true" />
            <h1 className="text-xl font-bold text-slate-900">Telehealth visit unavailable</h1>
            <p className="mt-2 text-sm text-slate-600">
              Please contact your care team to arrange another way to complete this visit.
            </p>
          </div>
          <TelecomUnavailable
            compact
            title="This join link cannot be used right now"
            message={TELEHEALTH_UNAVAILABLE_MESSAGE}
          />
        </CardContent>
      </Card>
    </main>
  );
}
