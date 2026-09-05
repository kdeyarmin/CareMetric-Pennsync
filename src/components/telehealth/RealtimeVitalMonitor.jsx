import TelecomUnavailable, {
  TELEHEALTH_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";

/**
 * Live vitals were read from and merged into TelehealthSession in the browser.
 * Keep capture disabled until a server broker enforces session, patient, and
 * tenant authority and performs the merge atomically.
 */
export default function RealtimeVitalMonitor() {
  return (
    <TelecomUnavailable
      compact
      title="Live telehealth vital capture unavailable"
      message={TELEHEALTH_UNAVAILABLE_MESSAGE}
    />
  );
}
