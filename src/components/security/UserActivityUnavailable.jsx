import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const USER_ACTIVITY_READ_UNAVAILABLE_MESSAGE =
  "Global UserActivity rows do not yet carry verified immutable agency provenance and cannot be displayed until a tenant-authorized server broker is hosted and verified. Unavailable history must not be interpreted as zero events or an all-clear result.";

export default function UserActivityUnavailable({
  title = "User activity history unavailable",
}) {
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950">
      <AlertTriangle className="h-5 w-5 text-amber-700" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{USER_ACTIVITY_READ_UNAVAILABLE_MESSAGE}</AlertDescription>
    </Alert>
  );
}
