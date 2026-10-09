import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Shown when the scoped activity report (getUserActivityLog) could not be read
// or refused the caller. Activity history is available again (owner decision,
// 2026-10-08); this is the failure state, not a paused feature.
export const USER_ACTIVITY_READ_UNAVAILABLE_MESSAGE =
  "User activity history could not be loaded for your account right now. It is readable by administrators, scoped to their agency. Unavailable history must not be interpreted as zero events or an all-clear result.";

export default function UserActivityUnavailable({
  title = "User activity history unavailable",
  message = USER_ACTIVITY_READ_UNAVAILABLE_MESSAGE,
}) {
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950" role="status">
      <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
