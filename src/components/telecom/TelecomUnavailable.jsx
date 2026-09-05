import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const SMS_HISTORY_UNAVAILABLE_MESSAGE =
  "Text-message and scheduled-message history is unavailable until a tenant-authorized server read broker is hosted and verified. This state must not be interpreted as zero messages, zero unread messages, or zero scheduled messages.";

export const SMS_CONSENT_UNAVAILABLE_MESSAGE =
  "Patient-specific texting consent and message history cannot be displayed until a tenant-authorized server read broker is hosted and verified. Texting controls are disabled; this state is not evidence that consent is absent or present.";

export const PHONE_ANALYTICS_UNAVAILABLE_MESSAGE =
  "Phone and SMS analytics are unavailable until tenant-authorized message, consent, and call reporting brokers are hosted and verified. No zero-activity, delivery-rate, consent, or coverage conclusion should be inferred.";

export const TELEHEALTH_UNAVAILABLE_MESSAGE =
  "Telehealth scheduling, session history, joining, and live vital capture are temporarily unavailable while session creation and provider-room authority move behind a server-owned tenant broker. This state must not be interpreted as an empty schedule or history.";

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
