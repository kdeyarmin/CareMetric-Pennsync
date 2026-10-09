import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Failure states for released telecom surfaces (owner decision, 2026-10-08).
// Each is shown only when a server read failed or was refused, so none of
// them may read as an empty result.
export const SMS_HISTORY_UNAVAILABLE_MESSAGE =
  "Text-message history could not be loaded from the server. This state must not be interpreted as zero messages, zero unread messages, or zero scheduled messages.";

export const PHONE_ANALYTICS_UNAVAILABLE_MESSAGE =
  "Phone and SMS analytics could not be loaded from the server. No zero-activity, delivery-rate, consent, or coverage conclusion should be inferred.";

export const TELEHEALTH_UNAVAILABLE_MESSAGE =
  "This visit's live vital readings could not be loaded from the server. Readings already recorded are not shown here, and this state must not be interpreted as a visit with no vitals.";

export default function TelecomUnavailable({
  title,
  message,
  compact = false,
}) {
  const notice = (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950">
      <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
      {compact && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );

  if (compact) return notice;

  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-950">
          <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{notice}</CardContent>
    </Card>
  );
}
