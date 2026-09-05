import { AlertTriangle, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

export const TENANT_MESSAGES_UNAVAILABLE_MESSAGE =
  "Secure messages are unavailable until every thread has verified tenant provenance and list, send, reply, and read-state changes use a tenant-authorized server broker. This state must not be interpreted as an empty inbox or zero unread messages.";

export default function Messages() {
  return (
    <PageContainer>
      <PageHeader
        icon={Mail}
        eyebrow="Communication"
        title="Messages"
        description="The participant mailbox is paused while tenant-bound message authority is completed and verified."
        favoritePage="Messages"
      />
      <Alert className="border-amber-300 bg-amber-50 text-amber-950">
        <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
        <AlertTitle>Secure messaging unavailable</AlertTitle>
        <AlertDescription>{TENANT_MESSAGES_UNAVAILABLE_MESSAGE}</AlertDescription>
      </Alert>
    </PageContainer>
  );
}
