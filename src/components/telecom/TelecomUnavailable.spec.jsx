import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import TelecomUnavailable, {
  PHONE_ANALYTICS_UNAVAILABLE_MESSAGE,
  SMS_HISTORY_UNAVAILABLE_MESSAGE,
  TELEHEALTH_UNAVAILABLE_MESSAGE,
} from "./TelecomUnavailable";

// The telecom surfaces were released on 2026-10-08; these messages are now
// what a failed or refused server read shows, so each must say it failed and
// must never read as an empty result.
describe("telecom fail-closed presentation", () => {
  it("does not present failed SMS history as a zero result", () => {
    renderWithProviders(
      <TelecomUnavailable
        compact
        title="Text history unavailable"
        message={SMS_HISTORY_UNAVAILABLE_MESSAGE}
      />,
    );

    expect(screen.getByText("Text history unavailable")).toBeInTheDocument();
    expect(screen.getByText(SMS_HISTORY_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /could not be loaded.*must not be interpreted as zero messages/,
    );
  });

  it("does not present failed analytics as zero activity", () => {
    renderWithProviders(
      <TelecomUnavailable title="Phone and SMS analytics unavailable" message={PHONE_ANALYTICS_UNAVAILABLE_MESSAGE} />,
    );

    expect(screen.getByText(PHONE_ANALYTICS_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /could not be loaded.*No zero-activity, delivery-rate, consent, or coverage conclusion/,
    );
  });

  it("does not present a failed vitals read as a visit with no vitals", () => {
    renderWithProviders(
      <TelecomUnavailable compact title="Live vital capture unavailable" message={TELEHEALTH_UNAVAILABLE_MESSAGE} />,
    );

    expect(screen.getByText(TELEHEALTH_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /could not be loaded.*must not be interpreted as a visit with no vitals/,
    );
  });
});
