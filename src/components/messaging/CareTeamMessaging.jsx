import { AlertTriangle, MessageSquare } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const CARE_TEAM_MESSAGES_UNAVAILABLE_MESSAGE =
  "Care-team messages are unavailable until the patient, thread, and selected tenant are verified by a purpose-bound server broker. No empty-thread or unread-count conclusion should be inferred.";

export default function CareTeamMessaging() {
  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-950">
          <MessageSquare className="h-5 w-5 text-amber-700" aria-hidden="true" />
          Care-team messaging unavailable
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
          <AlertTitle>Tenant verification required</AlertTitle>
          <AlertDescription>{CARE_TEAM_MESSAGES_UNAVAILABLE_MESSAGE}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
