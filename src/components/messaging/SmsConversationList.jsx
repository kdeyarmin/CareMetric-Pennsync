import PhoneTopBar from "@/components/phone/PhoneTopBar";
import TelecomUnavailable, {
  SMS_HISTORY_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";

/**
 * SmsMessage and SmsConsent are service-read-only. Do not run a browser query
 * and turn its authorization failure into an empty inbox. This screen remains
 * an explicit availability boundary until a tenant-authorized inbox broker is
 * hosted and verified.
 */
export default function SmsConversationList() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PhoneTopBar title="Messages" large />
      <div className="flex-1 overflow-y-auto overscroll-contain p-4">
        <TelecomUnavailable
          compact
          title="Text message history unavailable"
          message={SMS_HISTORY_UNAVAILABLE_MESSAGE}
        />
      </div>
    </div>
  );
}
