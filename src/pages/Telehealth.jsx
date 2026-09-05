import { Video } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import TelecomUnavailable, {
  TELEHEALTH_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";

/**
 * TelehealthSession is service-read/write-only. Keep the page hard-gated before
 * any patient, session, provider, or device hook until a server-owned session
 * creation/list/update broker and immutable provider-room binding are hosted.
 */
export default function Telehealth() {
  return (
    <PageContainer>
      <PageHeader
        icon={Video}
        eyebrow="Communication"
        title="Telehealth"
        description="Telehealth is paused while session authority is migrated."
        favoritePage="Telehealth"
      />
      <div className="px-3 sm:px-4 md:px-6">
        <TelecomUnavailable
          title="Telehealth temporarily unavailable"
          message={TELEHEALTH_UNAVAILABLE_MESSAGE}
        />
      </div>
    </PageContainer>
  );
}
