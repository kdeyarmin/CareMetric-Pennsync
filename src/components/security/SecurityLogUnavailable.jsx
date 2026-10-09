import { AlertTriangle, Shield } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Shown when a security-log read failed or the caller may not read the full
// log (SecurityLog is readable by a row's creator or the administrator
// account). This is the failure state, not a paused feature.
export const SECURITY_LOG_READ_UNAVAILABLE_MESSAGE =
  "Security event history could not be loaded for your account right now. The full security log is readable by the administrator account. No zero-event or all-clear conclusion should be inferred.";

export default function SecurityLogUnavailable({
  title = "Security event history unavailable",
  message = SECURITY_LOG_READ_UNAVAILABLE_MESSAGE,
}) {
  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-950">
          <Shield className="h-5 w-5" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
          <AlertDescription className="text-amber-950">
            {message}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
