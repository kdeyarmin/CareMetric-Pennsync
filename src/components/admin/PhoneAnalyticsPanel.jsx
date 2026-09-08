import TelecomUnavailable, {
  PHONE_ANALYTICS_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";

/**
 * SmsMessage and SmsConsent are service-read-only and CallLog reporting is not
 * yet exposed through the same immutable tenant boundary. Rendering failed
 * browser reads as zero activity or exporting a partial dataset would be
 * operationally misleading, so the combined report remains unavailable.
 */
export default function PhoneAnalyticsPanel() {
  return (
    <TelecomUnavailable
      title="Phone and SMS analytics unavailable"
      message={PHONE_ANALYTICS_UNAVAILABLE_MESSAGE}
    />
  );
}
