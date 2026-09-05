import TelecomUnavailable, {
  TELEHEALTH_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";

/**
 * Patient-specific sessions cannot be listed or mutated directly from the
 * browser. The panel remains static so unreadable history is never represented
 * as "no visits" and no caller-shaped provider room can be created.
 */
export default function PatientTelehealthPanel() {
  return (
    <TelecomUnavailable
      title="Patient telehealth visits unavailable"
      message={TELEHEALTH_UNAVAILABLE_MESSAGE}
    />
  );
}
