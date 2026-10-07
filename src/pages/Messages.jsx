import { AlertTriangle, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

export const TENANT_MESSAGES_UNAVAILABLE_MESSAGE =
  "Secure messages remain paused. Legacy and ambiguous rows are quarantined; no inbox, thread, unread count, send, reply, read-state, AI, or urgent-alert result is available until v2 tenant, membership, patient, thread, participant, idempotency, and hosted atomicity evidence is approved. This state must not be interpreted as an empty inbox or zero unread messages.";

export const TENANT_MESSAGES_RELEASE_REQUIREMENTS = Object.freeze([
  "exact active AgencyMembership for every participant",
  "immutable server-stamped agency, thread, sender, and participant provenance",
  "atomic create idempotency and versioned read-state compare-and-set proof",
  "durable uniquely keyed urgent-message notification outbox",
  "hosted tenant-isolation, replay, authorization-drift, and legacy-quarantine evidence",
]);

export default function Messages() {
  return (
    <PageContainer>
      <PageHeader
        icon={Mail}
        eyebrow="Communication"
        title="Messages"
        description="The participant mailbox is paused while secure-message v2 authority and atomicity are completed and verified."
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
