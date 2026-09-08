import TelecomUnavailable, {
  TELEHEALTH_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";

/**
 * A failed service-only TelehealthSession read is not an empty upcoming list.
 * Show the availability boundary on the dashboard instead of silently hiding
 * the widget and implying that the clinician has no scheduled visits.
 */
export default function UpcomingTelehealthWidget() {
  return (
    <TelecomUnavailable
      compact
      title="Upcoming telehealth schedule unavailable"
      message={TELEHEALTH_UNAVAILABLE_MESSAGE}
    />
  );
}
