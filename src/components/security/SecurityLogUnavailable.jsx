import { AlertTriangle, Shield } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const SECURITY_LOG_READ_UNAVAILABLE_MESSAGE =
  "Security event history is unavailable until every row carries immutable agency provenance and a tenant-authorized server broker is hosted and verified. No zero-event or all-clear conclusion should be inferred.";

export default function SecurityLogUnavailable({
  title = "Security event history unavailable",
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
            {SECURITY_LOG_READ_UNAVAILABLE_MESSAGE}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
