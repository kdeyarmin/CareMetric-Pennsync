import PhoneTopBar from "@/components/phone/PhoneTopBar";
import TelecomUnavailable, {
  SMS_HISTORY_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";

/**
 * ScheduledSms is service-read-only. Cancellation cannot be offered without a
 * tenant-authorized inventory broker that proves which row belongs to the
 * caller; an authorization failure is never rendered as "no scheduled texts."
 */
export default function ScheduledSmsList() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PhoneTopBar title="Scheduled" large />
      <div className="flex-1 overflow-y-auto overscroll-contain p-4">
        <TelecomUnavailable
          compact
          title="Scheduled text history unavailable"
          message={SMS_HISTORY_UNAVAILABLE_MESSAGE}
        />
      </div>
    </div>
  );
}
